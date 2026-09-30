<?php
/**
 * WHMCS hook integration for CloudHost247 Cart Recovery.
 *
 * WHMCS only loads hooks.php for an *active* addon, so deactivating the
 * module stops all tracking. Every hook body is wrapped in try/catch and
 * returns nothing: a failure here must never interrupt the shopping cart,
 * the checkout or the order pipeline.
 */

if (!defined('WHMCS')) {
    die('Direct access denied');
}

require_once __DIR__ . '/bootstrap.php';

use CloudHost247\CartRecovery\CartSnapshot;
use CloudHost247\CartRecovery\Log;
use CloudHost247\CartRecovery\RecoveryService;
use CloudHost247\CartRecovery\Schema;
use CloudHost247\CartRecovery\SettingsRepository;

/** Opaque, non-reversible identifier for the current guest session. */
function cloudhost247_cart_recovery_session_key()
{
    $id = function_exists('session_id') ? (string) session_id() : '';
    if ($id === '') {
        // No PHP session id available: fall back to a random per-session
        // marker so guest carts can still be identified without ever using
        // the email address as an identity.
        if (empty($_SESSION['ch247_cart_recovery_sid'])) {
            $_SESSION['ch247_cart_recovery_sid'] = bin2hex(random_bytes(16));
        }
        $id = (string) $_SESSION['ch247_cart_recovery_sid'];
    }
    // The raw PHP session id is a credential, so only a hash of it is stored.
    return hash('sha256', 'cloudhost247-cart-session:' . $id);
}

function cloudhost247_cart_recovery_current_client()
{
    if (isset($_SESSION['uid']) && (int) $_SESSION['uid'] > 0) {
        return (int) $_SESSION['uid'];
    }
    if (isset($_SESSION['adminid'], $_SESSION['userid']) && (int) $_SESSION['userid'] > 0) {
        return (int) $_SESSION['userid'];
    }
    return 0;
}

/** Name/email of the logged-in client, when WHMCS can supply them cheaply. */
function cloudhost247_cart_recovery_client_details($clientId)
{
    $details = array('email' => '', 'first_name' => '', 'last_name' => '');
    if ($clientId <= 0) {
        return $details;
    }
    try {
        $client = \WHMCS\Database\Capsule::table('tblclients')
            ->where('id', (int) $clientId)
            ->first(array('email', 'firstname', 'lastname'));
        if ($client) {
            $details['email'] = (string) $client->email;
            $details['first_name'] = (string) $client->firstname;
            $details['last_name'] = (string) $client->lastname;
        }
    } catch (\Throwable $e) {
        Log::error('hook.client_lookup_failed', array('error' => Log::safeError($e)));
    }
    return $details;
}

/**
 * ClientAreaPageCart — detect meaningful cart activity.
 *
 * Kept deliberately cheap: when the cart fingerprint has not changed since
 * the last write in this session, no database work is done at all.
 */
function cloudhost247_cart_recovery_page_cart($vars = array())
{
    try {
        if (!SettingsRepository::enabled('enabled')) {
            return;
        }
        $cart = isset($_SESSION['cart']) && is_array($_SESSION['cart']) ? $_SESSION['cart'] : array();
        $clientId = cloudhost247_cart_recovery_current_client();
        $sessionKey = cloudhost247_cart_recovery_session_key();
        $fingerprint = CartSnapshot::fingerprint($cart);
        $empty = CartSnapshot::isEmpty($cart);

        $seen = isset($_SESSION['ch247_cart_recovery_fp']) ? (string) $_SESSION['ch247_cart_recovery_fp'] : '';
        if ($seen === $fingerprint && !$empty) {
            return; // Nothing meaningful changed on this page view.
        }
        $_SESSION['ch247_cart_recovery_fp'] = $fingerprint;

        $details = cloudhost247_cart_recovery_client_details($clientId);
        $currency = '';
        if (isset($vars['currency']['code'])) {
            $currency = (string) $vars['currency']['code'];
        } elseif (isset($_SESSION['currency']) && is_scalar($_SESSION['currency'])) {
            $currency = (string) $_SESSION['currency'];
        }
        $totals = array();
        foreach (array('subtotal', 'discount', 'total') as $key) {
            if (isset($vars[$key]) && is_numeric(preg_replace('/[^0-9.\-]/', '', (string) $vars[$key]))) {
                $totals[$key] = (float) preg_replace('/[^0-9.\-]/', '', (string) $vars[$key]);
            }
        }

        RecoveryService::capture(array(
            'cart' => $cart,
            'client_id' => $clientId,
            'session_key' => $sessionKey,
            'email' => $details['email'],
            'first_name' => $details['first_name'],
            'last_name' => $details['last_name'],
            'currency' => $currency,
            'totals' => $totals,
        ));
    } catch (\Throwable $e) {
        Log::error('hook.page_cart_failed', array('error' => Log::safeError($e)));
    }
}

