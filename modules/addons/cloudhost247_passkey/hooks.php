<?php
/**
 * WHMCS hook integration for CloudHost247 Passkey Authentication.
 *
 * WHMCS only loads hooks.php for an *active* addon, so deactivating the
 * module removes every passkey affordance and leaves the standard login
 * untouched. Every hook body is wrapped in try/catch and degrades to "do
 * nothing": a failure here must never block a customer from signing in.
 */

if (!defined('WHMCS')) {
    die('Direct access denied');
}

require_once __DIR__ . '/bootstrap.php';

use CloudHost247\Passkey\Config;
use CloudHost247\Passkey\CredentialRepository;
use CloudHost247\Passkey\EventLog;
use CloudHost247\Passkey\Log;
use CloudHost247\Passkey\PolicyService;
use CloudHost247\Passkey\Schema;
use CloudHost247\Passkey\SessionManager;
use CloudHost247\Passkey\SettingsRepository;

/** Per-session CSRF token shared with api.php. */
function cloudhost247_passkey_hook_token()
{
    SessionManager::start();
    if (empty($_SESSION['ch247_passkey_csrf'])) {
        $_SESSION['ch247_passkey_csrf'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['ch247_passkey_csrf'];
}

function cloudhost247_passkey_hook_client_id()
{
    return isset($_SESSION['uid']) ? (int) $_SESSION['uid'] : 0;
}

/** Shared front-end variables, including the endpoint URL and CSRF token. */
function cloudhost247_passkey_hook_vars()
{
    return array(
        'passkeyEnabled' => Config::isOperational(),
        'passkeyEndpoint' => 'modules/addons/cloudhost247_passkey/api.php',
        'passkeyToken' => cloudhost247_passkey_hook_token(),
        'passkeyAssetBase' => 'modules/addons/cloudhost247_passkey/assets',
    );
}

/**
 * Expose the endpoint, token and enrolment state to every client-area page so
 * the login form and the security page can render their passkey affordances.
 */
add_hook('ClientAreaPage', 1, function ($vars) {
    try {
        if (!SettingsRepository::bool('enabled')) {
            return array();
        }
        $out = cloudhost247_passkey_hook_vars();
        $clientId = cloudhost247_passkey_hook_client_id();
        if ($clientId > 0) {
            $policy = PolicyService::resolve(Schema::USER_CLIENT, $clientId);
            $out['passkeyEnrolled'] = (int) $policy['enrolled'];
            $out['passkeyRequired'] = (bool) $policy['required'];
            $out['passkeyPasswordFallback'] = (bool) $policy['passwordFallback'];
            $out['passkeyMax'] = PolicyService::maxCredentials(Schema::USER_CLIENT);
            $credentials = array();
            foreach (CredentialRepository::listForUser(Schema::USER_CLIENT, $clientId) as $row) {
                $credentials[] = CredentialRepository::toPublicArray($row);
            }
            $out['passkeyCredentials'] = $credentials;
        }
        return $out;
    } catch (\Throwable $e) {
        Log::error('hook.clientareapage_failed', array('error' => Log::safeError($e)));
        return array();
    }
});

/**
 * Inject the client-side assets. Kept to one small CSS and one small JS file,
 * loaded only when the addon is actually usable, so a misconfigured
 * deployment adds nothing to the page.
 */
add_hook('ClientAreaHeadOutput', 1, function ($vars) {
    try {
        if (!Config::isOperational()) {
            return '';
        }
        $base = 'modules/addons/cloudhost247_passkey/assets';
        return '<link rel="stylesheet" href="' . $base . '/passkey.css?v=1.0.0">' . "\n";
    } catch (\Throwable $e) {
        return '';
    }
});

add_hook('ClientAreaFooterOutput', 1, function ($vars) {
    try {
        if (!Config::isOperational()) {
            return '';
        }
        $base = 'modules/addons/cloudhost247_passkey/assets';
        $config = json_encode(array(
            'endpoint' => 'modules/addons/cloudhost247_passkey/api.php',
            'token' => cloudhost247_passkey_hook_token(),
            'clientId' => cloudhost247_passkey_hook_client_id(),
        ));
        return '<script>window.CloudHost247PasskeyConfig=' . $config . ';</script>' . "\n"
            . '<script src="' . $base . '/passkey.js?v=1.0.0" defer></script>' . "\n";
    } catch (\Throwable $e) {
        return '';
    }
});

/**
 * Record a standard (password) login so the security activity log tells the
 * whole story, not just the passkey half. Never blocks the login.
 */
add_hook('ClientLogin', 1, function ($vars) {
    try {
        if (!SettingsRepository::bool('enabled')) {
            return;
        }
        if (SessionManager::authenticatedWithPasskey()) {
            return; // already recorded by the ceremony
        }
        $clientId = isset($vars['userid']) ? (int) $vars['userid'] : cloudhost247_passkey_hook_client_id();
        if ($clientId <= 0) {
            return;
        }
        EventLog::success('auth.password_login', array(
            'user_type' => Schema::USER_CLIENT,
            'user_id' => $clientId,
            'metadata' => array('method' => 'password'),
        ));
    } catch (\Throwable $e) {
        Log::error('hook.clientlogin_failed', array('error' => Log::safeError($e)));
    }
});

/** Clear the passkey session markers on logout. */
add_hook('ClientLogout', 1, function ($vars) {
    try {
        SessionManager::clear();
    } catch (\Throwable $e) {
        // Nothing useful to do during logout.
    }
});

/**
 * A password change invalidates nothing about a passkey (they are independent
 * factors), but the user should be told, because an attacker who changed the
 * password would also want to know which passkeys still exist.
 */
add_hook('UserChangePassword', 1, function ($vars) {
    try {
        $userId = isset($vars['userid']) ? (int) $vars['userid'] : cloudhost247_passkey_hook_client_id();
        if ($userId <= 0 || !SettingsRepository::bool('enabled')) {
            return;
        }
        EventLog::success('account.password_changed', array(
            'user_type' => Schema::USER_CLIENT,
            'user_id' => $userId,
        ));
    } catch (\Throwable $e) {
        Log::error('hook.password_change_failed', array('error' => Log::safeError($e)));
    }
});

/** Hourly housekeeping alongside the WHMCS system cron. */
add_hook('AfterCronJob', 1, function ($vars) {
    try {
        if (!function_exists('cloudhost247_passkey_housekeeping')) {
            require_once __DIR__ . '/cloudhost247_passkey.php';
        }
        cloudhost247_passkey_housekeeping();
    } catch (\Throwable $e) {
        Log::error('hook.cron_failed', array('error' => Log::safeError($e)));
    }
});

/**
 * Surface passkey state in the admin client summary so support staff can see
 * at a glance whether a customer is enrolled — metadata only, never keys.
 */
add_hook('AdminClientProfileTabFields', 1, function ($vars) {
    try {
        if (!SettingsRepository::bool('enabled')) {
            return array();
        }
        $clientId = isset($vars['userid']) ? (int) $vars['userid'] : 0;
        if ($clientId <= 0) {
            return array();
        }
        $policy = PolicyService::resolve(Schema::USER_CLIENT, $clientId);
        $summary = $policy['enrolled'] > 0
            ? $policy['enrolled'] . ' passkey(s) registered'
            : 'No passkeys registered';
        if ($policy['required']) {
            $summary .= ' &middot; passkey required';
        }
        return array('Passkey Authentication' => $summary);
    } catch (\Throwable $e) {
        Log::error('hook.admin_profile_failed', array('error' => Log::safeError($e)));
        return array();
    }
});
