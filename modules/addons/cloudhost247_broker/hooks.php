<?php
if (!defined('WHMCS')) { die('Direct access denied'); }

require_once __DIR__ . '/bootstrap.php';

use CloudHost247\Broker\Repositories\PaymentRepository;
use CloudHost247\Broker\Services\PaymentService;
use CloudHost247\Foundation\Support\Logger;

/**
 * Keep a brokerage case's payment state in sync with the real WHMCS invoice
 * the moment WHMCS itself reports it paid/refunded/cancelled — instead of
 * waiting for an admin to click "Refresh payment status" (requirement #23).
 * Every hook is defensive: a brokerage-unrelated invoice is a fast no-op.
 */
function cloudhost247_broker_sync_invoice($vars)
{
    if (empty($vars['invoiceid'])) { return; }
    try {
        $payment = (new PaymentRepository())->findByInvoiceId((int) $vars['invoiceid']);
        if (!$payment) { return; }
        (new PaymentService())->syncStatus($payment->case_id);
    } catch (\Throwable $e) {
        Logger::write('cloudhost247_broker', 'error', 'hook.invoice_sync_failed', array('message' => $e->getMessage(), 'invoice_id' => isset($vars['invoiceid']) ? (int) $vars['invoiceid'] : null));
    }
}

if (function_exists('add_hook')) {
    add_hook('InvoicePaid', 1, 'cloudhost247_broker_sync_invoice');
    add_hook('InvoiceRefunded', 1, 'cloudhost247_broker_sync_invoice');
    add_hook('InvoiceCancelled', 1, 'cloudhost247_broker_sync_invoice');
}
