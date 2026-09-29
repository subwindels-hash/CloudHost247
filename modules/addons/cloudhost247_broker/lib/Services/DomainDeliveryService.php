<?php
namespace CloudHost247\Broker\Services;

use CloudHost247\Broker\Domain\TransferStatus;
use CloudHost247\Broker\Repositories\CaseRepository;
use CloudHost247\Broker\Repositories\EventRepository;
use CloudHost247\Broker\Repositories\TransferRepository;
use CloudHost247\Broker\Security\InputValidator;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Foundation\Support\Logger;
use RuntimeException;

/**
 * Domain delivery — associating a verified, completed transfer with the
 * customer's CloudHost247 account (requirement #25).
 *
 * Honesty rules enforced here:
 *  - The service never writes to WHMCS core domain tables directly. Every
 *    association goes through WHMCS's own administrative API (localAPI), the
 *    same architecture WHMCS itself uses to attach a domain to a client.
 *  - Association is confirmed, never assumed: after a create call the service
 *    re-reads the client domain list and only reports "associated" when the
 *    domain record is actually there and owned by this case's customer.
 *  - Idempotent: a retried delivery never creates a second domain record
 *    (requirement #29). An existing record for this customer is detected and
 *    adopted; a record belonging to a different account is a real conflict,
 *    recorded as failed — never silently overridden.
 *  - When WHMCS cannot complete the association in this environment (API
 *    unavailable or the action unsupported by the running WHMCS version), the
 *    state is an explicit, operator-visible "pending_manual" with the exact
 *    manual step an administrator must take — never a fabricated success.
 */
final class DomainDeliveryService
{
    const STATUS_PENDING = 'pending';
    const STATUS_ASSOCIATED = 'associated';
    const STATUS_PENDING_MANUAL = 'pending_manual';
    const STATUS_FAILED = 'failed';

    private $cases;
    private $transfers;
    private $events;
    private $notifier;

    public function __construct(CaseRepository $cases = null, TransferRepository $transfers = null, EventRepository $events = null, NotificationService $notifier = null)
    {
        $this->cases = $cases ?: new CaseRepository();
        $this->transfers = $transfers ?: new TransferRepository();
        $this->events = $events ?: new EventRepository();
        $this->notifier = $notifier ?: new NotificationService();
    }

    public static function statuses()
    {
        return array(self::STATUS_PENDING, self::STATUS_ASSOCIATED, self::STATUS_PENDING_MANUAL, self::STATUS_FAILED);
    }

    /** Human label for a stored delivery status (admin + customer views). */
    public static function label($status)
    {
        switch ((string) $status) {
            case self::STATUS_ASSOCIATED: return 'Delivered to customer account';
            case self::STATUS_PENDING_MANUAL: return 'Awaiting manual account linking';
            case self::STATUS_FAILED: return 'Delivery failed';
            case self::STATUS_PENDING:
            default: return 'Not delivered yet';
        }
    }

    /**
     * The delivery status to display even when a transfer row predates the
     * V110 delivery columns (older installs upgraded in place).
     */
    public static function statusOf($transfer)
    {
        if (!$transfer) { return self::STATUS_PENDING; }
        $status = isset($transfer->delivery_status) ? (string) $transfer->delivery_status : '';
        return in_array($status, self::statuses(), true) ? $status : self::STATUS_PENDING;
    }

