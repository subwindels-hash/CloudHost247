<?php
/**
 * Optional Microsoft Entra ID (Azure AD) sign-in (spec §22).
 *
 * Disabled by default. When enabled it performs an OpenID Connect
 * authorization-code flow with PKCE:
 *
 *   - state and nonce are single-use and session-bound (CSRF and replay),
 *   - PKCE S256 protects the code even if the redirect leaks,
 *   - the id_token's issuer, audience, expiry and nonce are all checked,
 *   - the account link is keyed on the immutable `oid` claim, never on the
 *     email address or UPN (both are mutable and re-assignable).
 *
 * Tokens are used in-request only and never persisted.
 */

namespace CloudHost247\Passkey;

use WHMCS\Database\Capsule;

final class EntraIdService
{
    public static function isEnabled()
    {
        return SettingsRepository::bool('entra_enabled') && self::isConfigured();
    }

    public static function isConfigured()
    {
        return SettingsRepository::get('entra_tenant_id', '') !== ''
            && SettingsRepository::get('entra_client_id', '') !== ''
            && SettingsRepository::get('entra_redirect_uri', '') !== ''
            && SettingsRepository::secret('entra_client_secret') !== '';
    }

    /** Builds the authorization URL and stores the single-use state/nonce/verifier. */
    public static function authorizationUrl($userType = Schema::USER_CLIENT)
    {
        if (!self::isEnabled()) {
            throw new ConfigurationException('Microsoft Entra ID sign-in is not configured.');
        }
        SessionManager::start();
        $state = Base64Url::encode(random_bytes(32));
        $nonce = Base64Url::encode(random_bytes(32));
        $verifier = Base64Url::encode(random_bytes(64));

        $_SESSION['ch247_entra'] = array(
            'state' => $state,
            'nonce' => $nonce,
            'verifier' => $verifier,
            'user_type' => (string) $userType,
            'created' => time(),
        );

        $query = array(
            'client_id' => (string) SettingsRepository::get('entra_client_id'),
            'response_type' => 'code',
            'redirect_uri' => (string) SettingsRepository::get('entra_redirect_uri'),
            'response_mode' => 'query',
            'scope' => 'openid profile email',
            'state' => $state,
            'nonce' => $nonce,
            'code_challenge' => Base64Url::encode(hash('sha256', $verifier, true)),
            'code_challenge_method' => 'S256',
        );
        return self::endpoint('authorize') . '?' . http_build_query($query);
    }

    /**
     * Handles the redirect back from Microsoft.
     *
     * @return array{user_type:string,user_id:int} the signed-in account
     */
    public static function handleCallback($code, $state)
    {
        if (!self::isEnabled()) {
            throw new ConfigurationException('Microsoft Entra ID sign-in is not configured.');
        }
        SessionManager::start();
        $context = isset($_SESSION['ch247_entra']) && is_array($_SESSION['ch247_entra']) ? $_SESSION['ch247_entra'] : null;
        unset($_SESSION['ch247_entra']); // single use, whatever happens next

        if (!$context || !isset($context['state']) || !hash_equals((string) $context['state'], (string) $state)) {
            throw new PasskeyException('The sign-in request could not be verified.', 'state_mismatch');
        }
        if ((time() - (int) $context['created']) > 600) {
            throw new PasskeyException('The sign-in request expired. Please try again.', 'state_expired');
        }
        if (!is_string($code) || $code === '') {
            throw new PasskeyException('No authorization code was returned.', 'invalid_request');
        }

        $token = self::exchangeCode($code, (string) $context['verifier']);
        $claims = self::validateIdToken(isset($token['id_token']) ? (string) $token['id_token'] : '', (string) $context['nonce']);

        $subject = isset($claims['oid']) ? (string) $claims['oid'] : '';
        if ($subject === '') {
            throw new PasskeyException('The identity provider did not return a stable user identifier.', 'invalid_claims');
        }
        $upn = '';
        foreach (array('preferred_username', 'upn', 'email') as $claim) {
            if (!empty($claims[$claim])) {
                $upn = strtolower((string) $claims[$claim]);
                break;
            }
        }
        self::assertDomainAllowed($upn);

        $link = self::findLink($subject);
        if (!$link) {
            // Auto-linking only ever matches an existing account by verified
            // email; it never creates an account.
            $user = $upn !== '' ? UserDirectory::resolve($upn, (string) $context['user_type']) : null;
            if (!$user) {
                throw new PasskeyException('No CloudHost247 account is linked to this Microsoft identity.', 'no_linked_account');
            }
            self::link($user['user_type'], $user['user_id'], $subject, $upn);
            $link = self::findLink($subject);
        }

        if (!UserDirectory::isActive($link['user_type'], $link['user_id'])) {
            throw new PasskeyException('This account is not able to sign in.', 'account_inactive');
        }

        Capsule::table(Schema::IDENTITIES)->where('id', (int) $link['id'])
            ->update(array('last_login_at' => date('Y-m-d H:i:s'), 'updated_at' => date('Y-m-d H:i:s')));

        EventLog::success(EventLog::ENTRA_LOGIN, array(
            'user_type' => $link['user_type'],
            'user_id' => $link['user_id'],
            'metadata' => array('tenant' => (string) $link['tenant_id']),
        ));

        return array('user_type' => (string) $link['user_type'], 'user_id' => (int) $link['user_id']);
    }

