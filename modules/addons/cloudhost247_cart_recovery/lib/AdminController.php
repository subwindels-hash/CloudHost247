<?php
/**
 * Admin screen controller.
 *
 * Mirrors the controller/view split used by cloudhost247_marketing: this
 * class validates permissions, CSRF tokens and input, performs the action
 * and returns a plain data array that templates/admin/index.tpl renders.
 */

namespace CloudHost247\CartRecovery;

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
                \CloudHost247\Foundation\Security\AdminGuard::requireCapability('cloudhost247_cart_recovery', 'manage');
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
            $view['errors'][] = 'You do not have permission to manage CloudHost247 Cart Recovery.';
            return $view;
        }

        if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET') === 'POST' && $post) {
            $result = self::dispatch($post);
            $view['notices'] = array_merge($view['notices'], $result['notices']);
            $view['errors'] = array_merge($view['errors'], $result['errors']);
        }

        $status = isset($get['status']) ? (string) $get['status'] : '';
        $search = isset($get['q']) ? substr(trim((string) $get['q']), 0, 100) : '';
        $page = isset($get['page']) ? (int) $get['page'] : 1;

        $view['settings'] = SettingsRepository::all();
        $view['stats'] = Analytics::summary();
        $view['filter'] = array('status' => $status, 'q' => $search);
        $view['list'] = Analytics::records($status, $search, $page);
        $view['statuses'] = Schema::allStatuses();
        $view['detail'] = null;

        $detailId = isset($get['view']) ? (int) $get['view'] : 0;
        if ($detailId > 0) {
            $record = RecoveryService::find($detailId);
            if ($record) {
                $view['detail'] = array(
                    'record' => $record,
                    'items' => CartSnapshot::items($record->cart_snapshot),
                    'history' => self::historyView($record),
                );
            } else {
                $view['errors'][] = 'That recovery record no longer exists.';
            }
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
        $recoveryId = isset($post['recovery_id']) ? (int) $post['recovery_id'] : 0;

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
                    SettingsRepository::save($input);
                    $out['notices'][] = 'Settings saved.';
                    break;

                case 'process_due':
                    if (!Lock::acquire('cron')) {
                        $out['errors'][] = 'A reminder run is already in progress. Try again shortly.';
                        break;
                    }
                    try {
                        $result = ReminderService::process();
                        $out['notices'][] = sprintf(
                            'Processed %d record(s): %d sent, %d failed, %d skipped, %d newly abandoned, %d expired.',
                            $result['processed'], $result['sent'], $result['failed'], $result['skipped'],
                            $result['marked_abandoned'], $result['expired']
                        );
                    } finally {
                        Lock::release('cron');
                    }
                    break;

                case 'send_reminder':
                    $outcome = ReminderService::sendNow($recoveryId);
                    $out['notices'][] = 'Reminder request for record #' . $recoveryId . ': ' . $outcome . '.';
                    break;

                case 'retry_reminder':
                    $number = isset($post['reminder_number']) ? (int) $post['reminder_number'] : 0;
                    $outcome = ReminderService::retry($recoveryId, $number);
                    $out['notices'][] = 'Retry of reminder #' . $number . ' for record #' . $recoveryId . ': ' . $outcome . '.';
                    break;

                case 'expire_recovery':
                    if (RecoveryService::expire($recoveryId)) {
                        $out['notices'][] = 'Recovery #' . $recoveryId . ' is now expired.';
                    } else {
                        $out['errors'][] = 'Recovery #' . $recoveryId . ' is already in a terminal state.';
                    }
                    break;

                case 'cancel_recovery':
                    RecoveryService::close($recoveryId, 'admin_cancelled');
                    $out['notices'][] = 'Recovery #' . $recoveryId . ' cancelled. No further reminders will be sent.';
                    break;

                case 'unsubscribe_customer':
                    $record = RecoveryService::find($recoveryId);
                    if (!$record) {
                        $out['errors'][] = 'Recovery record not found.';
                        break;
                    }
                    RecoveryService::suppress($record->email, $record->client_id, 'admin');
                    RecoveryService::transition($recoveryId, Schema::STATUS_UNSUBSCRIBED, array('next_reminder_at' => null, 'unsubscribed_at' => RecoveryService::now()));
                    $out['notices'][] = 'Customer added to the suppression list.';
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

    /** Reminder history rows plus the schedule for reminders not yet sent. */
    public static function historyView($record)
    {
        $history = ReminderService::history($record->id);
        $rows = array();
        $max = min(3, SettingsRepository::int('maximum_reminders'));
        for ($number = 1; $number <= $max; $number++) {
            if (isset($history[$number])) {
                $log = $history[$number];
                $rows[] = array(
                    'number' => $number,
                    'status' => (string) $log->status,
                    'sent_at' => (string) $log->sent_at,
                    'failed_at' => (string) $log->failed_at,
                    'attempts' => isset($log->attempts) ? (int) $log->attempts : 0,
                    'error' => (string) $log->error_message,
                    'scheduled' => '',
                );
                continue;
            }
            $scheduled = '';
            if ($record->abandoned_at && SettingsRepository::reminderEnabled($number)) {
                $scheduled = (string) date('Y-m-d H:i:s', strtotime((string) $record->abandoned_at) + SettingsRepository::reminderDelay($number));
            }
            $rows[] = array(
                'number' => $number,
                'status' => SettingsRepository::reminderEnabled($number) ? 'pending' : 'disabled',
                'sent_at' => '',
                'failed_at' => '',
                'attempts' => 0,
                'error' => '',
                'scheduled' => $scheduled,
            );
        }
        return $rows;
    }
}
