<?php
/**
 * Passkey security activity log (spec §20).
 *
 * Append-only record of every registration, authentication attempt,
 * credential management action, policy change, password reset and sensitive
 * action confirmation. Never records private keys, challenges, signatures or
 * any other authentication secret — Log::scrub() is applied to the metadata
 * before it is serialised.
 */

namespace CloudHost247\Passkey;

use WHMCS\Database\Capsule;

final class EventLog
{
    const REGISTERED = 'credential.registered';
    const REGISTRATION_FAILED = 'credential.registration_failed';
    const AUTH_SUCCESS = 'auth.success';
    const AUTH_FAILED = 'auth.failed';
    const CREDENTIAL_RENAMED = 'credential.renamed';
    const CREDENTIAL_REVOKED = 'credential.revoked';
    const CREDENTIAL_DISABLED = 'credential.disabled';
    const CREDENTIAL_ENABLED = 'credential.enabled';
    const PASSWORD_RESET = 'password_reset.completed';
    const PASSWORD_RESET_FAILED = 'password_reset.failed';
    const ACTION_CONFIRMED = 'action.confirmed';
    const ACTION_FAILED = 'action.failed';
    const POLICY_CHANGED = 'policy.changed';
    const ADMIN_MANAGED = 'admin.credential_managed';
    const RATE_LIMITED = 'auth.rate_limited';
    const ENTRA_LINKED = 'entra.linked';
    const ENTRA_LOGIN = 'entra.login';

    public static function record($eventType, array $data = array())
    {
        try {
            Capsule::table(Schema::EVENTS)->insert(array(
                'user_type' => isset($data['user_type']) ? (string) $data['user_type'] : null,
                'user_id' => isset($data['user_id']) ? (int) $data['user_id'] : null,
                'passkey_id' => isset($data['passkey_id']) && $data['passkey_id'] ? (int) $data['passkey_id'] : null,
                'event_type' => mb_substr((string) $eventType, 0, 64),
                'success' => !empty($data['success']) ? 1 : 0,
                'reason' => isset($data['reason']) ? mb_substr((string) $data['reason'], 0, 64) : null,
                'ip_address' => mb_substr(self::clientIp(), 0, 45),
                'user_agent' => mb_substr(self::userAgent(), 0, 255),
                'metadata' => json_encode(Log::scrub(isset($data['metadata']) ? (array) $data['metadata'] : array())),
                'created_at' => date('Y-m-d H:i:s'),
            ));
        } catch (\Throwable $e) {
            // The security log must never break authentication; the Foundation
            // logger still receives the event.
            Log::error('event.write_failed', array('event' => $eventType, 'error' => Log::safeError($e)));
        }
        Log::info($eventType, array(
            'user_type' => isset($data['user_type']) ? $data['user_type'] : null,
            'user_id' => isset($data['user_id']) ? (int) $data['user_id'] : null,
            'success' => !empty($data['success']),
            'reason' => isset($data['reason']) ? $data['reason'] : null,
        ));
    }

    public static function success($eventType, array $data = array())
    {
        $data['success'] = true;
        self::record($eventType, $data);
    }

    public static function failure($eventType, $reason, array $data = array())
    {
        $data['success'] = false;
        $data['reason'] = $reason;
        self::record($eventType, $data);
    }

    /**
     * Bounded, filtered query for the admin activity view and the client's own
     * activity list. Always paginated — an unbounded log query is a DoS.
     */
    public static function search(array $filters = array(), $page = 1, $perPage = 25)
    {
        $perPage = max(5, min(100, (int) $perPage));
        $page = max(1, (int) $page);
        $query = Capsule::table(Schema::EVENTS);

        if (!empty($filters['user_type'])) {
            $query->where('user_type', (string) $filters['user_type']);
        }
        if (isset($filters['user_id']) && $filters['user_id'] !== '') {
            $query->where('user_id', (int) $filters['user_id']);
        }
        if (!empty($filters['event_type'])) {
            $query->where('event_type', (string) $filters['event_type']);
        }
        if (isset($filters['success']) && $filters['success'] !== '') {
            $query->where('success', ((string) $filters['success'] === '1') ? 1 : 0);
        }
        if (!empty($filters['from'])) {
            $query->where('created_at', '>=', date('Y-m-d H:i:s', strtotime((string) $filters['from'])));
        }
        if (!empty($filters['to'])) {
            $query->where('created_at', '<=', date('Y-m-d H:i:s', strtotime((string) $filters['to'])));
        }

        $total = (int) $query->count();
        $rows = $query->orderBy('created_at', 'desc')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();
        $items = array();
        foreach ($rows as $row) {
            $items[] = (array) $row;
        }
        return array('items' => $items, 'total' => $total, 'page' => $page, 'per_page' => $perPage);
    }

    public static function countSince($eventType, $seconds, $success = null)
    {
        $query = Capsule::table(Schema::EVENTS)
            ->where('event_type', $eventType)
            ->where('created_at', '>=', date('Y-m-d H:i:s', time() - (int) $seconds));
        if ($success !== null) {
            $query->where('success', $success ? 1 : 0);
        }
        return (int) $query->count();
    }

    /** Retention sweep — called from the addon cron. */
    public static function prune()
    {
        $days = max(30, SettingsRepository::int('event_retention_days'));
        return (int) Capsule::table(Schema::EVENTS)
            ->where('created_at', '<', date('Y-m-d H:i:s', time() - ($days * 86400)))
            ->delete();
    }

    public static function clientIp()
    {
        if (function_exists('get_client_ip')) {
            $ip = (string) \get_client_ip();
            if ($ip !== '') {
                return $ip;
            }
        }
        return isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
    }

    public static function userAgent()
    {
        return isset($_SERVER['HTTP_USER_AGENT']) ? (string) $_SERVER['HTTP_USER_AGENT'] : '';
    }
}
