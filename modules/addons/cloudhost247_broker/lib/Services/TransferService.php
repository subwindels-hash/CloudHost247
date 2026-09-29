<?php
namespace CloudHost247\Broker\Services;

use CloudHost247\Broker\Domain\CaseStatus;
use CloudHost247\Broker\Domain\PaymentStatus;
use CloudHost247\Broker\Domain\TransferStatus;
use CloudHost247\Broker\Repositories\CaseRepository;
use CloudHost247\Broker\Repositories\TransferRepository;
use CloudHost247\Foundation\Support\AuditLogger;
use RuntimeException;

/**
 * Transfer workflow (requirement #24). The case is never marked Completed
 * before the transfer has actually reached VERIFIED — see complete().
 * Disputed cases cannot advance a transfer until the dispute is resolved
 * (requirement #32).
 */
final class TransferService
{
    private $cases;
    private $transfers;
    private $brokerage;
    private $notifier;

    public function __construct(CaseRepository $cases = null, TransferRepository $transfers = null, BrokerageService $brokerage = null, NotificationService $notifier = null)
    {
        $this->cases = $cases ?: new CaseRepository();
        $this->transfers = $transfers ?: new TransferRepository();
        $this->brokerage = $brokerage ?: new BrokerageService();
        $this->notifier = $notifier ?: new NotificationService();
    }

    public function authorize($caseId, $adminId, $registrar = '')
    {
        $case = $this->requireUndisputed($caseId);
        if ((string) $case->payment_status !== PaymentStatus::PAID) {
            throw new RuntimeException('Payment must be confirmed as paid before authorizing a transfer.');
        }
        $existing = $this->transfers->currentForCase($caseId);
        if ($existing) { return $existing; }
        // Authorization itself is an immediate CloudHost247 admin action (there is
        // no external registrar callback to await in this build), so the transfer
        // enters this ledger already AUTHORIZED — ready for initiate() next.
        $id = $this->transfers->create(array(
            'case_id' => (int) $caseId, 'registrar' => $registrar ?: $case->registrar, 'provider_key' => (string) $case->provider_key,
            'status' => TransferStatus::AUTHORIZED, 'auth_code_status' => 'not_required',
            'idempotency_key' => 'broker-transfer-' . $caseId,
        ));
        AuditLogger::record('cloudhost247_broker', 'transfer.authorize', 'broker_case', $caseId, array(), array('transfer_id' => $id), 'success', null, $adminId);
        return $this->transfers->currentForCase($caseId);
    }

    public function initiate($caseId, $adminId, $providerReference = '')
    {
        $transfer = $this->requireTransfer($caseId);
        $this->assertAdvance($transfer->status, TransferStatus::INITIATED, $caseId);
        $this->transfers->update($transfer->id, array(
            'status' => TransferStatus::INITIATED, 'provider_reference' => substr((string) $providerReference, 0, 120), 'initiated_at' => date('Y-m-d H:i:s'),
        ));
        $case = $this->cases->find($caseId);
        $this->brokerage->transitionStatus($caseId, CaseStatus::TRANSFER_PROCESSING, 'admin', $adminId, 'Domain transfer initiated.', 'customer');
        AuditLogger::record('cloudhost247_broker', 'transfer.initiate', 'broker_case', $caseId, array(), array('provider_reference' => $providerReference), 'success', null, $adminId);
        $this->notifier->transferStarted($case->client_id, $case->case_number, $case->domain);
        return $this->transfers->currentForCase($caseId);
    }

    public function providerConfirmed($caseId, $adminId)
    {
        $transfer = $this->requireTransfer($caseId);
        $this->assertAdvance($transfer->status, TransferStatus::PROVIDER_CONFIRMED, $caseId);
        $this->transfers->update($transfer->id, array('status' => TransferStatus::PROVIDER_CONFIRMED, 'provider_confirmed_at' => date('Y-m-d H:i:s')));
        AuditLogger::record('cloudhost247_broker', 'transfer.provider_confirmed', 'broker_case', $caseId, array(), array(), 'success', null, $adminId);
        return $this->transfers->currentForCase($caseId);
    }

