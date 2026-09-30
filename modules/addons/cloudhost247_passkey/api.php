<?php
/**
 * JSON ceremony endpoint.
 *
 *   /modules/addons/cloudhost247_passkey/api.php
 *
 * All requests are POST with a JSON body:
 *   { "action": "...", "csrf": "...", ... }
 *
 * Security properties enforced here, before any action runs:
 *   - POST only, JSON only, bounded body size,
 *   - same-origin check against the configured allowed origins,
 *   - double-submit CSRF token bound to the PHP session,
 *   - no caching, no framing, no referrer leakage,
 *   - generic error bodies: the reason code is stable and non-revealing, and
 *     internal exception text is never returned to the browser.
 */

$whmcsRoot = dirname(dirname(dirname(__DIR__)));
if (!is_file($whmcsRoot . '/init.php')) {
    http_response_code(500);
    header('Content-Type: application/json');
    exit('{"success":false,"reason":"service_unavailable"}');
}
require_once $whmcsRoot . '/init.php';
require_once __DIR__ . '/bootstrap.php';

use CloudHost247\Passkey\ActionConfirmationService;
use CloudHost247\Passkey\AuthenticationService;
use CloudHost247\Passkey\Config;
use CloudHost247\Passkey\ConfigurationException;
use CloudHost247\Passkey\CredentialRepository;
use CloudHost247\Passkey\EventLog;
use CloudHost247\Passkey\Log;
use CloudHost247\Passkey\PasskeyException;
use CloudHost247\Passkey\PasswordResetService;
use CloudHost247\Passkey\PolicyService;
use CloudHost247\Passkey\RegistrationService;
use CloudHost247\Passkey\Schema;
use CloudHost247\Passkey\SessionManager;
use CloudHost247\Passkey\SettingsRepository;

/** Emits a JSON response and stops. */
function cloudhost247_passkey_json($payload, $status = 200)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    echo json_encode($payload);
    exit;
}

function cloudhost247_passkey_fail($reason, $message, $status = 400)
{
    cloudhost247_passkey_json(array('success' => false, 'reason' => $reason, 'message' => $message), $status);
}

/** The signed-in client, or 0. Honours WHMCS's admin "login as client" state. */
function cloudhost247_passkey_current_client()
{
    if (isset($_SESSION['uid']) && (int) $_SESSION['uid'] > 0) {
        return (int) $_SESSION['uid'];
    }
    return 0;
}

function cloudhost247_passkey_current_admin()
{
    return isset($_SESSION['adminid']) ? (int) $_SESSION['adminid'] : 0;
}

/** Per-session CSRF token for the JSON endpoint (double submit). */
function cloudhost247_passkey_csrf_token()
{
    SessionManager::start();
    if (empty($_SESSION['ch247_passkey_csrf'])) {
        $_SESSION['ch247_passkey_csrf'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['ch247_passkey_csrf'];
}

SessionManager::start();

// ---------------------------------------------------------------- transport guards
if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET') !== 'POST') {
    cloudhost247_passkey_fail('method_not_allowed', 'This endpoint only accepts POST requests.', 405);
}
if (!SettingsRepository::bool('enabled')) {
    cloudhost247_passkey_fail('disabled', 'Passkey authentication is currently disabled.', 503);
}

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 65536) {
    cloudhost247_passkey_fail('payload_too_large', 'The request payload was rejected.', 413);
}
$request = json_decode((string) $raw, true);
if (!is_array($request)) {
    cloudhost247_passkey_fail('invalid_request', 'The request payload could not be read.');
}

// Same-origin: the browser-reported Origin must be one we trust.
try {
    $allowedOrigins = Config::relyingParty();
    $allowedOrigins = $allowedOrigins['origins'];
} catch (ConfigurationException $e) {
    cloudhost247_passkey_fail('configuration_required', 'Passkey authentication is not configured on this site.', 503);
}
$origin = isset($_SERVER['HTTP_ORIGIN']) ? strtolower((string) $_SERVER['HTTP_ORIGIN']) : '';
if ($origin !== '' && !in_array($origin, $allowedOrigins, true)) {
    cloudhost247_passkey_fail('origin_rejected', 'This request did not come from a recognised origin.', 403);
}

