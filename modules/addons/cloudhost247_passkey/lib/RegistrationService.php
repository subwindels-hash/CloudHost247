<?php
/**
 * WebAuthn registration ceremony (spec §3, §5, Phase 3).
 *
 * options() issues a server-generated challenge and the creation parameters;
 * verify() validates the browser's response end to end and stores the
 * credential. Nothing is stored until every check has passed.
 */

namespace CloudHost247\Passkey;

final class RegistrationService
{
    /**
     * @param string $userType Schema::USER_CLIENT|USER_ADMIN
     * @param int    $userId
     * @param array  $identity {name, displayName}
     * @return array publicKey creation options for navigator.credentials.create()
     */
    public static function options($userType, $userId, array $identity)
    {
        self::assertEnabled();
        $rp = Config::relyingParty();

        if (!Schema::isUserType($userType) || (int) $userId <= 0) {
            throw new PasskeyException('Unknown account.', 'invalid_request');
        }

        RateLimiter::assert('register', $userType . ':' . $userId);

        $max = PolicyService::maxCredentials($userType);
        $existing = CredentialRepository::listForUser($userType, $userId);
        if (count($existing) >= $max) {
            throw new PasskeyException('The maximum number of passkeys for this account has been reached.', 'max_credentials');
        }

        $challenge = ChallengeRepository::issue(Schema::CHALLENGE_REGISTRATION, $userType, $userId, array(
            'rp_id' => $rp['rpId'],
        ));

        $exclude = array();
        foreach ($existing as $credential) {
            $exclude[] = array(
                'type' => 'public-key',
                'id' => (string) $credential['credential_id'],
                'transports' => $credential['transports'] !== '' ? explode(',', (string) $credential['transports']) : array(),
            );
        }

        $params = array();
        foreach (Cose::supportedAlgorithms() as $alg) {
            $params[] = array('type' => 'public-key', 'alg' => $alg);
        }

        return array(
            'rp' => array('name' => $rp['rpName'], 'id' => $rp['rpId']),
            'user' => array(
                // The user handle is opaque and stable, and deliberately not the
                // email address: WebAuthn user handles must not carry PII.
                'id' => self::userHandle($userType, $userId),
                'name' => mb_substr((string) (isset($identity['name']) ? $identity['name'] : 'user'), 0, 64),
                'displayName' => mb_substr((string) (isset($identity['displayName']) ? $identity['displayName'] : 'CloudHost247 user'), 0, 64),
            ),
            'challenge' => $challenge['challenge'],
            'pubKeyCredParams' => $params,
            'timeout' => $challenge['expires_in'] * 1000,
            'attestation' => 'none',
            'excludeCredentials' => $exclude,
            'authenticatorSelection' => array(
                'residentKey' => (string) SettingsRepository::get('resident_key', 'preferred'),
                'requireResidentKey' => SettingsRepository::get('resident_key', 'preferred') === 'required',
                'userVerification' => (string) SettingsRepository::get('user_verification', 'preferred'),
            ),
            'extensions' => array('credProps' => true),
        );
    }

    /**
     * @param array $response the browser's PublicKeyCredential JSON
     * @return array the stored credential (public view)
     */
    public static function verify($userType, $userId, array $response, $deviceName = '')
    {
        self::assertEnabled();
        $rp = Config::relyingParty();

        try {
            $inner = isset($response['response']) && is_array($response['response']) ? $response['response'] : $response;
            $clientDataJson = isset($inner['clientDataJSON']) ? (string) $inner['clientDataJSON'] : '';
            $challengeValue = self::challengeFromClientData($clientDataJson);

            // Consume first: a failed verification must not leave the challenge
            // reusable with a corrected payload.
            ChallengeRepository::consume($challengeValue, Schema::CHALLENGE_REGISTRATION, array(
                'user_type' => $userType,
                'user_id' => $userId,
            ));

            $verified = CredentialVerifier::verifyRegistration($inner, array(
                'challenge' => $challengeValue,
                'origins' => $rp['origins'],
                'rpId' => $rp['rpId'],
                'requireUserVerification' => SettingsRepository::get('user_verification', 'preferred') === 'required',
            ));

            if (CredentialRepository::findByCredentialId($verified['credential_id']) !== null) {
                throw new PasskeyException('This authenticator is already registered.', 'duplicate_credential');
            }

            // Re-check the quota inside the verify step: two parallel
            // registrations must not both slip past the options() check.
            if (CredentialRepository::countActive($userType, $userId) >= PolicyService::maxCredentials($userType)) {
                throw new PasskeyException('The maximum number of passkeys for this account has been reached.', 'max_credentials');
            }

            $transports = array();
            if (isset($response['transports']) && is_array($response['transports'])) {
                foreach ($response['transports'] as $transport) {
                    if (preg_match('/^[a-z-]{1,16}$/', (string) $transport)) {
                        $transports[] = (string) $transport;
                    }
                }
            }

            $stored = CredentialRepository::create(array(
                'user_type' => $userType,
                'user_id' => $userId,
                'credential_id' => $verified['credential_id'],
                'public_key' => $verified['public_key'],
                'algorithm' => $verified['algorithm'],
                'sign_count' => $verified['sign_count'],
                'transports' => implode(',', array_slice($transports, 0, 6)),
                'aaguid' => $verified['aaguid'],
                'attestation_format' => $verified['attestation_format'],
                'device_name' => $deviceName !== '' ? $deviceName : DeviceNamer::suggest(EventLog::userAgent(), $transports),
                'backup_eligible' => $verified['backup_eligible'],
                'backup_state' => $verified['backup_state'],
                'user_verified' => $verified['user_verified'],
                'registration_ip' => EventLog::clientIp(),
                'registration_user_agent' => EventLog::userAgent(),
            ));

            RateLimiter::clear('register', $userType . ':' . $userId);
            EventLog::success(EventLog::REGISTERED, array(
                'user_type' => $userType,
                'user_id' => $userId,
                'passkey_id' => $stored['id'],
                'metadata' => array('device_name' => $stored['device_name'], 'algorithm' => $stored['algorithm']),
            ));
            NotificationService::securityEvent($userType, $userId, 'passkey_registered', array(
                'device_name' => $stored['device_name'],
            ));

            return CredentialRepository::toPublicArray($stored);
        } catch (PasskeyException $e) {
            RateLimiter::fail('register', $userType . ':' . $userId);
            EventLog::failure(EventLog::REGISTRATION_FAILED, $e->reason(), array(
                'user_type' => $userType,
                'user_id' => $userId,
            ));
            throw $e;
        }
    }

    /** Stable, non-reversible WebAuthn user handle (never the email address). */
    public static function userHandle($userType, $userId)
    {
        return Base64Url::encode(hash('sha256', 'cloudhost247-passkey-user:' . $userType . ':' . (int) $userId, true));
    }

    public static function challengeFromClientData($clientDataJson)
    {
        $raw = Base64Url::decode($clientDataJson);
        if ($raw === null) {
            throw new PasskeyException('Malformed clientDataJSON.', 'malformed_response');
        }
        $data = json_decode($raw, true);
        if (!is_array($data) || !isset($data['challenge']) || !is_string($data['challenge'])) {
            throw new PasskeyException('Malformed clientDataJSON.', 'malformed_response');
        }
        return (string) $data['challenge'];
    }

    private static function assertEnabled()
    {
        if (!SettingsRepository::bool('enabled')) {
            throw new ConfigurationException('Passkey authentication is disabled.');
        }
    }
}