    /**
     * Attempt to associate the case's domain with the customer's CloudHost247
     * account. Called by TransferService::complete() and by the admin "Retry
     * delivery" action. Returns the refreshed transfer row.
     */
    public function associate($caseId, $adminId = null)
    {
        $case = $this->cases->find($caseId);
        if (!$case) { throw new RuntimeException('Brokerage case not found.'); }
        $transfer = $this->transfers->currentForCase($caseId);
        if (!$transfer) { throw new RuntimeException('No transfer has been authorized for this case yet.'); }
        if (self::statusOf($transfer) === self::STATUS_ASSOCIATED && !empty($transfer->whmcs_domain_id)) {
            return $transfer; // idempotent: already delivered, never create a second record
        }
        if ($transfer->status !== TransferStatus::VERIFIED && $transfer->status !== TransferStatus::COMPLETED) {
            throw new RuntimeException('The domain can only be delivered after the transfer is verified.');
        }

        if (!function_exists('localAPI')) {
            return $this->markPendingManual($case, $transfer, 'WHMCS billing API is unavailable in this environment.', $adminId);
        }

        $existing = $this->findClientDomain($case->domain);
        if ($existing) {
            $ownerId = (int) (isset($existing['clientid']) ? $existing['clientid'] : (isset($existing['userid']) ? $existing['userid'] : 0));
            if ($ownerId === (int) $case->client_id) {
                return $this->markAssociated($case, $transfer, (int) (isset($existing['id']) ? $existing['id'] : 0), $adminId, 'Domain record was already attached to this customer.');
            }
            return $this->markFailed($case, $transfer, 'A WHMCS domain record for ' . $case->domain . ' already exists under a different account. Resolve the conflict in WHMCS; it was not overridden.', $adminId);
        }

        $created = $this->createClientDomain($case);
        if (!$created) {
            return $this->markPendingManual($case, $transfer,
                'Automatic association is not available in this WHMCS version. In WHMCS Admin, open Clients -> Domains, add ' . $case->domain . ' to client #' . (int) $case->client_id . ' with status Active, and reference case ' . $case->case_number . '.',
                $adminId);
        }

        // Confirm, never assume: the association only counts when a re-read of
        // the client domain list shows the record owned by this customer.
        $confirmed = $this->findClientDomain($case->domain);
        if ($confirmed) {
            $ownerId = (int) (isset($confirmed['clientid']) ? $confirmed['clientid'] : (isset($confirmed['userid']) ? $confirmed['userid'] : 0));
            if ($ownerId === (int) $case->client_id) {
                return $this->markAssociated($case, $transfer, (int) (isset($confirmed['id']) ? $confirmed['id'] : (isset($created['domainid']) ? $created['domainid'] : 0)), $adminId, 'Domain record created and confirmed for this customer.');
            }
        }
        return $this->markPendingManual($case, $transfer, 'The create request was accepted but the domain record could not be confirmed. Verify it in WHMCS Admin -> Clients -> Domains before treating delivery as done.', $adminId);
    }

    /**
     * Locate this domain in WHMCS's real client-domain list.
     *
     * @return array|null normalized record with id/clientid keys
     */
    private function findClientDomain($domain)
    {
        if (!function_exists('localAPI')) { return null; }
        try {
            $result = localAPI('GetClientsDomains', array('domain' => (string) $domain, 'limitnum' => 25));
        } catch (\Throwable $error) {
            Logger::write('cloudhost247_broker', 'warning', 'delivery.domain_lookup_failed', array('domain' => (string) $domain));
            return null;
        }
        if (!is_array($result) || !isset($result['result']) || $result['result'] !== 'success') { return null; }
        $items = array();
        if (isset($result['domains']['item'])) {
            $items = is_array($result['domains']['item']) ? $result['domains']['item'] : array($result['domains']['item']);
            // WHMCS returns a single assoc array (not a list) when there is exactly one match.
            if (isset($items['domainname'])) { $items = array($items); }
        }
        $needle = strtolower((string) $domain);
        foreach ($items as $item) {
            if (!is_array($item)) { continue; }
            $name = isset($item['domainname']) ? strtolower((string) $item['domainname']) : (isset($item['domain']) ? strtolower((string) $item['domain']) : '');
            if ($name !== $needle) { continue; }
            return array(
                'id' => (int) (isset($item['id']) ? $item['id'] : (isset($item['domainid']) ? $item['domainid'] : 0)),
                'clientid' => (int) (isset($item['clientid']) ? $item['clientid'] : (isset($item['userid']) ? $item['userid'] : 0)),
            );
        }
        return null;
    }

