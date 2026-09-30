<?php
/**
 * Passkey-based password reset (spec §11).
 *
 * A user who still holds a registered passkey can prove possession and set a
 * new password without an emailed link. The flow is:
 *
 *   1. options()  — issue a reset challenge for the named account,
 *   2. verify()   — validate the assertion and mint a single-use, short-lived,
 *                   session-bound authorization,
 *   3. complete() — consume the authorization and set the new password.
 *
 * Security properties: the ceremony always requires user verification (the
 * passkey alone is possession; a reset needs possession *and* the user), the
 * authorization is never emailed or exposed in a URL, and completing a reset
 * optionally invalidates other sessions.
 */

namespace CloudHost247\Passkey;

use WHMCS\Database\Capsule;

final class PasswordResetService
{
    public static function isEnabled()
    {
        return SettingsRepository::bool('password_reset_enabled') && Config::isOperational();
    }

    /**
     * Enumeration-safe: an unknown or non-enrolled account still receives a
     * syntactically valid challenge with an empty credential list.
     */
    public static function options($identifier, $userType = Schema::USER_CLIENT)
    {
        if (!self::isEnabled()) {
            throw new ConfigurationException('Passkey password reset is not available.');
        }
        $rp = Config::relyingParty();
        RateLimiter::assert('reset', EventLog::clientIp());

        $user = UserDirectory::resolve($identifier, $userType);
        $allow = array();
        if ($user) {
            foreach (CredentialRepository::activeForUser($user['user_type'], $user['user_id']) as $credential) {
                $allow[] = array('type' => 'public-key', 'id' => (string) $credential['credential_id']);
            }
        }

        $challenge = ChallengeRepository::issue(
            Schema::CHALLENGE_PASSWORD_RESET,
            $user ? $user['user_type'] : null,
            $user ? $user['user_id'] : null,
            array('rp_id' => $rp['rpId'])
        );

        return array(
            'challenge' => $challenge['challenge'],
            'timeout' => $challenge['expires_in'] * 1000,
            'rpId' => $rp['rpId'],
            'allowCredentials' => $allow,
            // A reset always demands user verification, regardless of the
            // global login setting.
            'userVerification' => 'required',
        );
    }

    /** @return array{token:string,expires_in:int} */
    public static function verify(array $response)
    {
        if (!self::isEnabled()) {
            throw new ConfigurationException('Passkey password reset is not available.');
        }
        $rp = Config::relyingParty();
        $ip = EventLog::clientIp();
        $credential = null;

        try {
            $inner = isset($response['response']) && is_array($response['response']) ? $response['response'] : $response;
            $rawId = isset($response['id']) ? (string) $response['id'] : '';
            $challengeValue = RegistrationService::challengeFromClientData(
                isset($inner['clientDataJSON']) ? (string) $inner['clientDataJSON'] : ''
            );
            $challengeRow = ChallengeRepository::consume($challengeValue, Schema::CHALLENGE_PASSWORD_RESET);

            $credential = CredentialRepository::findByCredentialId($rawId);
            if (!$credential || (string) $credential['status'] !== Schema::STATUS_ACTIVE) {
                throw new PasskeyException('This passkey is not recognised.', 'unknown_credential');
            }
            if ($challengeRow['user_id'] !== null
                && ((int) $challengeRow['user_id'] !== (int) $credential['user_id']
                    || (string) $challengeRow['user_type'] !== (string) $credential['user_type'])) {
                throw new PasskeyException('This passkey does not belong to that account.', 'user_mismatch');
            }
            if (!UserDirectory::isActive($credential['user_type'], $credential['user_id'])) {
                throw new PasskeyException('This account cannot be reset.', 'account_inactive');
            }

            $result = CredentialVerifier::verifyAssertion($inner, $credential, array(
                'challenge' => $challengeValue,
                'origins' => $rp['origins'],
                'rpId' => $rp['rpId'],
                'requireUserVerification' => true,
            ));

            CredentialRepository::recordUse($credential['id'], $result['signCount'], $ip);
            RateLimiter::clear('reset', $ip);

            $token = Base64Url::encode(random_bytes(32));
            $ttl = max(60, min(3600, SettingsRepository::int('reset_authorization_ttl')));
            Capsule::table(Schema::CHALLENGES)->insert(array(
                'challenge_hash' => ChallengeRepository::hash($token),
                'challenge' => $token,
                'user_type' => (string) $credential['user_type'],
                'user_id' => (int) $credential['user_id'],
                'challenge_type' => Schema::CHALLENGE_RESET_TOKEN,
                'action' => 'password_reset',
                'session_id' => ChallengeRepository::sessionFingerprint(),
                'rp_id' => $rp['rpId'],
                'metadata' => null,
                'expires_at' => date('Y-m-d H:i:s', time() + $ttl),
                'created_at' => date('Y-m-d H:i:s'),
            ));

            return array(
                'token' => $token,
                'expires_in' => $ttl,
                'user_type' => (string) $credential['user_type'],
                'user_id' => (int) $credential['user_id'],
            );
        } catch (PasskeyException $e) {
            RateLimiter::fail('reset', $ip);
            EventLog::failure(EventLog::PASSWORD_RESET_FAILED, $e->reason(), array(
                'user_type' => $credential ? $credential['user_type'] : null,
                'user_id' => $credential ? $credential['user_id'] : null,
            ));
            throw $e;
        }
    }