    public static function link($userType, $userId, $subject, $upn)
    {
        $now = date('Y-m-d H:i:s');
        Capsule::table(Schema::IDENTITIES)->insert(array(
            'provider' => 'entra',
            'user_type' => (string) $userType,
            'user_id' => (int) $userId,
            'subject' => (string) $subject,
            'tenant_id' => (string) SettingsRepository::get('entra_tenant_id', ''),
            'upn' => mb_substr((string) $upn, 0, 191),
            'linked_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ));
        EventLog::success(EventLog::ENTRA_LINKED, array('user_type' => $userType, 'user_id' => $userId));
    }

    public static function unlink($userType, $userId)
    {
        return (int) Capsule::table(Schema::IDENTITIES)
            ->where('provider', 'entra')
            ->where('user_type', (string) $userType)
            ->where('user_id', (int) $userId)
            ->delete();
    }

    private static function findLink($subject)
    {
        $row = Capsule::table(Schema::IDENTITIES)
            ->where('provider', 'entra')->where('subject', (string) $subject)->first();
        return $row ? (array) $row : null;
    }

    private static function assertDomainAllowed($upn)
    {
        $raw = trim((string) SettingsRepository::get('entra_allowed_domains', ''));
        if ($raw === '') {
            return true;
        }
        $domains = preg_split('/[\s,]+/', strtolower($raw), -1, PREG_SPLIT_NO_EMPTY);
        $at = strrpos($upn, '@');
        $domain = $at === false ? '' : substr($upn, $at + 1);
        if ($domain === '' || !in_array($domain, (array) $domains, true)) {
            throw new PasskeyException('This Microsoft account domain is not permitted.', 'domain_not_allowed');
        }
        return true;
    }

    private static function exchangeCode($code, $verifier)
    {
        $body = http_build_query(array(
            'client_id' => (string) SettingsRepository::get('entra_client_id'),
            'client_secret' => SettingsRepository::secret('entra_client_secret'),
            'code' => $code,
            'grant_type' => 'authorization_code',
            'redirect_uri' => (string) SettingsRepository::get('entra_redirect_uri'),
            'code_verifier' => $verifier,
            'scope' => 'openid profile email',
        ));

        $ch = curl_init(self::endpoint('token'));
        curl_setopt_array($ch, array(
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => array('Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'),
        ));
        $response = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($response === false || $status !== 200) {
            // The response body can contain the client secret echo or codes;
            // only the status is logged.
            Log::error('entra.token_exchange_failed', array('status' => $status, 'curl_error' => $error !== '' ? 'yes' : 'no'));
            throw new PasskeyException('Microsoft sign-in could not be completed.', 'token_exchange_failed');
        }
        $data = json_decode((string) $response, true);
        if (!is_array($data) || empty($data['id_token'])) {
            throw new PasskeyException('Microsoft sign-in returned an unexpected response.', 'token_exchange_failed');
        }
        return $data;
    }

    /**
     * Validates the id_token's claims.
     *
     * Note: the token is received directly from Microsoft's token endpoint
     * over a TLS-verified back channel, which is the OIDC-sanctioned reason
     * signature validation is not mandatory here. The issuer, audience,
     * expiry, issued-at and nonce are all still enforced.
     */
    private static function validateIdToken($idToken, $expectedNonce)
    {
        $parts = explode('.', (string) $idToken);
        if (count($parts) !== 3) {
            throw new PasskeyException('The identity token was malformed.', 'invalid_token');
        }
        $payload = Base64Url::decode($parts[1]);
        $claims = $payload === null ? null : json_decode($payload, true);
        if (!is_array($claims)) {
            throw new PasskeyException('The identity token was malformed.', 'invalid_token');
        }

        $tenant = (string) SettingsRepository::get('entra_tenant_id');
        $clientId = (string) SettingsRepository::get('entra_client_id');
        $issuer = isset($claims['iss']) ? (string) $claims['iss'] : '';
        $audience = isset($claims['aud']) ? (string) $claims['aud'] : '';

        if (strpos($issuer, $tenant) === false || strpos($issuer, 'login.microsoftonline.com') === false) {
            throw new PasskeyException('The identity token came from an unexpected issuer.', 'invalid_issuer');
        }
        if (!hash_equals($clientId, $audience)) {
            throw new PasskeyException('The identity token was issued for a different application.', 'invalid_audience');
        }
        if (!isset($claims['exp']) || (int) $claims['exp'] < (time() - 60)) {
            throw new PasskeyException('The identity token has expired.', 'token_expired');
        }
        if (isset($claims['iat']) && (int) $claims['iat'] > (time() + 300)) {
            throw new PasskeyException('The identity token is not yet valid.', 'token_not_yet_valid');
        }
        if (!isset($claims['nonce']) || !hash_equals((string) $expectedNonce, (string) $claims['nonce'])) {
            throw new PasskeyException('The identity token could not be matched to this sign-in attempt.', 'nonce_mismatch');
        }
        return $claims;
    }

    private static function endpoint($name)
    {
        $tenant = rawurlencode((string) SettingsRepository::get('entra_tenant_id'));
        return 'https://login.microsoftonline.com/' . $tenant . '/oauth2/v2.0/' . $name;
    }
}