$action = isset($request['action']) ? (string) $request['action'] : '';

// CSRF token is required for every action that changes state or acts on a
// signed-in account. The token itself is handed to the page by hooks.php.
$csrfExempt = array('auth_options', 'auth_verify', 'reset_options', 'reset_verify');
if (!in_array($action, $csrfExempt, true)) {
    $supplied = isset($request['csrf']) ? (string) $request['csrf'] : '';
    if ($supplied === '' || !hash_equals(cloudhost247_passkey_csrf_token(), $supplied)) {
        cloudhost247_passkey_fail('csrf_failed', 'Your session has expired. Please reload the page and try again.', 403);
    }
}

$clientId = cloudhost247_passkey_current_client();
$adminId = cloudhost247_passkey_current_admin();
$userType = $clientId > 0 ? Schema::USER_CLIENT : ($adminId > 0 ? Schema::USER_ADMIN : '');
$userId = $clientId > 0 ? $clientId : $adminId;

/** Actions that require the caller to already be signed in. */
$requiresSession = array(
    'register_options', 'register_verify', 'list_credentials', 'rename_credential',
    'revoke_credential', 'action_options', 'action_verify', 'status',
);
if (in_array($action, $requiresSession, true) && $userType === '') {
    cloudhost247_passkey_fail('not_authenticated', 'Please sign in first.', 401);
}