    /** Consumes the authorization and writes the new password. */
    public static function complete($token, $newPassword)
    {
        if (!self::isEnabled()) {
            throw new ConfigurationException('Passkey password reset is not available.');
        }
        $row = ChallengeRepository::consume($token, Schema::CHALLENGE_RESET_TOKEN, array('action' => 'password_reset'));
        $userType = (string) $row['user_type'];
        $userId = (int) $row['user_id'];

        self::assertPasswordAcceptable($newPassword);

        $updated = self::writePassword($userType, $userId, $newPassword);
        if (!$updated) {
            EventLog::failure(EventLog::PASSWORD_RESET_FAILED, 'update_failed', array(
                'user_type' => $userType, 'user_id' => $userId,
            ));
            throw new PasskeyException('The password could not be updated.', 'update_failed');
        }

        if (SettingsRepository::bool('reset_invalidates_sessions')) {
            SessionManager::invalidateOtherSessions($userType, $userId);
        }

        EventLog::success(EventLog::PASSWORD_RESET, array('user_type' => $userType, 'user_id' => $userId));
        NotificationService::securityEvent($userType, $userId, 'password_reset_via_passkey');
        return true;
    }

    /**
     * Minimum policy applied by this addon. WHMCS may apply stricter rules of
     * its own through the update path; this is the floor, not the ceiling.
     */
    public static function assertPasswordAcceptable($password)
    {
        $password = (string) $password;
        if (strlen($password) < 12) {
            throw new PasskeyException('The new password must be at least 12 characters long.', 'weak_password');
        }
        if (strlen($password) > 200) {
            throw new PasskeyException('The new password is too long.', 'weak_password');
        }
        $classes = 0;
        $classes += preg_match('/[a-z]/', $password) ? 1 : 0;
        $classes += preg_match('/[A-Z]/', $password) ? 1 : 0;
        $classes += preg_match('/[0-9]/', $password) ? 1 : 0;
        $classes += preg_match('/[^a-zA-Z0-9]/', $password) ? 1 : 0;
        if ($classes < 3) {
            throw new PasskeyException('The new password must mix upper case, lower case, digits or symbols.', 'weak_password');
        }
        return true;
    }

    /**
     * Uses the supported WHMCS API for clients so hashing, history and hooks
     * all behave exactly as they do for a normal password change.
     */
    private static function writePassword($userType, $userId, $newPassword)
    {
        try {
            if ($userType === Schema::USER_CLIENT && function_exists('localAPI')) {
                $result = \localAPI('UpdateClient', array(
                    'clientid' => (int) $userId,
                    'password2' => $newPassword,
                ));
                return is_array($result) && isset($result['result']) && $result['result'] === 'success';
            }
            if ($userType === Schema::USER_ADMIN) {
                // WHMCS exposes no supported admin password API; an admin reset
                // is therefore refused rather than performed with a direct
                // write we cannot guarantee is hashed the same way.
                throw new PasskeyException('Administrator passwords cannot be reset this way.', 'unsupported');
            }
            return false;
        } catch (PasskeyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('reset.update_failed', array('error' => Log::safeError($e)));
            return false;
        }
    }
}
