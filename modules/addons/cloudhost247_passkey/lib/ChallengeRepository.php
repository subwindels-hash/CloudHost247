<?php
/**
 * Challenge storage (spec §15).
 *
 * Every ceremony is bound to a server-generated, single-use challenge:
 *   - 32 bytes from the CSPRNG,
 *   - bound to the user (when known), the ceremony type, the PHP session, the
 *     relying party and — for sensitive operations — the specific action,
 *   - short-lived, and marked consumed the moment it is used.
 *
 * The raw challenge is stored so it can be compared with the value echoed by
 * the authenticator; it is a single-use nonce, not a credential, and it is
 * never logged. Lookups are by the *hash* so a leaked log or index scan
 * cannot be turned into a usable challenge value.
 */

namespace CloudHost247\Passkey;

use WHMCS\Database\Capsule;

final class ChallengeRepository
{
    /**
     * @return array{id:int,challenge:string} the base64url challenge for the browser
     */
    public static function issue($type, $userType, $userId, array $options = array())
    {
        if (!in_array($type, Schema::challengeTypes(), true)) {
            throw new PasskeyException('Unknown challenge type.', 'invalid_request');
        }
        $ttl = isset($options['ttl']) ? (int) $options['ttl'] : (int) SettingsRepository::int('challenge_ttl');
        $ttl = max(30, min(600, $ttl));
        $challenge = Base64Url::encode(random_bytes(32));
        $now = time();

        $id = Capsule::table(Schema::CHALLENGES)->insertGetId(array(
            'challenge_hash' => self::hash($challenge),
            'challenge' => $challenge,
            'user_type' => $userType === null ? null : (string) $userType,
            'user_id' => $userId === null ? null : (int) $userId,
            'challenge_type' => $type,
            'action' => isset($options['action']) ? mb_substr((string) $options['action'], 0, 64) : null,
            'session_id' => self::sessionFingerprint(),
            'rp_id' => isset($options['rp_id']) ? (string) $options['rp_id'] : '',
            'metadata' => isset($options['metadata']) ? json_encode($options['metadata']) : null,
            'expires_at' => date('Y-m-d H:i:s', $now + $ttl),
            'created_at' => date('Y-m-d H:i:s', $now),
        ));

        self::purgeExpired();
        return array('id' => (int) $id, 'challenge' => $challenge, 'expires_in' => $ttl);
    }

    /**
     * Fetches a pending challenge and atomically marks it consumed.
     *
     * Consumption happens *before* signature verification so a failed attempt
     * can never be replayed with a corrected payload.
     *
     * @return array the challenge row
     */
    public static function consume($challenge, $type, array $expect = array())
    {
        $row = Capsule::table(Schema::CHALLENGES)->where('challenge_hash', self::hash($challenge))->first();
        if (!$row) {
            throw new PasskeyException('Unknown challenge.', 'challenge_unknown');
        }
        if ($row->consumed_at !== null && $row->consumed_at !== '') {
            throw new PasskeyException('Challenge has already been used.', 'challenge_replay');
        }
        if (strtotime((string) $row->expires_at) < time()) {
            throw new PasskeyException('Challenge has expired.', 'challenge_expired');
        }
        if ((string) $row->challenge_type !== (string) $type) {
            throw new PasskeyException('Challenge was issued for a different ceremony.', 'challenge_type_mismatch');
        }
        if (!hash_equals((string) $row->session_id, self::sessionFingerprint())) {
            throw new PasskeyException('Challenge was issued to a different session.', 'session_mismatch');
        }
        if (isset($expect['user_type']) && (string) $row->user_type !== (string) $expect['user_type']) {
            throw new PasskeyException('Challenge belongs to a different user type.', 'user_mismatch');
        }
        if (isset($expect['user_id']) && (int) $row->user_id !== (int) $expect['user_id']) {
            throw new PasskeyException('Challenge belongs to a different account.', 'user_mismatch');
        }
        if (isset($expect['action']) && (string) $row->action !== (string) $expect['action']) {
            throw new PasskeyException('Challenge was issued for a different action.', 'action_mismatch');
        }

        $affected = Capsule::table(Schema::CHALLENGES)
            ->where('id', (int) $row->id)
            ->whereNull('consumed_at')
            ->update(array('consumed_at' => date('Y-m-d H:i:s')));
        if ($affected < 1) {
            // Lost the race against a concurrent request using the same challenge.
            throw new PasskeyException('Challenge has already been used.', 'challenge_replay');
        }

        return (array) $row;
    }

    public static function purgeExpired()
    {
        try {
            Capsule::table(Schema::CHALLENGES)
                ->where('expires_at', '<', date('Y-m-d H:i:s', time() - 3600))
                ->delete();
        } catch (\Throwable $e) {
            Log::error('challenge.purge_failed', array('error' => Log::safeError($e)));
        }
    }

    public static function hash($challenge)
    {
        return hash('sha256', 'cloudhost247-passkey-challenge:' . (string) $challenge);
    }

    /**
     * Binds a challenge to the browser session without storing the raw PHP
     * session id (which is itself a credential).
     */
    public static function sessionFingerprint()
    {
        $id = function_exists('session_id') ? (string) session_id() : '';
        if ($id === '') {
            if (empty($_SESSION['ch247_passkey_sid'])) {
                $_SESSION['ch247_passkey_sid'] = bin2hex(random_bytes(16));
            }
            $id = (string) $_SESSION['ch247_passkey_sid'];
        }
        return hash('sha256', 'cloudhost247-passkey-session:' . $id);
    }
}
