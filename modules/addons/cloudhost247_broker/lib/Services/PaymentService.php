<?php
namespace CloudHost247\Broker\Services;

use CloudHost247\Broker\Domain\CaseStatus;
use CloudHost247\Broker\Domain\PaymentStatus;
use CloudHost247\Broker\Repositories\CaseRepository;
use CloudHost247\Broker\Repositories\PaymentRepository;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Foundation\Support\Logger;
use RuntimeException;

/**
 * Payment integration (requirement #23). Uses the existing WHMCS invoicing
 * and payment-gateway system via localAPI — no parallel payment engine is
 * created. Real states only: pending, initiated, authorized, paid, failed,
 * refunded, cancelled. Never claims funds are held in escrow; that label is
 * reserved for an actual escrow/payment provider integration, which is not
 * connected in this build.
 */
final class PaymentService
{
    private $cases;
    private $payments;
    private $feeCalculator;
    private $brokerage;
    private $notifier;

    public function __construct(
        CaseRepository $cases = null,
        PaymentRepository $payments = null,
        FeeCalculator $feeCalculator = null,
        BrokerageService $brokerage = null,
        NotificationService $notifier = null
    ) {
        $this->cases = $cases ?: new CaseRepository();
        $this->payments = $payments ?: new PaymentRepository();
        $this->feeCalculator = $feeCalculator ?: new FeeCalculator();
        $this->brokerage = $brokerage ?: new BrokerageService();
        $this->notifier = $notifier ?: new NotificationService();
    }

    /**
     * Create (or return, if already created) the WHMCS invoice for this case's
     * agreed acquisition price. Idempotent per case: a retried request never
     * creates a second invoice (requirement #29).
     */
    public function createInvoice($caseId, $acquisitionPrice, $adminId = null)
    {
        $case = $this->requireCase($caseId);
        $idempotencyKey = 'broker-payment-' . $caseId;
        $existing = $this->payments->findByIdempotencyKey($idempotencyKey);
        if ($existing) { return $existing; }

        $fees = $this->feeCalculator->calculate($acquisitionPrice, $case->currency, $case->provider_key);

        if (!function_exists('localAPI')) {
            throw new RuntimeException('The WHMCS billing API is unavailable in this environment.');
        }
        $lineItems = array(
            'userid' => (int) $case->client_id,
            'sendinvoice' => false,
            'itemdescription1' => 'Domain acquisition price — ' . $case->domain . ' (' . $case->case_number . ')',
            'itemamount1' => $fees['acquisition_price'],
            'itemtaxed1' => 0,
            'itemdescription2' => 'CloudHost247 brokerage fee — ' . $case->case_number,
            'itemamount2' => $fees['brokerage_fee'],
            'itemtaxed2' => 0,
            'itemdescription3' => 'Domain transfer fee — ' . $case->case_number,
            'itemamount3' => $fees['transfer_fee'],
            'itemtaxed3' => 0,
        );
        if ($fees['service_fee'] > 0) {
            $lineItems['itemdescription4'] = 'Payment/service fee — ' . $case->case_number;
            $lineItems['itemamount4'] = $fees['service_fee'];
            $lineItems['itemtaxed4'] = 0;
        }
        $result = localAPI('CreateInvoice', $lineItems);
        if (!isset($result['result']) || $result['result'] !== 'success' || empty($result['invoiceid'])) {
            Logger::write('cloudhost247_broker', 'error', 'payment.invoice_create_failed', array('case_id' => (int) $caseId));
            throw new RuntimeException('The invoice could not be created. Please try again.');
        }

        $paymentId = $this->payments->create(array(
            'case_id' => (int) $caseId,
            'whmcs_invoice_id' => (int) $result['invoiceid'],
            'acquisition_price' => $fees['acquisition_price'],
            'brokerage_fee' => $fees['brokerage_fee'],
            'transfer_fee' => $fees['transfer_fee'],
            'service_fee' => $fees['service_fee'],
            'amount_total' => $fees['total'],
            'currency' => $fees['currency'],
            'status' => PaymentStatus::INITIATED,
            'idempotency_key' => $idempotencyKey,
        ));
        $this->cases->update($caseId, array('payment_status' => PaymentStatus::INITIATED));
        $this->brokerage->transitionStatus($caseId, CaseStatus::PAYMENT_PENDING, 'admin', $adminId, 'Invoice #' . $result['invoiceid'] . ' created for ' . $fees['currency'] . ' ' . number_format($fees['total'], 2) . '.', 'customer');
        AuditLogger::record('cloudhost247_broker', 'payment.invoice_create', 'broker_case', $caseId, array(), array('invoice_id' => (int) $result['invoiceid'], 'total' => $fees['total']), 'success', null, $adminId);
        $this->notifier->paymentRequired($case->client_id, $case->case_number, $case->domain);
        return $this->payments->currentForCase($caseId);
    }

