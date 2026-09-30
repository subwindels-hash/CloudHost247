<?php
/**
 * Admin screen controller (spec §12, §19, §20).
 *
 * Mirrors the controller/view split used by cloudhost247_cart_recovery and
 * cloudhost247_marketing: this class validates permissions, CSRF tokens and
 * input, performs the action, and returns a plain data array that
 * templates/admin/index.tpl renders.
 *
 * Administrators can see and manage credential *metadata* and policy. They
 * can never see a public key, a challenge, or anything that would let them
 * impersonate a customer.
 */

namespace CloudHost247\Passkey;

use WHMCS\Database\Capsule;

final class AdminController
{
    /** WHMCS admin permission required for every action on this screen. */
    const PERMISSION = 'Manage Addon Modules';

    /**
     * Authorisation reuses the Foundation guard
     * (cloudhost247_core/lib/Security/AdminGuard.php) when it is installed,
     * and always applies the WHMCS addon permission check.
     */
    public static function authorised()
    {
        try {
            if (class_exists('CloudHost247\\Foundation\\Security\\AdminGuard') && !empty($_SESSION['adminid'])) {
                \CloudHost247\Foundation\Security\AdminGuard::requireAdmin();
                \CloudHost247\Foundation\Security\AdminGuard::requireCapability('cloudhost247_passkey', 'manage');
            }
        } catch (\Throwable $e) {
            return false;
        }
        if (!function_exists('checkPermission')) {
            return true; // Outside the WHMCS runtime (tests/CLI).
        }
        return (bool) checkPermission(self::PERMISSION, true);
    }

    /**
     * @param array $vars WHMCS addon vars
     * @return array view model
     */
    public static function handle(array $vars, $post = null, $get = null)
    {
        $post = is_array($post) ? $post : $_POST;
        $get = is_array($get) ? $get : $_GET;

        $view = array(
            'modulelink' => isset($vars['modulelink']) ? (string) $vars['modulelink'] : '',
            'version' => isset($vars['version']) ? (string) $vars['version'] : '',
            'notices' => array(),
            'errors' => array(),
            'authorised' => self::authorised(),
            'token' => function_exists('generate_token') ? generate_token('plain') : '',
        );
        if (!$view['authorised']) {
            $view['errors'][] = 'You do not have permission to manage CloudHost247 Passkey Authentication.';
            return $view;
        }

        if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET') === 'POST' && $post) {
            $result = self::dispatch($post);
            $view['notices'] = array_merge($view['notices'], $result['notices']);
            $view['errors'] = array_merge($view['errors'], $result['errors']);
        }

        $tab = isset($get['tab']) ? (string) $get['tab'] : 'overview';
        if (!in_array($tab, array('overview', 'credentials', 'activity', 'settings', 'diagnostics'), true)) {
            $tab = 'overview';
        }

        $view['tab'] = $tab;
        $view['settings'] = SettingsRepository::all();
        $view['stats'] = self::stats();
        $view['diagnostics'] = Config::diagnostics();
        $view['enforcement_options'] = Schema::enforcementPolicies();
        $view['account_policies'] = Schema::accountPolicies();
        $view['emergency_override'] = PolicyService::emergencyOverrideActive();

        $filters = array(
            'user_type' => isset($get['user_type']) ? (string) $get['user_type'] : '',
            'user_id' => isset($get['user_id']) ? (string) $get['user_id'] : '',
            'event_type' => isset($get['event_type']) ? (string) $get['event_type'] : '',
            'success' => isset($get['success']) ? (string) $get['success'] : '',
            'from' => isset($get['from']) ? (string) $get['from'] : '',
            'to' => isset($get['to']) ? (string) $get['to'] : '',
        );
        $view['filter'] = $filters;
        $page = isset($get['page']) ? (int) $get['page'] : 1;

        if ($tab === 'activity') {
            $view['activity'] = EventLog::search($filters, $page, 25);
        }
        if ($tab === 'credentials') {
            $view['credentials'] = self::credentialList($filters, $page);
        }

