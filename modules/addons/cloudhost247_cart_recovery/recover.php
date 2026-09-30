<?php
/**
 * Public recovery + unsubscribe endpoint.
 *
 *   /modules/addons/cloudhost247_cart_recovery/recover.php?token=<token>
 *   /modules/addons/cloudhost247_cart_recovery/recover.php?action=unsubscribe&token=<token>
 *
 * No login is required — the token is the credential — but a token only ever
 * restores its own cart into the current session. It never authenticates the
 * visitor, never exposes account data and never reveals internal errors.
 */

$whmcsRoot = dirname(dirname(dirname(__DIR__)));
if (!is_file($whmcsRoot . '/init.php')) {
    http_response_code(500);
    exit('Service unavailable.');
}
require_once $whmcsRoot . '/init.php';
require_once __DIR__ . '/bootstrap.php';

use CloudHost247\CartRecovery\Log;
use CloudHost247\CartRecovery\RecoveryService;

/** Minimal, CloudHost247-branded response page for the failure paths. */
function cloudhost247_cart_recovery_page($title, $message, $httpStatus = 200)
{
    http_response_code($httpStatus);
    $companyName = \CloudHost247\CartRecovery\EmailService::companyName();
    $home = RecoveryService::baseUrl();
    $escape = function ($value) {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    };
    header('Content-Type: text/html; charset=utf-8');
    header('X-Robots-Tag: noindex, nofollow');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<meta name="robots" content="noindex,nofollow">'
        . '<title>' . $escape($title) . ' &middot; ' . $escape($companyName) . '</title>'
        . '<style>body{margin:0;background:#f5f7fb;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#1d2433}'
        . '.wrap{max-width:620px;margin:10vh auto;padding:0 20px}.card{background:#fff;border-radius:10px;padding:36px;'
        . 'box-shadow:0 8px 30px rgba(16,32,64,.08)}h1{font-size:24px;margin:0 0 12px}a.btn{display:inline-block;margin-top:22px;'
        . 'background:#0b5fff;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px}'
        . '.brand{font-weight:700;color:#0b5fff;margin-bottom:18px}</style></head><body><div class="wrap"><div class="card">'
        . '<div class="brand">' . $escape($companyName) . '</div>'
        . '<h1>' . $escape($title) . '</h1><p>' . $escape($message) . '</p>'
        . ($home ? '<a class="btn" href="' . $escape($home) . '">Return to the store</a>' : '')
        . '</div></div></body></html>';
}

$token = isset($_GET['token']) ? (string) $_GET['token'] : '';
$action = isset($_GET['action']) ? (string) $_GET['action'] : 'recover';

try {
    if ($action === 'unsubscribe') {
        $result = RecoveryService::unsubscribe($token);
        if ($result['ok']) {
            cloudhost247_cart_recovery_page(
                'You have been unsubscribed',
                'You will not receive any further abandoned-cart reminders from us. Your account and any existing orders are unaffected.'
            );
        } else {
            cloudhost247_cart_recovery_page(
                'This unsubscribe link is no longer valid',
                'The link may already have been used or has expired. If you keep receiving reminders, please contact our support team.',
                404
            );
        }
        exit;
    }

    $result = RecoveryService::recover($token);
    if ($result['ok']) {
        $target = RecoveryService::baseUrl() . '/cart.php?a=view';
        header('Location: ' . $target, true, 302);
        exit;
    }

    switch ($result['reason']) {
        case 'expired':
            cloudhost247_cart_recovery_page(
                'This cart link has expired',
                'For security, saved-cart links are only valid for a limited time. You can start a new order from our store at any time.',
                410
            );
            break;
        case 'already_converted':
            cloudhost247_cart_recovery_page(
                'This cart has already been ordered',
                'An order was already placed for this cart, so there is nothing left to restore. You can review it in your client area.',
                410
            );
            break;
        case 'empty_cart':
        case 'closed':
            cloudhost247_cart_recovery_page(
                'This saved cart is no longer available',
                'The cart it refers to has since been emptied or closed. Please start a new cart from our store.',
                410
            );
            break;
        default:
            cloudhost247_cart_recovery_page(
                'This cart link is not valid',
                'We could not restore a cart from this link. Please start a new cart from our store.',
                404
            );
    }
} catch (\Throwable $e) {
    Log::error('recovery.endpoint_failed', array('error' => Log::safeError($e)));
    cloudhost247_cart_recovery_page(
        'Something went wrong',
        'We could not process that link right now. Please try again shortly or start a new cart from our store.',
        500
    );
}
