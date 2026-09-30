<?php
/**
 * CloudHost247 Payments.
 *
 * Super Admin management for the platform's payment gateways, starting with the EXISTING
 * Blockonomics cryptocurrency gateway: master switch, per-currency availability (BTC/BCH/USDT),
 * confirmation requirement, payment window, USDT network + receiving address, server-side
 * connection testing, normalized transaction listing, and full audit logging through the
 * CloudHost247 Foundation.
 *
 * This addon stores NO credentials and creates NO payment tables: settings live in the
 * existing tblpaymentgateways configuration, credentials in the CloudHost247 API & Integrations
 * vault (with the legacy WHMCS gateway field as fallback), and transactions in the existing
 * blockonomics_orders / tblaccounts records. Deactivation removes nothing.
 */
if (!defined('WHMCS')) { die('Direct access denied'); }

require_once __DIR__ . '/bootstrap.php';

use CloudHost247\Payments\Services\AdminController;
use CloudHost247\Payments\Services\TransactionsView;
use WHMCS\Database\Capsule;

function cloudhost247_payments_config()
{
    return array(
        'name' => 'CloudHost247 Payments',
        'description' => 'Payment gateway management: Blockonomics cryptocurrency controls (gateway/BTC/USDT switches, USDT network, confirmations, connection test) and the cryptocurrency transaction ledger view. Uses the existing gateway, billing records and the API & Integrations credential vault.',
        'version' => '1.0.0',
        'author' => 'CloudHost247',
        'language' => 'english',
        'fields' => array(),
    );
}

function cloudhost247_payments_activate()
{
    // No schema of its own: the module governs the existing Blockonomics gateway configuration
    // and reads the existing blockonomics_orders / WHMCS billing tables. Capability rows
    // (payments.configure / payments.gateway.test / payments.crypto.view) may optionally be
    // added in mod_cloudhost247_capabilities to restrict specific WHMCS admin roles; absent
    // rows fall back to the standard WHMCS addon-permission model.
    $note = 'Payments management installed. No tables created; existing payment records are untouched.';
    try {
        if (Capsule::schema()->hasTable('blockonomics_orders')) {
            $count = Capsule::table('blockonomics_orders')->count();
            $note .= ' Detected existing Blockonomics configuration with ' . $count . ' historical order record(s) — all remain accessible.';
        }
    } catch (\Throwable $error) {
        // Detection is informational only; activation never fails because of it.
    }
    return array('status' => 'success', 'description' => $note);
}

function cloudhost247_payments_deactivate()
{
    return array('status' => 'success', 'description' => 'Data retained for safe rollback. Gateway configuration, Blockonomics orders and WHMCS payment records were not modified.');
}

function cloudhost247_payments_output($vars)
{
    // The existing Blockonomics gateway library provides the settings resolver used everywhere.
    require_once __DIR__ . '/../../gateways/blockonomics/lib/GatewaySettings.php';

    $view = isset($_REQUEST['view']) ? (string) $_REQUEST['view'] : 'blockonomics';
    try {
        if ($view === 'transactions') {
            echo (new TransactionsView())->handle();
            return;
        }
        echo (new AdminController())->handle();
    } catch (\Throwable $error) {
        // Never leak internals (spec §40): capability denials and unexpected failures render
        // the same sanitized pattern used across CloudHost247 admin modules.
        echo '<div class="alert alert-danger">' . htmlspecialchars($error instanceof RuntimeException
            ? $error->getMessage()
            : 'The page could not be displayed. Check the CloudHost247 activity log.', ENT_QUOTES, 'UTF-8') . '</div>';
    }
}
