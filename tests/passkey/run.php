<?php
/**
 * CloudHost247 Passkey Authentication — behaviour suite.
 *
 * Pure PHP, no network, in-memory storage (see fakes.php). The WebAuthn
 * ceremonies are *real*: the suite CBOR-encodes a COSE public key, builds
 * authenticator data and signs it with OpenSSL, then feeds the result through
 * the same CredentialVerifier the production code uses. Nothing about the
 * cryptography is stubbed.
 *
 * Run: php tests/passkey/run.php
 */
define('WHMCS', 1);
error_reporting(E_ALL);

$root = dirname(dirname(__DIR__));
require $root . '/modules/addons/cloudhost247_passkey/bootstrap.php';
require __DIR__ . '/fakes.php';

use CloudHost247\Passkey\ActionConfirmationService;
use CloudHost247\Passkey\AdminController;
use CloudHost247\Passkey\AuthenticationService;
use CloudHost247\Passkey\Base64Url;
use CloudHost247\Passkey\Cbor;
use CloudHost247\Passkey\ChallengeRepository;
use CloudHost247\Passkey\Config;
use CloudHost247\Passkey\ConfigurationException;
use CloudHost247\Passkey\Cose;
use CloudHost247\Passkey\CredentialRepository;
use CloudHost247\Passkey\CredentialVerifier;
use CloudHost247\Passkey\EventLog;
use CloudHost247\Passkey\Log;
use CloudHost247\Passkey\MigrationRunner;
use CloudHost247\Passkey\PasskeyException;
use CloudHost247\Passkey\PasswordResetService;
use CloudHost247\Passkey\PolicyService;
use CloudHost247\Passkey\RateLimiter;
use CloudHost247\Passkey\RegistrationService;
use CloudHost247\Passkey\Schema;
use CloudHost247\Passkey\SettingsRepository;
use WHMCS\Database\Capsule;

$tests = array();

// =============================================================== authenticator
/**
 * A minimal software authenticator. It behaves like a real one: it owns a
 * key pair, signs authenticator data, and keeps a monotonic counter.
 */
final class FakeAuthenticator
{
    public $credentialId;
    public $signCount = 0;
    private $privateKey;
    private $cose;