/**
 * ShoppingCartValidateCheckout — capture the email supplied at checkout,
 * including for guests. Returning an empty array keeps checkout validation
 * untouched.
 */
function cloudhost247_cart_recovery_validate_checkout($vars = array())
{
    try {
        if (!SettingsRepository::enabled('enabled')) {
            return array();
        }
        $clientId = cloudhost247_cart_recovery_current_client();
        $email = '';
        foreach (array('email', 'emailaddress') as $field) {
            if (!empty($vars[$field]) && is_string($vars[$field])) {
                $email = $vars[$field];
                break;
            }
        }
        if ($email === '' && $clientId > 0) {
            $details = cloudhost247_cart_recovery_client_details($clientId);
            $email = $details['email'];
        }
        // A supplied email address is never linked to an existing client
        // account here: the record stays a guest record unless WHMCS itself
        // says the visitor is authenticated.
        RecoveryService::attachEmail(
            $email,
            $clientId,
            cloudhost247_cart_recovery_session_key(),
            array(
                'cart' => isset($_SESSION['cart']) && is_array($_SESSION['cart']) ? $_SESSION['cart'] : array(),
                'first_name' => isset($vars['firstname']) ? (string) $vars['firstname'] : '',
                'last_name' => isset($vars['lastname']) ? (string) $vars['lastname'] : '',
                'currency' => isset($_SESSION['currency']) && is_scalar($_SESSION['currency']) ? (string) $_SESSION['currency'] : '',
            )
        );
    } catch (\Throwable $e) {
        Log::error('hook.validate_checkout_failed', array('error' => Log::safeError($e)));
    }
    return array(); // No validation errors are ever introduced by this addon.
}

/**
 * AfterShoppingCartCheckout — the cart produced a WHMCS order, so the
 * matching recovery record is converted and all reminders stop.
 */
function cloudhost247_cart_recovery_after_checkout($vars = array())
{
    try {
        $clientId = isset($vars['UserID']) ? (int) $vars['UserID'] : cloudhost247_cart_recovery_current_client();
        $orderId = 0;
        foreach (array('OrderID', 'orderid', 'order_id') as $key) {
            if (!empty($vars[$key])) {
                $orderId = (int) $vars[$key];
                break;
            }
        }
        $invoiceId = 0;
        foreach (array('InvoiceID', 'invoiceid') as $key) {
            if (!empty($vars[$key])) {
                $invoiceId = (int) $vars[$key];
                break;
            }
        }
        RecoveryService::convertForCheckout($clientId, cloudhost247_cart_recovery_session_key(), $orderId, $invoiceId);
        unset($_SESSION['ch247_cart_recovery_fp']);
    } catch (\Throwable $e) {
        Log::error('hook.after_checkout_failed', array('error' => Log::safeError($e)));
    }
}

/**
 * OrderPaid — secondary conversion safeguard for orders whose checkout hook
 * did not match (for example payment completed later from an invoice).
 */
function cloudhost247_cart_recovery_order_paid($vars = array())
{
    try {
        $orderId = isset($vars['orderId']) ? (int) $vars['orderId'] : (isset($vars['orderid']) ? (int) $vars['orderid'] : 0);
        if ($orderId <= 0) {
            return;
        }
        $order = \WHMCS\Database\Capsule::table('tblorders')->where('id', $orderId)->first();
        if (!$order || empty($order->userid)) {
            return;
        }
        $clientId = (int) $order->userid;
        // Already recorded against this order? Nothing to do.
        $already = RecoveryService::table()->where('order_id', $orderId)->where('status', Schema::STATUS_CONVERTED)->count();
        if ($already > 0) {
            return;
        }
        RecoveryService::convertForCheckout($clientId, '', $orderId, isset($order->invoiceid) ? (int) $order->invoiceid : 0);
    } catch (\Throwable $e) {
        Log::error('hook.order_paid_failed', array('error' => Log::safeError($e)));
    }
}

if (function_exists('add_hook')) {
    add_hook('ClientAreaPageCart', 1, 'cloudhost247_cart_recovery_page_cart');
    add_hook('ShoppingCartValidateCheckout', 1, 'cloudhost247_cart_recovery_validate_checkout');
    add_hook('AfterShoppingCartCheckout', 1, 'cloudhost247_cart_recovery_after_checkout');
    add_hook('OrderPaid', 1, 'cloudhost247_cart_recovery_order_paid');
}