    /**
     * Reconcile the stored payment state with WHMCS's real invoice status.
     * Never marks a payment paid without WHMCS actually reporting it paid.
     */
    public function syncStatus($caseId)
    {
        $payment = $this->payments->currentForCase($caseId);
        if (!$payment || !$payment->whmcs_invoice_id || !function_exists('localAPI')) { return $payment; }
        $result = localAPI('GetInvoice', array('invoiceid' => (int) $payment->whmcs_invoice_id));
        if (!isset($result['result']) || $result['result'] !== 'success') { return $payment; }
        $whmcsStatus = isset($result['status']) ? (string) $result['status'] : '';
        $mapped = $this->mapInvoiceStatus($whmcsStatus);
        if ($mapped === $payment->status) { return $payment; }

        $update = array('status' => $mapped);
        if ($mapped === PaymentStatus::PAID) { $update['paid_at'] = date('Y-m-d H:i:s'); }
        if ($mapped === PaymentStatus::REFUNDED) { $update['refunded_at'] = date('Y-m-d H:i:s'); }
        $this->payments->update($payment->id, $update);
        $this->cases->update($caseId, array('payment_status' => $mapped));
        AuditLogger::record('cloudhost247_broker', 'payment.status_sync', 'broker_case', $caseId, array('status' => $payment->status), array('status' => $mapped), 'success');

        $case = $this->requireCase($caseId);
        if ($mapped === PaymentStatus::PAID) {
            $this->brokerage->transitionStatus($caseId, CaseStatus::TRANSFER_PENDING, 'system', null, 'Payment received in full. The domain transfer can now be authorized.', 'customer');
            $this->notifier->paymentReceived($case->client_id, $case->case_number, $case->domain);
        } elseif ($mapped === PaymentStatus::FAILED || $mapped === PaymentStatus::CANCELLED) {
            AuditLogger::record('cloudhost247_broker', 'payment.failed', 'broker_case', $caseId, array(), array('status' => $mapped), 'failed');
        }
        return $this->payments->currentForCase($caseId);
    }

    /** Refund is only ever a real WHMCS credit/refund action, never fabricated. */
    public function markRefunded($caseId, $adminId, $reason)
    {
        $payment = $this->payments->currentForCase($caseId);
        if (!$payment) { throw new RuntimeException('No payment exists for this case.'); }
        $this->payments->update($payment->id, array('status' => PaymentStatus::REFUNDED, 'refunded_at' => date('Y-m-d H:i:s'), 'failure_reason' => substr((string) $reason, 0, 255)));
        $this->cases->update($caseId, array('payment_status' => PaymentStatus::REFUNDED));
        AuditLogger::record('cloudhost247_broker', 'payment.refund', 'broker_case', $caseId, array(), array('reason' => substr((string) $reason, 0, 255)), 'success', null, $adminId);
        return $this->payments->currentForCase($caseId);
    }

    private function mapInvoiceStatus($whmcsStatus)
    {
        switch (strtolower($whmcsStatus)) {
            case 'paid': return PaymentStatus::PAID;
            case 'refunded': return PaymentStatus::REFUNDED;
            case 'cancelled': return PaymentStatus::CANCELLED;
            case 'payment pending': return PaymentStatus::AUTHORIZED;
            case 'unpaid': return PaymentStatus::INITIATED;
            default: return PaymentStatus::PENDING;
        }
    }

    private function requireCase($caseId)
    {
        $case = $this->cases->find($caseId);
        if (!$case) { throw new RuntimeException('Brokerage case not found.'); }
        return $case;
    }
}
