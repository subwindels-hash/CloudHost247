<?php
/**
 * CloudHost247 Passkey Authentication — WHMCS addon entry point.
 *
 * Passwordless sign-in for the client area and the admin area using
 * WebAuthn/FIDO2 passkeys, plus passkey confirmation for sensitive actions,
 * passkey-based password reset, and an optional Microsoft Entra ID link.
 *
 * WHMCS remains the source of truth for accounts, sessions and permissions:
 * this addon proves who the user is, it does not replace the login pipeline.
 */

if (!defined('WHMCS')) {
    die('Direct access denied');
}

require_once __DIR__ . '/bootstrap.php';

use CloudHost247\Passkey\AdminController;
use CloudHost247\Passkey\ChallengeRepository;
use CloudHost247\Passkey\Config;
use CloudHost247\Passkey\EventLog;
use CloudHost247\Passkey\Log;
use CloudHost247\Passkey\MigrationRunner;
use CloudHost247\Passkey\RateLimiter;
use CloudHost247\Passkey\SettingsRepository;

function cloudhost247_passkey_config()
{
    return array(
        'name' => 'CloudHost247 Passkey Authentication',
        'description' => 'Passwordless WebAuthn/FIDO2 sign-in for clients and administrators, passkey confirmation for '
            . 'sensitive actions, passkey password reset, and optional Microsoft Entra ID sign-in.',
        'version' => '1.0.0',
        'author' => 'CloudHost247',
        'language' => 'english',
        // Runtime configuration lives on the addon dashboard so it can be
        // validated and documented; no duplicated settings here.
        'fields' => array(),
    );
}

function cloudhost247_passkey_activate()
{
    try {
        MigrationRunner::migrate();
        SettingsRepository::seed();
        Log::info('addon.activated', array());
        return array(
            'status' => 'success',
            'description' => 'Passkey Authentication installed. Open the addon and set the WebAuthn RP ID and allowed '
                . 'origins on the Settings tab — until they are configured, passkey ceremonies fail closed.',
        );
    } catch (\Throwable $e) {
        Log::error('addon.activation_failed', array('error' => Log::safeError($e)));
        return array(
            'status' => 'error',
            'description' => 'Installation failed: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8'),
        );
    }
}

/**
 * Deactivation stops every passkey ceremony (each entry point checks that the
 * addon is active) but deliberately keeps registered credentials and the
 * security activity log, so reactivating the addon does not force every user
 * to enrol again. Deleting that data requires an explicit, destructive action.
 */
function cloudhost247_passkey_deactivate()
{
    Log::info('addon.deactivated', array());
    return array(
        'status' => 'success',
        'description' => 'Passkey Authentication disabled. Sign-in falls back to the standard WHMCS login; '
            . 'registered passkeys and the security activity log have been retained.',
    );
}

function cloudhost247_passkey_upgrade($vars)
{
    try {
        MigrationRunner::migrate();
        SettingsRepository::seed();
    } catch (\Throwable $e) {
        Log::error('addon.upgrade_failed', array('error' => Log::safeError($e)));
    }
}

function cloudhost247_passkey_output($vars)
{
    try {
        $view = AdminController::handle(is_array($vars) ? $vars : array());
        require __DIR__ . '/templates/admin/index.tpl';
    } catch (\Throwable $e) {
        Log::error('admin.render_failed', array('error' => Log::safeError($e)));
        echo '<div class="alert alert-danger">The Passkey dashboard could not be displayed. '
            . 'Check the module log for details.</div>';
    }
}

/**
 * Housekeeping, invoked from crons/cloudhost247_passkey.php: expire stale
 * challenges, release finished lockout windows and apply activity-log
 * retention. Safe to run repeatedly.
 */
function cloudhost247_passkey_housekeeping()
{
    $result = array('challenges' => 0, 'rate_limits' => 0, 'events' => 0);
    try {
        ChallengeRepository::purgeExpired();
        $result['rate_limits'] = RateLimiter::prune();
        $result['events'] = EventLog::prune();
        Log::info('housekeeping.completed', $result);
    } catch (\Throwable $e) {
        Log::error('housekeeping.failed', array('error' => Log::safeError($e)));
    }
    return $result;
}

/**
 * Client-area sidebar entry is intentionally not registered: passkey
 * management is surfaced inside the existing Security page through hooks.php.
 */
function cloudhost247_passkey_sidebar($vars)
{
    return '';
}

/** Convenience accessor for other modules and templates. */
function cloudhost247_passkey_is_operational()
{
    try {
        return Config::isOperational();
    } catch (\Throwable $e) {
        return false;
    }
}