    /**
     * Create the client-domain record through WHMCS's own API. Returns the raw
     * API response on a reported success, or null when the running WHMCS does
     * not support/complete the request (older versions, or an install where
     * the action is unavailable) — the caller then falls back to an explicit
     * manual step instead of claiming success.
     */
    private function createClientDomain($case)
    {
        try {
            $result = localAPI('AddClientDomain', array(
                'clientid' => (int) $case->client_id,
                'domainname' => (string) $case->domain,
                'status' => 'Active',
                'notes' => 'Acquired via CloudHost247 Domain Brokerage case ' . $case->case_number . '.',
            ));
        } catch (\Throwable $error) {
            Logger::write('cloudhost247_broker', 'warning', 'delivery.create_failed', array('case_id' => (int) $case->id));
            return null;
        }
        if (!is_array($result) || !isset($result['result']) || $result['result'] !== 'success') {
            Logger::write('cloudhost247_broker', 'warning', 'delivery.create_rejected', array('case_id' => (int) $case->id));
            return null;
        }
        return $result;
    }

    private function markAssociated($case, $transfer, $whmcsDomainId, $adminId, $summary)
    {
        $this->transfers->update($transfer->id, array(
            'delivery_status' => self::STATUS_ASSOCIATED,
            'whmcs_domain_id' => $whmcsDomainId > 0 ? $whmcsDomainId : null,
            'delivered_at' => date('Y-m-d H:i:s'),
            'delivery_note' => InputValidator::shortText($summary, 255),
        ));
        $this->events->record(array(
            'case_id' => (int) $case->id, 'event_type' => 'delivery.associated', 'visibility' => 'customer',
            'actor_type' => $adminId ? 'admin' : 'system', 'actor_id' => $adminId ? (int) $adminId : null,
            'summary' => InputValidator::shortText($summary, 500) ?: 'The domain is now associated with your CloudHost247 account.',
        ));
        AuditLogger::record('cloudhost247_broker', 'delivery.associated', 'broker_case', $case->id, array(), array('whmcs_domain_id' => $whmcsDomainId), 'success', null, $adminId);
        $this->notifier->domainDelivered($case->client_id, $case->case_number, $case->domain);
        return $this->transfers->currentForCase($case->id);
    }

    private function markPendingManual($case, $transfer, $note, $adminId)
    {
        $this->transfers->update($transfer->id, array(
            'delivery_status' => self::STATUS_PENDING_MANUAL,
            'delivery_note' => InputValidator::shortText($note, 255),
        ));
        $this->events->record(array(
            'case_id' => (int) $case->id, 'event_type' => 'delivery.pending_manual', 'visibility' => 'internal',
            'actor_type' => $adminId ? 'admin' : 'system', 'actor_id' => $adminId ? (int) $adminId : null,
            'summary' => InputValidator::shortText($note, 500),
        ));
        AuditLogger::record('cloudhost247_broker', 'delivery.pending_manual', 'broker_case', $case->id, array(), array('note' => InputValidator::shortText($note, 120)), 'success', null, $adminId);
        return $this->transfers->currentForCase($case->id);
    }

    private function markFailed($case, $transfer, $reason, $adminId)
    {
        $this->transfers->update($transfer->id, array(
            'delivery_status' => self::STATUS_FAILED,
            'delivery_note' => InputValidator::shortText($reason, 255),
        ));
        $this->events->record(array(
            'case_id' => (int) $case->id, 'event_type' => 'delivery.failed', 'visibility' => 'internal',
            'actor_type' => $adminId ? 'admin' : 'system', 'actor_id' => $adminId ? (int) $adminId : null,
            'summary' => InputValidator::shortText($reason, 500),
        ));
        AuditLogger::record('cloudhost247_broker', 'delivery.failed', 'broker_case', $case->id, array(), array('reason' => InputValidator::shortText($reason, 120)), 'failed', InputValidator::shortText($reason, 120), $adminId);
        return $this->transfers->currentForCase($case->id);
    }
}