    public function __construct($credentialId = null)
    {
        $this->credentialId = $credentialId === null ? random_bytes(32) : $credentialId;

        // Prefer live key generation; fall back to the committed throwaway
        // test key when the runtime cannot generate one (see fixtures/README).
        $pem = null;
        if (function_exists('openssl_pkey_new')) {
            $resource = @openssl_pkey_new(array('curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC));
            if ($resource) {
                @openssl_pkey_export($resource, $pem);
            }
        }
        if (!$pem) {
            $pem = file_get_contents(__DIR__ . '/fixtures/es256-private.test.pem');
        }
        $this->privateKey = $pem;

        $details = openssl_pkey_get_details(openssl_pkey_get_private($pem));
        $this->cose = array(
            1 => Cose::KTY_EC2,
            3 => Cose::ALG_ES256,
            -1 => 1, // P-256
            -2 => str_pad($details['ec']['x'], 32, "\x00", STR_PAD_LEFT),
            -3 => str_pad($details['ec']['y'], 32, "\x00", STR_PAD_LEFT),
        );
    }

    public function authData($rpId, $flags, $includeAttestedData)
    {
        $data = hash('sha256', $rpId, true) . chr($flags) . pack('N', $this->signCount);
        if ($includeAttestedData) {
            $data .= str_repeat("\x00", 16)
                . pack('n', strlen($this->credentialId))
                . $this->credentialId
                . Cbor::encode($this->cose);
        }
        return $data;
    }

    public function clientData($type, $challenge, $origin = 'https://portal.example.com', $crossOrigin = false)
    {
        return json_encode(array(
            'type' => $type,
            'challenge' => $challenge,
            'origin' => $origin,
            'crossOrigin' => $crossOrigin,
        ));
    }

    /** Builds a navigator.credentials.create() style response. */
    public function register($challenge, array $options = array())
    {
        $flags = isset($options['flags']) ? $options['flags'] : 0x45; // UP | UV | AT
        $origin = isset($options['origin']) ? $options['origin'] : 'https://portal.example.com';
        $rpId = isset($options['rpId']) ? $options['rpId'] : 'example.com';
        $clientData = $this->clientData('webauthn.create', $challenge, $origin, !empty($options['crossOrigin']));
        $authData = $this->authData($rpId, $flags, true);
        $attestation = Cbor::encode(array('fmt' => 'none', 'attStmt' => array('x' => 0), 'authData' => $authData));
        return array(
            'id' => Base64Url::encode($this->credentialId),
            'rawId' => Base64Url::encode($this->credentialId),
            'type' => 'public-key',
            'transports' => array('internal', 'hybrid'),
            'response' => array(
                'clientDataJSON' => Base64Url::encode($clientData),
                'attestationObject' => Base64Url::encode($attestation),
            ),
        );
    }

    /** Builds a navigator.credentials.get() style response. */
    public function assert($challenge, array $options = array())
    {
        $type = isset($options['type']) ? $options['type'] : 'webauthn.get';
        $flags = isset($options['flags']) ? $options['flags'] : 0x05; // UP | UV
        $origin = isset($options['origin']) ? $options['origin'] : 'https://portal.example.com';
        $rpId = isset($options['rpId']) ? $options['rpId'] : 'example.com';
        if (!isset($options['keepCounter'])) {
            $this->signCount++;
        }

        $clientData = $this->clientData($type, $challenge, $origin, !empty($options['crossOrigin']));
        $authData = $this->authData($rpId, $flags, false);
        $signature = '';
        openssl_sign($authData . hash('sha256', $clientData, true), $signature, $this->privateKey, OPENSSL_ALGO_SHA256);
        if (!empty($options['corruptSignature'])) {
            $signature = substr($signature, 0, -1) . chr((ord(substr($signature, -1)) + 1) % 256);
        }

        return array(
            'id' => Base64Url::encode($this->credentialId),
            'rawId' => Base64Url::encode($this->credentialId),
            'type' => 'public-key',
            'response' => array(
                'clientDataJSON' => Base64Url::encode($clientData),
                'authenticatorData' => Base64Url::encode($authData),
                'signature' => Base64Url::encode($signature),
                'userHandle' => isset($options['userHandle']) ? $options['userHandle'] : '',
            ),
        );
    }
}

/** Registers a passkey for a client and returns [authenticator, credential]. */
function ch247_pk_enrol($clientId = 42, $authenticator = null)
{
    ch247_pk_client($clientId);
    $authenticator = $authenticator === null ? new FakeAuthenticator() : $authenticator;
    $options = RegistrationService::options(Schema::USER_CLIENT, $clientId, array(
        'name' => 'ada@example.com', 'displayName' => 'Ada Ng',
    ));
    $response = $authenticator->register($options['challenge']);
    $credential = RegistrationService::verify(Schema::USER_CLIENT, $clientId, $response, 'Test device');
    return array($authenticator, $credential);
}

/** Runs a full authentication ceremony and returns the result array. */
function ch247_pk_authenticate(FakeAuthenticator $authenticator, array $options = array())
{
    $challenge = AuthenticationService::options(
        isset($options['identifier']) ? $options['identifier'] : 'ada@example.com'
    );
    $response = $authenticator->assert($challenge['challenge'], $options);
    return AuthenticationService::verify($response);
}

/** Asserts that $callback throws a PasskeyException with the given reason. */
function ch247_pk_rejects($callback, $reason)
{
    try {
        $callback();
    } catch (PasskeyException $e) {
        return $e->reason() === $reason;
    } catch (\Throwable $e) {
        return false;
    }
    return false;
}

// ------------------------------------------------------------------ migrations

$tests['Migrations are versioned, idempotent and repeatable'] = function () {
    ch247_pk_fresh();
    if (MigrationRunner::pending() !== array()) { return false; }
    if (MigrationRunner::appliedVersions() !== array(100)) { return false; }
    if (MigrationRunner::migrate() !== array()) { return false; }
    foreach (array(Schema::CREDENTIALS, Schema::CHALLENGES, Schema::EVENTS, Schema::POLICIES,
                 Schema::IDENTITIES, Schema::RATE_LIMITS, Schema::SETTINGS) as $table) {
        if (!Capsule::schema()->hasTable($table)) { return false; }
    }
    // The credential table must not have anywhere to put a private key.
    return !Capsule::schema()->hasColumn(Schema::CREDENTIALS, 'private_key')
        && Capsule::schema()->hasColumn(Schema::CREDENTIALS, 'public_key');
};

// --------------------------------------------------------------- configuration

$tests['An unconfigured relying party fails closed'] = function () {
    ch247_pk_fresh(array('rp_id' => '', 'allowed_origins' => ''));
    if (Config::isOperational()) { return false; }
    try {
        Config::relyingParty();
        return false;
    } catch (ConfigurationException $e) {
        // Ceremonies must refuse rather than guess a domain.
        return !Config::isOperational();
    }
};

$tests['Plain HTTP origins are refused in production'] = function () {
    ch247_pk_fresh(array('allowed_origins' => 'http://portal.example.com'));
    return !Config::isOperational();
};

$tests['Origins outside the RP ID are refused'] = function () {
    ch247_pk_fresh(array('allowed_origins' => 'https://portal.attacker.test'));
    return !Config::isOperational();
};

$tests['RP ID input is normalised, not trusted verbatim'] = function () {
    ch247_pk_fresh();
    SettingsRepository::save(array('rp_id' => 'HTTPS://Example.com/path'));
    SettingsRepository::flush();
    return SettingsRepository::get('rp_id') === 'example.com';
};

// --------------------------------------------------------------- registration

$tests['A real registration ceremony stores a usable public key'] = function () {
    ch247_pk_fresh();
    list($authenticator, $credential) = ch247_pk_enrol();
    $stored = CredentialRepository::findByCredentialId(Base64Url::encode($authenticator->credentialId));
    if (!$stored) { return false; }
    return strpos($stored['public_key'], 'PUBLIC KEY') !== false
        && (int) $stored['algorithm'] === Cose::ALG_ES256
        && $stored['status'] === Schema::STATUS_ACTIVE
        && $credential['device_name'] === 'Test device';
};

$tests['Registration never exposes key material in the public DTO'] = function () {
    ch247_pk_fresh();
    list(, $credential) = ch247_pk_enrol();
    $serialised = json_encode($credential);
    foreach (array('public_key', 'PUBLIC KEY', 'credential_id', 'challenge') as $forbidden) {
        if (strpos($serialised, $forbidden) !== false) { return false; }
    }
    return true;
};

$tests['A registration challenge cannot be replayed'] = function () {
    ch247_pk_fresh();
    ch247_pk_client(42);
    $authenticator = new FakeAuthenticator();
    $options = RegistrationService::options(Schema::USER_CLIENT, 42, array('name' => 'a', 'displayName' => 'b'));
    $response = $authenticator->register($options['challenge']);
    RegistrationService::verify(Schema::USER_CLIENT, 42, $response);
    return ch247_pk_rejects(function () use ($response) {
        RegistrationService::verify(Schema::USER_CLIENT, 42, $response);
    }, 'challenge_replay');
};

$tests['A registration from a foreign origin is refused'] = function () {
    ch247_pk_fresh();
    ch247_pk_client(42);
    $authenticator = new FakeAuthenticator();
    $options = RegistrationService::options(Schema::USER_CLIENT, 42, array('name' => 'a', 'displayName' => 'b'));
    $response = $authenticator->register($options['challenge'], array('origin' => 'https://phish.example.net'));
    return ch247_pk_rejects(function () use ($response) {
        RegistrationService::verify(Schema::USER_CLIENT, 42, $response);
    }, 'origin_mismatch');
};

$tests['A registration for a different RP ID is refused'] = function () {
    ch247_pk_fresh();
    ch247_pk_client(42);
    $authenticator = new FakeAuthenticator();
    $options = RegistrationService::options(Schema::USER_CLIENT, 42, array('name' => 'a', 'displayName' => 'b'));
    $response = $authenticator->register($options['challenge'], array('rpId' => 'attacker.test'));
    return ch247_pk_rejects(function () use ($response) {
        RegistrationService::verify(Schema::USER_CLIENT, 42, $response);
    }, 'rpid_mismatch');
};

$tests['A registration without user presence is refused'] = function () {
    ch247_pk_fresh();
    ch247_pk_client(42);
    $authenticator = new FakeAuthenticator();
    $options = RegistrationService::options(Schema::USER_CLIENT, 42, array('name' => 'a', 'displayName' => 'b'));
    $response = $authenticator->register($options['challenge'], array('flags' => 0x44)); // UV|AT, no UP
    return ch247_pk_rejects(function () use ($response) {
        RegistrationService::verify(Schema::USER_CLIENT, 42, $response);
    }, 'user_not_present');
};

$tests['The same authenticator cannot be registered twice'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol();
    $options = RegistrationService::options(Schema::USER_CLIENT, 42, array('name' => 'a', 'displayName' => 'b'));
    $response = $authenticator->register($options['challenge']);
    return ch247_pk_rejects(function () use ($response) {
        RegistrationService::verify(Schema::USER_CLIENT, 42, $response);
    }, 'duplicate_credential');
};

$tests['The per-account credential limit is enforced'] = function () {
    ch247_pk_fresh(array('max_credentials_client' => '2'));
    ch247_pk_enrol(42);
    ch247_pk_enrol(42, new FakeAuthenticator());
    return ch247_pk_rejects(function () {
        RegistrationService::options(Schema::USER_CLIENT, 42, array('name' => 'a', 'displayName' => 'b'));
    }, 'max_credentials');
};

$tests['The WebAuthn user handle carries no personal data'] = function () {
    ch247_pk_fresh();
    ch247_pk_client(42, 'ada@example.com');
    $options = RegistrationService::options(Schema::USER_CLIENT, 42, array(
        'name' => 'ada@example.com', 'displayName' => 'Ada Ng',
    ));
    $handle = Base64Url::decode($options['user']['id']);
    return strpos($handle, 'ada@example.com') === false && strlen($handle) === 32;
};

// ------------------------------------------------------------- authentication

$tests['A real assertion authenticates the right account'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    $result = ch247_pk_authenticate($authenticator);
    return $result['user_id'] === 42 && $result['user_type'] === Schema::USER_CLIENT;
};

$tests['A tampered signature is rejected'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    return ch247_pk_rejects(function () use ($authenticator) {
        ch247_pk_authenticate($authenticator, array('corruptSignature' => true));
    }, 'invalid_signature');
};

$tests['An assertion replayed with the same challenge is rejected'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    $challenge = AuthenticationService::options('ada@example.com');
    $response = $authenticator->assert($challenge['challenge']);
    AuthenticationService::verify($response);
    return ch247_pk_rejects(function () use ($response) {
        AuthenticationService::verify($response);
    }, 'challenge_replay');
};

$tests['A registration assertion cannot be used to sign in'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    $challenge = AuthenticationService::options('ada@example.com');
    $response = $authenticator->assert($challenge['challenge'], array('type' => 'webauthn.create'));
    return ch247_pk_rejects(function () use ($response) {
        AuthenticationService::verify($response);
    }, 'type_mismatch');
};

$tests['A cloned authenticator is detected and disabled'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    ch247_pk_authenticate($authenticator);           // counter -> 1
    ch247_pk_authenticate($authenticator);           // counter -> 2
    $authenticator->signCount = 1;                   // clone with a stale counter
    $detected = ch247_pk_rejects(function () use ($authenticator) {
        ch247_pk_authenticate($authenticator, array('keepCounter' => true));
    }, 'counter_replay');
    $stored = CredentialRepository::findByCredentialId(Base64Url::encode($authenticator->credentialId));
    return $detected && $stored['status'] === Schema::STATUS_DISABLED;
};

$tests['A revoked passkey can no longer sign in'] = function () {
    ch247_pk_fresh();
    list($authenticator, $credential) = ch247_pk_enrol(42);
    CredentialRepository::setStatus($credential['id'], Schema::STATUS_REVOKED);
    return ch247_pk_rejects(function () use ($authenticator) {
        ch247_pk_authenticate($authenticator);
    }, 'credential_inactive');
};

$tests['A closed account cannot sign in with a valid passkey'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    ch247_pk_client(42, 'ada@example.com', 'Closed');
    return ch247_pk_rejects(function () use ($authenticator) {
        ch247_pk_authenticate($authenticator);
    }, 'account_inactive');
};

$tests['A mismatched user handle is refused'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    return ch247_pk_rejects(function () use ($authenticator) {
        ch247_pk_authenticate($authenticator, array('userHandle' => Base64Url::encode('someone-else')));
    }, 'user_handle_mismatch');
};

$tests['Authentication options do not reveal whether an account exists'] = function () {
    ch247_pk_fresh();
    ch247_pk_enrol(42);
    $known = AuthenticationService::options('ada@example.com');
    $unknown = AuthenticationService::options('nobody@example.com');
    return array_keys($known) === array_keys($unknown)
        && $unknown['allowCredentials'] === array()
        && strlen($unknown['challenge']) === strlen($known['challenge']);
};

$tests['A challenge issued to one session cannot be used by another'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    $challenge = AuthenticationService::options('ada@example.com');
    $_SESSION['ch247_passkey_sid'] = 'a-different-browser';
    $response = $authenticator->assert($challenge['challenge']);
    return ch247_pk_rejects(function () use ($response) {
        AuthenticationService::verify($response);
    }, 'session_mismatch');
};

$tests['An expired challenge is refused'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    $challenge = AuthenticationService::options('ada@example.com');
    Capsule::table(Schema::CHALLENGES)
        ->where('challenge_hash', ChallengeRepository::hash($challenge['challenge']))
        ->update(array('expires_at' => date('Y-m-d H:i:s', time() - 10)));
    $response = $authenticator->assert($challenge['challenge']);
    return ch247_pk_rejects(function () use ($response) {
        AuthenticationService::verify($response);
    }, 'challenge_expired');
};

// ------------------------------------------------------------------ rate limit

$tests['Repeated failures trigger a temporary lockout, never a permanent one'] = function () {
    ch247_pk_fresh(array('rate_limit_attempts' => '3', 'lockout_seconds' => '900'));
    list($authenticator) = ch247_pk_enrol(42);
    for ($attempt = 0; $attempt < 3; $attempt++) {
        ch247_pk_rejects(function () use ($authenticator) {
            ch247_pk_authenticate($authenticator, array('corruptSignature' => true));
        }, 'invalid_signature');
    }
    $locked = ch247_pk_rejects(function () use ($authenticator) {
        ch247_pk_authenticate($authenticator);
    }, 'rate_limited');

    // The lockout must expire by itself.
    Capsule::table(Schema::RATE_LIMITS)->update(array('locked_until' => date('Y-m-d H:i:s', time() - 5)));
    $recovered = ch247_pk_authenticate($authenticator);
    return $locked && $recovered['user_id'] === 42;
};

$tests['A successful sign-in clears the failure counter'] = function () {
    ch247_pk_fresh(array('rate_limit_attempts' => '5'));
    list($authenticator) = ch247_pk_enrol(42);
    ch247_pk_rejects(function () use ($authenticator) {
        ch247_pk_authenticate($authenticator, array('corruptSignature' => true));
    }, 'invalid_signature');
    ch247_pk_authenticate($authenticator);
    return (int) Capsule::table(Schema::RATE_LIMITS)->count() === 0;
};

// ---------------------------------------------------------------------- policy

$tests['Enforcement is never applied to an account with no passkey'] = function () {
    ch247_pk_fresh(array('client_policy' => Schema::ENFORCE_ALL));
    ch247_pk_client(77);
    $policy = PolicyService::resolve(Schema::USER_CLIENT, 77);
    return $policy['required'] === false && $policy['reason'] === 'enrollment_pending';
};

$tests['Global enforcement applies once an account is enrolled'] = function () {
    ch247_pk_fresh(array('client_policy' => Schema::ENFORCE_ALL, 'password_fallback' => '0'));
    ch247_pk_enrol(42);
    $policy = PolicyService::resolve(Schema::USER_CLIENT, 42);
    return $policy['required'] === true && $policy['passwordFallback'] === false;
};

$tests['A per-account policy overrides the global default'] = function () {
    ch247_pk_fresh(array('client_policy' => Schema::ENFORCE_ALL));
    ch247_pk_enrol(42);
    PolicyService::setAccountPolicy(Schema::USER_CLIENT, 42, Schema::POLICY_DISABLED, 1);
    $policy = PolicyService::resolve(Schema::USER_CLIENT, 42);
    return $policy['required'] === false && $policy['passwordFallback'] === true;
};

$tests['A broken configuration never locks anybody out'] = function () {
    ch247_pk_fresh(array('client_policy' => Schema::ENFORCE_ALL, 'password_fallback' => '0'));
    ch247_pk_enrol(42);
    SettingsRepository::save(array('allowed_origins' => ''));
    SettingsRepository::flush();
    $policy = PolicyService::resolve(Schema::USER_CLIENT, 42);
    return $policy['required'] === false
        && $policy['reason'] === 'configuration_required'
        && $policy['passwordFallback'] === true;
};

// --------------------------------------------------------- sensitive actions

$tests['A sensitive action confirmation is single use and action bound'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    $options = ActionConfirmationService::options(Schema::USER_CLIENT, 42, 'email_change');
    $response = $authenticator->assert($options['challenge']);
    $confirmation = ActionConfirmationService::verify(Schema::USER_CLIENT, 42, 'email_change', $response);

    // Wrong action must not be authorised by this token.
    if (ActionConfirmationService::consume($confirmation['token'], Schema::USER_CLIENT, 42, 'payment_method_add')) {
        return false;
    }
    if (!ActionConfirmationService::consume($confirmation['token'], Schema::USER_CLIENT, 42, 'email_change')) {
        return false;
    }
    // ...and only once.
    return !ActionConfirmationService::consume($confirmation['token'], Schema::USER_CLIENT, 42, 'email_change');
};

$tests['A confirmation cannot be obtained with another account\'s passkey'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    ch247_pk_client(99, 'bob@example.com');
    $options = ActionConfirmationService::options(Schema::USER_CLIENT, 42, 'email_change');
    $response = $authenticator->assert($options['challenge']);
    return ch247_pk_rejects(function () use ($response) {
        ActionConfirmationService::verify(Schema::USER_CLIENT, 99, 'email_change', $response);
    }, 'user_mismatch');
};

$tests['Unknown sensitive actions are refused'] = function () {
    ch247_pk_fresh();
    ch247_pk_enrol(42);
    return ch247_pk_rejects(function () {
        ActionConfirmationService::options(Schema::USER_CLIENT, 42, 'delete_everything');
    }, 'invalid_request');
};

// ---------------------------------------------------------- password reset

$tests['A passkey can reset the account password'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    $options = PasswordResetService::options('ada@example.com');
    $response = $authenticator->assert($options['challenge']);
    $authorization = PasswordResetService::verify($response);
    PasswordResetService::complete($authorization['token'], 'Correct-Horse-9-Battery');
    $updates = $GLOBALS['CH247_PK_PASSWORD_UPDATES'];
    return count($updates) === 1 && $updates[0]['clientid'] === 42;
};

$tests['A reset authorization is single use'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    $options = PasswordResetService::options('ada@example.com');
    $authorization = PasswordResetService::verify($authenticator->assert($options['challenge']));
    PasswordResetService::complete($authorization['token'], 'Correct-Horse-9-Battery');
    return ch247_pk_rejects(function () use ($authorization) {
        PasswordResetService::complete($authorization['token'], 'Another-Strong-1-Password');
    }, 'challenge_replay');
};

$tests['Weak reset passwords are refused'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    $options = PasswordResetService::options('ada@example.com');
    $authorization = PasswordResetService::verify($authenticator->assert($options['challenge']));
    return ch247_pk_rejects(function () use ($authorization) {
        PasswordResetService::complete($authorization['token'], 'password');
    }, 'weak_password');
};

$tests['A reset always requires user verification'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    $options = PasswordResetService::options('ada@example.com');
    if ($options['userVerification'] !== 'required') { return false; }
    $response = $authenticator->assert($options['challenge'], array('flags' => 0x01)); // UP only
    return ch247_pk_rejects(function () use ($response) {
        PasswordResetService::verify($response);
    }, 'user_not_verified');
};

$tests['Reset options do not reveal whether an account exists'] = function () {
    ch247_pk_fresh();
    ch247_pk_enrol(42);
    $unknown = PasswordResetService::options('ghost@example.com');
    return $unknown['allowCredentials'] === array() && $unknown['challenge'] !== '';
};

// -------------------------------------------------------------- activity log

$tests['Security events are recorded without any secret material'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    ch247_pk_authenticate($authenticator);
    ch247_pk_rejects(function () use ($authenticator) {
        ch247_pk_authenticate($authenticator, array('corruptSignature' => true));
    }, 'invalid_signature');

    $events = EventLog::search(array('user_id' => 42));
    if ($events['total'] < 3) { return false; }
    $serialised = json_encode($events['items']);
    // "signature" legitimately appears inside the failure reason code, so the
    // check targets the payload field names that would carry real material.
    foreach (array('PRIVATE KEY', 'clientDataJSON', 'attestationObject', 'authenticatorData') as $forbidden) {
        if (stripos($serialised, $forbidden) !== false) { return false; }
    }
    $types = array();
    foreach ($events['items'] as $event) { $types[] = $event['event_type']; }
    return in_array(EventLog::REGISTERED, $types, true)
        && in_array(EventLog::AUTH_SUCCESS, $types, true)
        && in_array(EventLog::AUTH_FAILED, $types, true);
};

$tests['Log scrubbing redacts anything that looks like a secret'] = function () {
    $scrubbed = Log::scrub(array(
        'challenge' => 'abc',
        'signature' => 'def',
        'credential_id' => 'ghi',
        'device_name' => 'iPhone',
    ));
    return $scrubbed['device_name'] === 'iPhone'
        && $scrubbed['challenge'] !== 'abc'
        && $scrubbed['signature'] !== 'def'
        && $scrubbed['credential_id'] !== 'ghi';
};

$tests['Activity retention prunes only old records'] = function () {
    ch247_pk_fresh(array('event_retention_days' => '30'));
    ch247_pk_enrol(42);
    Capsule::table(Schema::EVENTS)->update(array('created_at' => date('Y-m-d H:i:s', time() - (40 * 86400))));
    EventLog::record('auth.success', array('user_type' => Schema::USER_CLIENT, 'user_id' => 42, 'success' => true));
    $removed = EventLog::prune();
    return $removed >= 1 && (int) Capsule::table(Schema::EVENTS)->count() === 1;
};

// ---------------------------------------------------------------- admin view

$tests['The admin credential list exposes metadata only'] = function () {
    ch247_pk_fresh();
    ch247_pk_enrol(42);
    $list = AdminController::credentialList(array());
    if ($list['total'] !== 1) { return false; }
    $item = $list['items'][0];
    return !array_key_exists('public_key', $item)
        && !array_key_exists('credential_id', $item)
        && $item['user_label'] !== ''
        && $item['reference'] !== '';
};

$tests['Admin actions require a valid CSRF token'] = function () {
    ch247_pk_fresh();
    list(, $credential) = ch247_pk_enrol(42);
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_SESSION['adminid'] = 1;
    $_REQUEST = array();
    $view = AdminController::handle(array(), array('action' => 'revoke_credential', 'credential_id' => $credential['id']));
    $stillActive = CredentialRepository::find($credential['id']);
    return $view['errors'] !== array() && $stillActive['status'] === Schema::STATUS_ACTIVE;
};

$tests['An admin can revoke a passkey with a valid token'] = function () {
    ch247_pk_fresh();
    list(, $credential) = ch247_pk_enrol(42);
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_SESSION['adminid'] = 1;
    $_REQUEST = array('token' => str_repeat('ab', 16));
    AdminController::handle(array(), array(
        'action' => 'revoke_credential',
        'credential_id' => $credential['id'],
        'token' => str_repeat('ab', 16),
    ));
    $stored = CredentialRepository::find($credential['id']);
    return $stored['status'] === Schema::STATUS_REVOKED;
};

$tests['An unauthorised admin sees nothing and changes nothing'] = function () {
    ch247_pk_fresh();
    list(, $credential) = ch247_pk_enrol(42);
    $GLOBALS['CH247_PK_ADMIN_DENIED'] = true;
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_REQUEST = array('token' => str_repeat('ab', 16));
    $view = AdminController::handle(array(), array(
        'action' => 'revoke_credential',
        'credential_id' => $credential['id'],
        'token' => str_repeat('ab', 16),
    ));
    $stored = CredentialRepository::find($credential['id']);
    return $view['authorised'] === false
        && !isset($view['credentials'])
        && $stored['status'] === Schema::STATUS_ACTIVE;
};

$tests['Settings are validated and clamped into range'] = function () {
    ch247_pk_fresh();
    SettingsRepository::save(array(
        'challenge_ttl' => '99999',
        'rate_limit_attempts' => '1',
        'client_policy' => 'nonsense',
        'max_credentials_client' => '-4',
    ));
    SettingsRepository::flush();
    return SettingsRepository::int('challenge_ttl') === 600
        && SettingsRepository::int('rate_limit_attempts') === 3
        && SettingsRepository::get('client_policy') === Schema::ENFORCE_OPTIONAL
        && SettingsRepository::int('max_credentials_client') === 1;
};

$tests['Secrets are never returned by the settings reader'] = function () {
    ch247_pk_fresh();
    $GLOBALS['cc_encryption_hash'] = 'test-installation-hash';
    SettingsRepository::save(array('entra_client_secret' => 'super-secret-value'));
    SettingsRepository::flush();
    $all = SettingsRepository::all();
    $stored = Capsule::table(Schema::SETTINGS)->where('setting_key', 'entra_client_secret')->first();
    return $all['entra_client_secret'] === '********'
        && strpos((string) $stored->setting_value, 'super-secret-value') === false
        && SettingsRepository::secret('entra_client_secret') === 'super-secret-value';
};

// ------------------------------------------------------------------ ownership

$tests['Credentials cannot be reached across account boundaries'] = function () {
    ch247_pk_fresh();
    list(, $credential) = ch247_pk_enrol(42);
    ch247_pk_client(99, 'bob@example.com');
    return CredentialRepository::findOwned($credential['id'], Schema::USER_CLIENT, 99) === null
        && CredentialRepository::findOwned($credential['id'], Schema::USER_ADMIN, 42) === null
        && CredentialRepository::findOwned($credential['id'], Schema::USER_CLIENT, 42) !== null;
};

$tests['A client passkey cannot authenticate an administrator'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    ch247_pk_admin(1);
    $result = ch247_pk_authenticate($authenticator);
    return $result['user_type'] === Schema::USER_CLIENT;
};

// -------------------------------------------------------------- housekeeping

$tests['Housekeeping clears expired challenges and stale lockouts'] = function () {
    ch247_pk_fresh();
    ch247_pk_enrol(42);
    AuthenticationService::options('ada@example.com');
    Capsule::table(Schema::CHALLENGES)->update(array('expires_at' => date('Y-m-d H:i:s', time() - 7200)));
    RateLimiter::fail('auth', '198.51.100.7');
    Capsule::table(Schema::RATE_LIMITS)->update(array('updated_at' => date('Y-m-d H:i:s', time() - 172800)));

    ChallengeRepository::purgeExpired();
    RateLimiter::prune();
    return (int) Capsule::table(Schema::CHALLENGES)->count() === 0
        && (int) Capsule::table(Schema::RATE_LIMITS)->count() === 0;
};

// ---------------------------------------------------------------- cbor / cose

$tests['CBOR rejects malformed and hostile input'] = function () {
    $rejects = 0;
    $cases = array(
        "\x5f\x41\x61\xff",                 // indefinite-length byte string
        "\xa2\x01\x02\x01\x03",             // duplicate map key
        "\x01\x02",                         // trailing bytes
        "\x82\x01",                         // truncated array
    );
    foreach ($cases as $case) {
        try {
            Cbor::decodeAll($case);
        } catch (PasskeyException $e) {
            $rejects++;
        }
    }
    return $rejects === count($cases);
};

$tests['COSE rejects EdDSA and undersized RSA keys'] = function () {
    $eddsa = ch247_pk_rejects(function () {
        Cose::toPem(array(1 => Cose::KTY_OKP, 3 => Cose::ALG_EDDSA, -2 => str_repeat("\x01", 32)));
    }, 'unsupported_algorithm');
    $smallRsa = ch247_pk_rejects(function () {
        Cose::toPem(array(1 => Cose::KTY_RSA, 3 => Cose::ALG_RS256,
            -1 => str_repeat("\x01", 128), -2 => "\x01\x00\x01"));
    }, 'weak_credential');
    return $eddsa && $smallRsa;
};

$tests['A COSE key round-trips to a PEM OpenSSL accepts'] = function () {
    ch247_pk_fresh();
    list($authenticator) = ch247_pk_enrol(42);
    $stored = CredentialRepository::findByCredentialId(Base64Url::encode($authenticator->credentialId));
    $key = @openssl_pkey_get_public($stored['public_key']);
    return $key !== false;
};

// ------------------------------------------------------------------------- run

$failed = 0;
foreach ($tests as $name => $test) {
    try {
        $ok = $test();
    } catch (\Throwable $e) {
        echo 'not ok - ' . $name . ': ' . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ")\n";
        $failed++;
        continue;
    }
    if (!$ok) {
        echo 'not ok - ' . $name . "\n";
        $failed++;
    } else {
        echo 'ok - ' . $name . "\n";
    }
}
echo $failed === 0 ? "All passkey tests passed.\n" : $failed . " passkey test(s) failed.\n";
if ($failed > 0) {
    exit(1);
}
