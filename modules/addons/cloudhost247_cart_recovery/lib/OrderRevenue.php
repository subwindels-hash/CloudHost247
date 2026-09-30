<?php
/**
 * Authoritative revenue lookup.
 *
 * Recovered revenue must come from WHMCS's own order/invoice records, never
 * from the browser-submitted cart snapshot. Schema differences between WHMCS
 * versions are handled by probing for columns instead of assuming them.
 */

namespace CloudHost247\CartRecovery;

use WHMCS\Database\Capsule;

final class OrderRevenue
{
    /**
     * @return array{order_id:int,invoice_id:int,amount:float|null,currency:string}
     */
    public static function lookup($orderId, $invoiceId = 0, $clientId = 0)
    {
        $result = array('order_id' => (int) $orderId, 'invoice_id' => (int) $invoiceId, 'amount' => null, 'currency' => '');
        try {
            $order = null;
            if ($orderId) {
                $order = Capsule::table('tblorders')->where('id', (int) $orderId)->first();
            }
            if (!$order && $invoiceId) {
                $order = Capsule::table('tblorders')->where('invoiceid', (int) $invoiceId)->orderBy('id', 'desc')->first();
            }
            if (!$order && $clientId) {
                $order = Capsule::table('tblorders')->where('userid', (int) $clientId)->orderBy('id', 'desc')->first();
            }
            if ($order) {
                $result['order_id'] = (int) $order->id;
                if (isset($order->invoiceid) && $order->invoiceid) {
                    $result['invoice_id'] = (int) $order->invoiceid;
                }
                if (isset($order->amount) && is_numeric($order->amount)) {
                    $result['amount'] = round((float) $order->amount, 2);
                }
            }
            // The invoice total is the most authoritative figure once one
            // exists (taxes, promotions and manual adjustments are applied).
            if ($result['invoice_id']) {
                $invoice = Capsule::table('tblinvoices')->where('id', $result['invoice_id'])->first();
                if ($invoice) {
                    if (isset($invoice->total) && is_numeric($invoice->total)) {
                        $result['amount'] = round((float) $invoice->total, 2);
                    }
                    if (isset($invoice->currency) && $invoice->currency) {
                        $result['currency'] = self::currencyCode((int) $invoice->currency);
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::error('revenue.lookup_failed', array('error' => Log::safeError($e)));
        }
        return $result;
    }

    private static function currencyCode($currencyId)
    {
        try {
            $row = Capsule::table('tblcurrencies')->where('id', (int) $currencyId)->first();
            if ($row && isset($row->code)) {
                return substr((string) $row->code, 0, 8);
            }
        } catch (\Throwable $e) {
            // Non-fatal: currency is display-only here.
        }
        return '';
    }
}
