<?php
/**
 * WebAuthn authentication ceremony (spec §6, §7, Phase 4).
 *
 * Supports both flows:
 *   - discoverable / usernameless: no allowCredentials, the authenticator
 *     returns the user handle and we resolve the account from the credential,
 *   - identifier-first: the caller names an account and we list its
 *     credentials.
 *
 * Enumeration safety: options() for an unknown or non-enrolled account still
 * returns a well-formed challenge, so an attacker cannot use the endpoint to
 * discover which email addresses exist.
 */

namespace CloudHost247\Passkey;

final class AuthenticationService
{
    public static function options($identifier = '', $userType = Schema::USER_CLIENT)
    {
        if (!SettingsRepository::bool('enabled')) {
            throw new ConfigurationException('Passkey authentication is disabled.');
        }
        $rp = Config::relyingParty();
        $identifier = trim((string) $identifier);

        RateLimiter::assert('auth', EventLog::clientIp());

        $resolved = null;
        if ($identifier !== '') {
            $resolved = UserDirectory::resolve($identifier, $userType);
        }

        $allow = array();
        if ($resolved) {
            foreach (CredentialRepository::activeForUser($resolved['user_type'], $resolved['user_id']) as $credential) {
                $allow[] = array(
                    'type' => 'public-key',
                    'id' => (string) $credential['credential_id'],
                    'transports' => $credential['transports'] !== '' ? explode(',', (string) $credential['transports']) : array(),
                );
            }
        }

        // The challenge is bound to the account only when one was resolved;
        // discoverable logins bind at verification time instead.
        $challenge = ChallengeRepository::issue(
            Schema::CHALLENGE_AUTHENTICATION,
            $resolved ? $resolved['user_type'] : null,
            $resolved ? $resolved['user_id'] : null,
            array('rp_id' => $rp['rpId'])
        );

        return array(
            'challenge' => $challenge['challenge'],
            'timeout' => $challenge['expires_in'] * 1000,
            'rpId' => $rp['rpId'],
            'allowCredentials' => $allow,
            'userVerification' => (string) SettingsRepository::get('user_verification', 'preferred'),
        );
    }

    /**
     * Verifies an assertion.
     *
     * @return array{user_type:string,user_id:int,credential:array}
     */
    public static function verify(array $response)
    {
        if (!SettingsRepository::bool('enabled')) {
            throw new ConfigurationException('Passkey authentication is disabled.');
        }
        $rp = Config::relyingParty();
        $ip = EventLog::clientIp();
        RateLimiter::assert('auth', $ip);

        $credential = null;
        try {
            $inner = isset($response['response']) && is_array($response['response']) ? $response['response'] : $response;
            $rawId = isset($response['id']) ? (string) $response['id'] : (isset($response['rawId']) ? (string) $response['rawId'] : '');
            if ($rawId === '') {
                throw new PasskeyException('Missing credential id.', 'malformed_response');
            }

            $challengeValue = RegistrationService::challengeFromClientData(
                isset($inner['clientDataJSON']) ? (string) $inner['clientDataJSON'] : ''
            );
            $challengeRow = ChallengeRepository::consume($challengeValue, Schema::CHALLENGE_AUTHENTICATION);

            $credential = CredentialRepository::findByCredentialId($rawId);
            if (!$credential) {
                throw new PasskeyException('This passkey is not recognised.', 'unknown_credential');
            }
            if ((string) $credential['status'] !== Schema::STATUS_ACTIVE) {
                throw new PasskeyException('This passkey is no longer active.', 'credential_inactive');
            }
            // If the challenge was bound to an account, the credential must
            // belong to that same account.
            if ($challengeRow['user_id'] !== null
                && ((int) $challengeRow['user_id'] !== (int) $credential['user_id']
                    || (string) $challengeRow['user_type'] !== (string) $credential['user_type'])) {
                throw new PasskeyException('This passkey does not belong to that account.', 'user_mismatch');
            }
            // Discoverable flow: the authenticator's user handle must match.
            if (isset($inner['userHandle']) && (string) $inner['userHandle'] !== '') {
                $expected = RegistrationService::userHandle($credential['user_type'], $credential['user_id']);
                if (!hash_equals($expected, (string) $inner['userHandle'])) {
                    throw new PasskeyException('This passkey does not belong to that account.', 'user_handle_mismatch');
                }
            }

            if (!UserDirectory::isActive($credential['user_type'], $credential['user_id'])) {
                throw new PasskeyException('This account is not able to sign in.', 'account_inactive');
            }

            $policy = PolicyService::resolve($credential['user_type'], $credential['user_id']);
            $requireUv = SettingsRepository::get('user_verification', 'preferred') === 'required' || $policy['required'];

            $result = CredentialVerifier::verifyAssertion($inner, $credential, array(
                'challenge' => $challengeValue,
                'origins' => $rp['origins'],
                'rpId' => $rp['rpId'],
                'requireUserVerification' => $requireUv,
            ));

            CredentialRepository::recordUse($credential['id'], $result['signCount'], $ip);
            RateLimiter::clear('auth', $ip);

            EventLog::success(EventLog::AUTH_SUCCESS, array(
                'user_type' => $credential['user_type'],
                'user_id' => $credential['user_id'],
                'passkey_id' => $credential['id'],
                'metadata' => array('device_name' => $credential['device_name'], 'uv' => $result['userVerified']),
            ));
            NotificationService::loginNotification($credential['user_type'], $credential['user_id'], array(
                'device_name' => (string) $credential['device_name'],
            ));

            return array(
                'user_type' => (string) $credential['user_type'],
                'user_id' => (int) $credential['user_id'],
                'credential' => CredentialRepository::toPublicArray($credential),
                'user_verified' => $result['userVerified'],
            );
        } catch (PasskeyException $e) {
            RateLimiter::fail('auth', $ip);
            EventLog::failure(EventLog::AUTH_FAILED, $e->reason(), array(
                'user_type' => $credential ? $credential['user_type'] : null,
                'user_id' => $credential ? $credential['user_id'] : null,
                'passkey_id' => $credential ? $credential['id'] : null,
            ));
            // Cloned-authenticator detection is a serious signal: tell the user.
            if ($e->reason() === 'counter_replay' && $credential) {
                CredentialRepository::setStatus($credential['id'], Schema::STATUS_DISABLED);
                NotificationService::securityEvent($credential['user_type'], $credential['user_id'], 'passkey_cloned_suspected', array(
                    'device_name' => (string) $credential['device_name'],
                ));
            }
            throw $e;
        }
    }
}
