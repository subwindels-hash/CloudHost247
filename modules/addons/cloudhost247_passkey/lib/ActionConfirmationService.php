<?php
/**
 * Passkey confirmation for sensitive actions (spec §8).
 *
 * A confirmation is a full WebAuthn assertion bound to one specific action
 * name. The resulting authorization is:
 *   - single-use,
 *   - short-lived,
 *   - bound to the acting user, the action, and the browser session.
 *
 * That binding is what stops a confirmation obtained for "add a contact"
 * being replayed to authorise "change the account email".
 */

namespace CloudHost247\Passkey;

use WHMCS\Database\Capsule;

final class ActionConfirmationService
{
    /** Actions the addon knows how to gate. Unknown actions are refused. */
    public static function actions()
    {
        return array(
            'password_change' => 'Change account password',
            'email_change' => 'Change account email address',
            'profile_update' => 'Update profile details',
            'payment_method_add' => 'Add a payment method',
            'payment_method_remove' => 'Remove a payment method',
            'service_cancel' => 'Request a service cancellation',
            'domain_transfer_out' => 'Release a domain for transfer',
            'api_credential_create' => 'Create API credentials',
            'passkey_remove' => 'Remove a passkey',
            'two_factor_change' => 'Change two-factor settings',
        );
    }

    public static function isEnabled()
    {
        return SettingsRepository::bool('sensitive_action_confirmation') && Config::isOperational();
    }

    public static function options($userType, $userId, $action)
    {
        if (!self::isEnabled()) {
            throw new ConfigurationException('Sensitive action confirmation is not available.');
        }
        if (!isset(self::actions()[$action])) {
            throw new PasskeyException('Unknown action.', 'invalid_request');
        }
        $rp = Config::relyingParty();
        RateLimiter::assert('action', $userType . ':' . $userId);

        $credentials = CredentialRepository::activeForUser($userType, $userId);
        if (!$credentials) {
            throw new PasskeyException('No passkey is available to confirm this action.', 'no_credentials');
        }
        $allow = array();
        foreach ($credentials as $credential) {
            $allow[] = array('type' => 'public-key', 'id' => (string) $credential['credential_id']);
        }

        $challenge = ChallengeRepository::issue(Schema::CHALLENGE_ACTION, $userType, $userId, array(
            'action' => $action,
            'rp_id' => $rp['rpId'],
            'ttl' => SettingsRepository::int('action_challenge_ttl'),
        ));

        return array(
            'challenge' => $challenge['challenge'],
            'timeout' => $challenge['expires_in'] * 1000,
            'rpId' => $rp['rpId'],
            'allowCredentials' => $allow,
            'userVerification' => (string) SettingsRepository::get('action_user_verification', 'required'),
            'action' => $action,
            'actionLabel' => self::actions()[$action],
        );
    }

    /**
     * Verifies the assertion and mints a single-use authorization token that
     * the calling feature presents to consume().
     *
     * @return array{token:string,expires_in:int}
     */
    public static function verify($userType, $userId, $action, array $response)
    {
        if (!self::isEnabled()) {
            throw new ConfigurationException('Sensitive action confirmation is not available.');
        }
        $rp = Config::relyingParty();

        try {
            $inner = isset($response['response']) && is_array($response['response']) ? $response['response'] : $response;
            $rawId = isset($response['id']) ? (string) $response['id'] : '';
            $challengeValue = RegistrationService::challengeFromClientData(
                isset($inner['clientDataJSON']) ? (string) $inner['clientDataJSON'] : ''
            );
            ChallengeRepository::consume($challengeValue, Schema::CHALLENGE_ACTION, array(
                'user_type' => $userType,
                'user_id' => $userId,
                'action' => $action,
            ));

            $credential = CredentialRepository::findByCredentialId($rawId);
            if (!$credential
                || (string) $credential['user_type'] !== (string) $userType
                || (int) $credential['user_id'] !== (int) $userId
                || (string) $credential['status'] !== Schema::STATUS_ACTIVE) {
                throw new PasskeyException('This passkey cannot confirm the action.', 'unknown_credential');
            }

            $result = CredentialVerifier::verifyAssertion($inner, $credential, array(
                'challenge' => $challengeValue,
                'origins' => $rp['origins'],
                'rpId' => $rp['rpId'],
                'requireUserVerification' => SettingsRepository::get('action_user_verification', 'required') === 'required',
            ));

            CredentialRepository::recordUse($credential['id'], $result['signCount'], EventLog::clientIp());
            RateLimiter::clear('action', $userType . ':' . $userId);

            $token = Base64Url::encode(random_bytes(32));
            $ttl = max(30, min(600, SettingsRepository::int('action_challenge_ttl')));
            Capsule::table(Schema::CHALLENGES)->insert(array(
                'challenge_hash' => ChallengeRepository::hash($token),
                'challenge' => $token,
                'user_type' => (string) $userType,
                'user_id' => (int) $userId,
                'challenge_type' => Schema::CHALLENGE_ACTION_TOKEN,
                'action' => (string) $action,
                'session_id' => ChallengeRepository::sessionFingerprint(),
                'rp_id' => $rp['rpId'],
                'metadata' => null,
                'expires_at' => date('Y-m-d H:i:s', time() + $ttl),
                'created_at' => date('Y-m-d H:i:s'),
            ));

            EventLog::success(EventLog::ACTION_CONFIRMED, array(
                'user_type' => $userType,
                'user_id' => $userId,
                'passkey_id' => $credential['id'],
                'metadata' => array('action' => $action),
            ));

            return array('token' => $token, 'expires_in' => $ttl, 'action' => $action);
        } catch (PasskeyException $e) {
            RateLimiter::fail('action', $userType . ':' . $userId);
            EventLog::failure(EventLog::ACTION_FAILED, $e->reason(), array(
                'user_type' => $userType,
                'user_id' => $userId,
                'metadata' => array('action' => $action),
            ));
            throw $e;
        }
    }

    /**
     * Consumes an authorization token. Call this immediately before performing
     * the sensitive action; it returns true exactly once per confirmation.
     */
    public static function consume($token, $userType, $userId, $action)
    {
        try {
            ChallengeRepository::consume($token, Schema::CHALLENGE_ACTION_TOKEN, array(
                'user_type' => $userType,
                'user_id' => $userId,
                'action' => $action,
            ));
            return true;
        } catch (PasskeyException $e) {
            EventLog::failure(EventLog::ACTION_FAILED, $e->reason(), array(
                'user_type' => $userType,
                'user_id' => $userId,
                'metadata' => array('action' => $action, 'stage' => 'consume'),
            ));
            return false;
        }
    }
}