try {
    switch ($action) {
        // ------------------------------------------------------------ registration
        case 'register_options':
            $user = \CloudHost247\Passkey\UserDirectory::find($userType, $userId);
            cloudhost247_passkey_json(array('success' => true, 'options' => RegistrationService::options(
                $userType,
                $userId,
                array(
                    'name' => $user ? $user['email'] : 'user',
                    'displayName' => $user ? $user['name'] : 'CloudHost247 user',
                )
            )));
            break;

        case 'register_verify':
            $credential = isset($request['credential']) && is_array($request['credential']) ? $request['credential'] : array();
            $name = isset($request['device_name']) ? (string) $request['device_name'] : '';
            cloudhost247_passkey_json(array(
                'success' => true,
                'credential' => RegistrationService::verify($userType, $userId, $credential, $name),
            ));
            break;

        // ---------------------------------------------------------- authentication
        case 'auth_options':
            $identifier = isset($request['identifier']) ? (string) $request['identifier'] : '';
            $requested = isset($request['user_type']) && $request['user_type'] === Schema::USER_ADMIN
                ? Schema::USER_ADMIN : Schema::USER_CLIENT;
            cloudhost247_passkey_json(array(
                'success' => true,
                'options' => AuthenticationService::options($identifier, $requested),
            ));
            break;

        case 'auth_verify':
            $credential = isset($request['credential']) && is_array($request['credential']) ? $request['credential'] : array();
            $result = AuthenticationService::verify($credential);
            SessionManager::markAuthenticated($result['user_type'], $result['user_id'], $result['user_verified']);
            // Handing the verified identity to WHMCS's own login pipeline is
            // the responsibility of the login page: this endpoint only
            // attests the identity and marks the session.
            cloudhost247_passkey_json(array(
                'success' => true,
                'user_type' => $result['user_type'],
                'redirect' => $result['user_type'] === Schema::USER_ADMIN ? '' : 'clientarea.php',
            ));
            break;

        // ------------------------------------------------------- credential admin
        case 'list_credentials':
            $items = array();
            foreach (CredentialRepository::listForUser($userType, $userId) as $row) {
                $items[] = CredentialRepository::toPublicArray($row);
            }
            cloudhost247_passkey_json(array('success' => true, 'credentials' => $items));
            break;

        case 'rename_credential':
            $id = isset($request['credential_id']) ? (int) $request['credential_id'] : 0;
            $owned = CredentialRepository::findOwned($id, $userType, $userId);
            if (!$owned) {
                cloudhost247_passkey_fail('not_found', 'That passkey could not be found.', 404);
            }
            CredentialRepository::rename($id, isset($request['device_name']) ? $request['device_name'] : '');
            EventLog::success(EventLog::CREDENTIAL_RENAMED, array(
                'user_type' => $userType, 'user_id' => $userId, 'passkey_id' => $id,
            ));
            cloudhost247_passkey_json(array('success' => true));
            break;

        case 'revoke_credential':
            $id = isset($request['credential_id']) ? (int) $request['credential_id'] : 0;
            $owned = CredentialRepository::findOwned($id, $userType, $userId);
            if (!$owned) {
                cloudhost247_passkey_fail('not_found', 'That passkey could not be found.', 404);
            }
            // Removing a passkey is itself a sensitive action: if the feature
            // is on and the user has another passkey, require confirmation.
            if (ActionConfirmationService::isEnabled() && CredentialRepository::countActive($userType, $userId) > 1) {
                $token = isset($request['confirmation']) ? (string) $request['confirmation'] : '';
                if (!ActionConfirmationService::consume($token, $userType, $userId, 'passkey_remove')) {
                    cloudhost247_passkey_fail('confirmation_required', 'Confirm with an existing passkey to remove this one.', 403);
                }
            }
            CredentialRepository::setStatus($id, Schema::STATUS_REVOKED);
            EventLog::success(EventLog::CREDENTIAL_REVOKED, array(
                'user_type' => $userType, 'user_id' => $userId, 'passkey_id' => $id,
                'metadata' => array('by' => 'owner'),
            ));
            \CloudHost247\Passkey\NotificationService::securityEvent($userType, $userId, 'passkey_removed', array(
                'device_name' => (string) $owned['device_name'],
            ));
            cloudhost247_passkey_json(array('success' => true));
            break;

        // --------------------------------------------------- sensitive actions
        case 'action_options':
            cloudhost247_passkey_json(array('success' => true, 'options' => ActionConfirmationService::options(
                $userType,
                $userId,
                isset($request['sensitive_action']) ? (string) $request['sensitive_action'] : ''
            )));
            break;

        case 'action_verify':
            $credential = isset($request['credential']) && is_array($request['credential']) ? $request['credential'] : array();
            cloudhost247_passkey_json(array('success' => true, 'confirmation' => ActionConfirmationService::verify(
                $userType,
                $userId,
                isset($request['sensitive_action']) ? (string) $request['sensitive_action'] : '',
                $credential
            )));
            break;

        // --------------------------------------------------------- password reset
        case 'reset_options':
            cloudhost247_passkey_json(array('success' => true, 'options' => PasswordResetService::options(
                isset($request['identifier']) ? (string) $request['identifier'] : ''
            )));
            break;

        case 'reset_verify':
            $credential = isset($request['credential']) && is_array($request['credential']) ? $request['credential'] : array();
            $result = PasswordResetService::verify($credential);
            cloudhost247_passkey_json(array(
                'success' => true,
                'token' => $result['token'],
                'expires_in' => $result['expires_in'],
            ));
            break;

        case 'reset_complete':
            PasswordResetService::complete(
                isset($request['token']) ? (string) $request['token'] : '',
                isset($request['password']) ? (string) $request['password'] : ''
            );
            cloudhost247_passkey_json(array('success' => true));
            break;

        // ------------------------------------------------------------------ status
        case 'status':
            $policy = PolicyService::resolve($userType, $userId);
            cloudhost247_passkey_json(array(
                'success' => true,
                'enrolled' => $policy['enrolled'],
                'required' => $policy['required'],
                'password_fallback' => $policy['passwordFallback'],
                'max_credentials' => PolicyService::maxCredentials($userType),
            ));
            break;

        default:
            cloudhost247_passkey_fail('unknown_action', 'Unknown action.', 404);
    }
} catch (ConfigurationException $e) {
    Log::error('api.configuration_required', array('action' => $action));
    cloudhost247_passkey_fail('configuration_required', 'Passkey authentication is not available on this site right now.', 503);
} catch (PasskeyException $e) {
    cloudhost247_passkey_fail($e->reason(), $e->getMessage(), $e->reason() === 'rate_limited' ? 429 : 400);
} catch (\Throwable $e) {
    // Never leak internal detail to the browser.
    Log::error('api.unhandled', array('action' => $action, 'error' => Log::safeError($e)));
    cloudhost247_passkey_fail('server_error', 'Something went wrong. Please try again.', 500);
}