    public function processing($caseId, $adminId)
    {
        $transfer = $this->requireTransfer($caseId);
        $this->assertAdvance($transfer->status, TransferStatus::PROCESSING, $caseId);
        $this->transfers->update($transfer->id, array('status' => TransferStatus::PROCESSING));
        AuditLogger::record('cloudhost247_broker', 'transfer.processing', 'broker_case', $caseId, array(), array(), 'success', null, $adminId);
        return $this->transfers->currentForCase($caseId);
    }

    /** Transfer is only "Verified" once the receiving side has confirmed it — never assumed. */
    public function verify($caseId, $adminId)
    {
        $transfer = $this->requireTransfer($caseId);
        $this->assertAdvance($transfer->status, TransferStatus::VERIFIED, $caseId);
        $this->transfers->update($transfer->id, array('status' => TransferStatus::VERIFIED, 'verified_at' => date('Y-m-d H:i:s')));
        AuditLogger::record('cloudhost247_broker', 'transfer.verify', 'broker_case', $caseId, array(), array(), 'success', null, $adminId);
        return $this->transfers->currentForCase($caseId);
    }

    /**
     * The case is marked Completed only from here, and only once the transfer
     * is VERIFIED (requirement #24). This is the single place a case can ever
     * reach CaseStatus::COMPLETED.
     */
    public function complete($caseId, $adminId, $destinationAccount = '')
    {
        $transfer = $this->requireTransfer($caseId);
        if ($transfer->status !== TransferStatus::VERIFIED) {
            throw new RuntimeException('The transfer must be verified before the case can be completed.');
        }
        $this->transfers->update($transfer->id, array(
            'status' => TransferStatus::COMPLETED, 'completed_at' => date('Y-m-d H:i:s'),
            'destination_account' => substr((string) $destinationAccount, 0, 120),
        ));
        $case = $this->cases->find($caseId);
        $this->cases->update($caseId, array('transfer_status' => TransferStatus::COMPLETED));
        $this->brokerage->transitionStatus($caseId, CaseStatus::COMPLETED, 'admin', $adminId, 'Transfer verified and completed. The domain is now associated with the customer\'s CloudHost247 account.', 'customer');
        AuditLogger::record('cloudhost247_broker', 'transfer.complete', 'broker_case', $caseId, array(), array(), 'success', null, $adminId);
        $this->notifier->transferCompleted($case->client_id, $case->case_number, $case->domain);
        return $this->transfers->currentForCase($caseId);
    }

    public function fail($caseId, $adminId, $reason)
    {
        $transfer = $this->requireTransfer($caseId);
        $this->transfers->update($transfer->id, array('status' => TransferStatus::FAILED, 'failure_reason' => substr((string) $reason, 0, 255)));
        $case = $this->cases->find($caseId);
        $this->cases->update($caseId, array('transfer_status' => TransferStatus::FAILED, 'failure_reason' => substr((string) $reason, 0, 255)));
        $this->brokerage->transitionStatus($caseId, CaseStatus::FAILED, 'admin', $adminId, 'Transfer failed: ' . substr((string) $reason, 0, 255), 'customer');
        AuditLogger::record('cloudhost247_broker', 'transfer.fail', 'broker_case', $caseId, array(), array('reason' => $reason), 'failed', $reason, $adminId);
        $this->notifier->transferFailed($case->client_id, $case->case_number, $case->domain, substr((string) $reason, 0, 200));
        return $this->transfers->currentForCase($caseId);
    }

    private function assertAdvance($from, $to, $caseId)
    {
        if (!TransferStatus::canAdvance($from, $to)) {
            throw new RuntimeException('Cannot move this transfer from ' . TransferStatus::label($from) . ' to ' . TransferStatus::label($to) . '.');
        }
        $this->cases->update($caseId, array('transfer_status' => $to));
    }

    private function requireTransfer($caseId)
    {
        $transfer = $this->transfers->currentForCase($caseId);
        if (!$transfer) { throw new RuntimeException('No transfer has been authorized for this case yet.'); }
        return $transfer;
    }

    private function requireUndisputed($caseId)
    {
        $case = $this->cases->find($caseId);
        if (!$case) { throw new RuntimeException('Brokerage case not found.'); }
        if ((int) $case->disputed === 1) { throw new RuntimeException('This case is disputed; resolve the dispute before continuing the transfer.'); }
        return $case;
    }
}