        return $view;
    }

    /** Execute a validated POST action. */
    private static function dispatch(array $post)
    {
        $out = array('notices' => array(), 'errors' => array());

        // CSRF: the Foundation guard's requirePostToken() when available,
        // otherwise WHMCS's own admin token check directly.
        try {
            if (class_exists('CloudHost247\\Foundation\\Security\\AdminGuard') && !empty($_SESSION['adminid'])) {
                \CloudHost247\Foundation\Security\AdminGuard::requirePostToken();
            } elseif (function_exists('check_token') && !check_token('WHMCS.admin.default')) {
                throw new \RuntimeException('Invalid or expired CSRF token.');
            }
        } catch (\Throwable $e) {
            $out['errors'][] = 'Security token mismatch. Please reload the page and try again.';
            return $out;
        }

        $action = isset($post['action']) ? (string) $post['action'] : '';
        $adminId = isset($_SESSION['adminid']) ? (int) $_SESSION['adminid'] : 0;
        $credentialId = isset($post['credential_id']) ? (int) $post['credential_id'] : 0;

        try {
            switch ($action) {
                case 'save_settings':
                    $input = array();
                    foreach (SettingsRepository::defaults() as $key => $default) {
                        if (in_array($key, SettingsRepository::boolKeys(), true)) {
                            $input[$key] = !empty($post[$key]) ? '1' : '0';
                        } elseif (isset($post[$key])) {
                            $input[$key] = $post[$key];
                        }
                    }
                    SettingsRepository::save($input, $adminId);
                    $out['notices'][] = 'Settings saved.';
                    if (!Config::isOperational() && SettingsRepository::bool('enabled')) {
                        $out['errors'][] = 'Passkey authentication is enabled but not yet usable — see the Diagnostics tab.';
                    }
                    break;

                case 'revoke_credential':
                    $out = self::changeCredentialStatus($credentialId, Schema::STATUS_REVOKED, $adminId, $out);
                    break;

                case 'disable_credential':
                    $out = self::changeCredentialStatus($credentialId, Schema::STATUS_DISABLED, $adminId, $out);
                    break;

                case 'enable_credential':
                    $out = self::changeCredentialStatus($credentialId, Schema::STATUS_ACTIVE, $adminId, $out);
                    break;

                case 'set_account_policy':
                    $userType = isset($post['user_type']) ? (string) $post['user_type'] : '';
                    $userId = isset($post['user_id']) ? (int) $post['user_id'] : 0;
                    $policy = isset($post['policy']) ? (string) $post['policy'] : '';
                    if (!Schema::isUserType($userType) || $userId <= 0) {
                        $out['errors'][] = 'Select a valid account before changing its policy.';
                        break;
                    }
                    PolicyService::setAccountPolicy($userType, $userId, $policy, $adminId);
                    $out['notices'][] = 'Account policy updated to "' . htmlspecialchars($policy, ENT_QUOTES, 'UTF-8') . '".';
                    break;

                case 'prune_events':
                    $removed = EventLog::prune();
                    RateLimiter::prune();
                    ChallengeRepository::purgeExpired();
                    $out['notices'][] = 'Housekeeping complete. ' . $removed . ' expired activity record(s) removed.';
                    break;

                case 'clear_lockouts':
                    $cleared = (int) Capsule::table(Schema::RATE_LIMITS)->delete();
                    EventLog::success(EventLog::ADMIN_MANAGED, array(
                        'metadata' => array('action' => 'clear_lockouts', 'admin_id' => $adminId, 'cleared' => $cleared),
                    ));
                    $out['notices'][] = $cleared . ' rate-limit record(s) cleared.';
                    break;

                case 'run_migrations':
                    $applied = MigrationRunner::migrate();
                    $out['notices'][] = $applied
                        ? 'Applied migration(s): ' . implode(', ', $applied) . '.'
                        : 'Database schema is already up to date.';
                    break;

                default:
                    $out['errors'][] = 'Unknown action.';
            }
        } catch (\Throwable $e) {
            Log::error('admin.action_failed', array('action' => $action, 'error' => Log::safeError($e)));
            $out['errors'][] = 'The action could not be completed. See the module log for details.';
        }
        return $out;
    }

    private static function changeCredentialStatus($credentialId, $status, $adminId, array $out)
    {
        $credential = CredentialRepository::find($credentialId);
        if (!$credential) {
            $out['errors'][] = 'That passkey no longer exists.';
            return $out;
        }
        CredentialRepository::setStatus($credentialId, $status);
        $eventMap = array(
            Schema::STATUS_REVOKED => EventLog::CREDENTIAL_REVOKED,
            Schema::STATUS_DISABLED => EventLog::CREDENTIAL_DISABLED,
            Schema::STATUS_ACTIVE => EventLog::CREDENTIAL_ENABLED,
        );
        EventLog::success($eventMap[$status], array(
            'user_type' => $credential['user_type'],
            'user_id' => $credential['user_id'],
            'passkey_id' => $credentialId,
            'metadata' => array('by' => 'admin', 'admin_id' => (int) $adminId),
        ));
        NotificationService::securityEvent($credential['user_type'], $credential['user_id'], 'passkey_' . $status . '_by_admin', array(
            'device_name' => (string) $credential['device_name'],
        ));
        $out['notices'][] = 'Passkey #' . (int) $credentialId . ' is now ' . $status . '.';
        return $out;
    }

    /** Dashboard counters. */
    public static function stats()
    {
        $stats = array(
            'credentials_total' => 0,
            'credentials_active' => 0,
            'clients_enrolled' => 0,
            'admins_enrolled' => 0,
            'logins_24h' => 0,
            'failures_24h' => 0,
            'lockouts_active' => 0,
        );
        try {
            $stats['credentials_total'] = (int) Capsule::table(Schema::CREDENTIALS)->count();
            $stats['credentials_active'] = (int) Capsule::table(Schema::CREDENTIALS)
                ->where('status', Schema::STATUS_ACTIVE)->count();
            $stats['clients_enrolled'] = (int) Capsule::table(Schema::CREDENTIALS)
                ->where('user_type', Schema::USER_CLIENT)->distinct()->count('user_id');
            $stats['admins_enrolled'] = (int) Capsule::table(Schema::CREDENTIALS)
                ->where('user_type', Schema::USER_ADMIN)->distinct()->count('user_id');
            $stats['logins_24h'] = EventLog::countSince(EventLog::AUTH_SUCCESS, 86400, true);
            $stats['failures_24h'] = EventLog::countSince(EventLog::AUTH_FAILED, 86400, false);
            $stats['lockouts_active'] = (int) Capsule::table(Schema::RATE_LIMITS)
                ->where('locked_until', '>', date('Y-m-d H:i:s'))->count();
        } catch (\Throwable $e) {
            Log::error('admin.stats_failed', array('error' => Log::safeError($e)));
        }
        return $stats;
    }

    /** Paginated credential list for the admin view (metadata only). */
    public static function credentialList(array $filters, $page = 1, $perPage = 25)
    {
        $perPage = max(5, min(100, (int) $perPage));
        $page = max(1, (int) $page);
        $query = Capsule::table(Schema::CREDENTIALS);
        if (!empty($filters['user_type'])) {
            $query->where('user_type', (string) $filters['user_type']);
        }
        if (isset($filters['user_id']) && $filters['user_id'] !== '') {
            $query->where('user_id', (int) $filters['user_id']);
        }
        $total = (int) $query->count();
        $rows = $query->orderBy('created_at', 'desc')->offset(($page - 1) * $perPage)->limit($perPage)->get();

        $items = array();
        foreach ($rows as $row) {
            $row = (array) $row;
            $public = CredentialRepository::toPublicArray($row);
            $user = UserDirectory::find($row['user_type'], $row['user_id']);
            $public['user_type'] = (string) $row['user_type'];
            $public['user_id'] = (int) $row['user_id'];
            $public['user_label'] = $user ? ($user['name'] . ' <' . $user['email'] . '>') : 'Unknown account';
            $public['account_policy'] = PolicyService::accountPolicy($row['user_type'], $row['user_id']);
            $items[] = $public;
        }
        return array('items' => $items, 'total' => $total, 'page' => $page, 'per_page' => $perPage);
    }
}
