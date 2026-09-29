<?php
namespace CloudHost247\Broker\Services;

use CloudHost247\Broker\Domain\CaseStatus;
use CloudHost247\Broker\Repositories\CaseRepository;
use CloudHost247\Broker\Repositories\EventRepository;
use CloudHost247\Broker\Repositories\OfferRepository;
use CloudHost247\Broker\Security\InputValidator;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Foundation\Support\Logger;
use InvalidArgumentException;
use RuntimeException;

/**
 * Negotiation engine (requirement #20). Offers are strictly immutable: this
 * service only ever inserts a new offer row or a new event; it never updates
 * an existing offer. "Status" (pending/accepted/rejected/expired/superseded)
 * is always derived from the full history, so a modified opinion always shows
 * up as a new record rather than rewriting the past.
 */
final class NegotiationService
{
    private $cases;
    private $offers;
    private $events;
    private $notifier;

    public function __construct(CaseRepository $cases = null, OfferRepository $offers = null, EventRepository $events = null, NotificationService $notifier = null)
    {
        $this->cases = $cases ?: new CaseRepository();
        $this->offers = $offers ?: new OfferRepository();
        $this->events = $events ?: new EventRepository();
        $this->notifier = $notifier ?: new NotificationService();
    }

    /**
     * Record a new offer or counteroffer. Idempotent on idempotency_key: a
     * retried submission returns the original row instead of creating a
     * duplicate (requirement #29).
     */
    public function submit($caseId, array $input)
    {
        $idempotencyKey = isset($input['idempotency_key']) ? InputValidator::idempotencyKey($input['idempotency_key']) : null;
        if ($idempotencyKey) {
            $existing = $this->offers->findByIdempotencyKey($idempotencyKey);
            if ($existing) { return $existing; }
        }

        $case = $this->requireCase($caseId);
        if (CaseStatus::isTerminal($case->status) || $case->status === CaseStatus::DISPUTED) {
            throw new RuntimeException('This case cannot accept new offers in its current status.');
        }

        $fromParty = $this->party(isset($input['from_party']) ? $input['from_party'] : '');
        $toParty = $this->party(isset($input['to_party']) ? $input['to_party'] : '');
        $kind = isset($input['kind']) && $input['kind'] === 'counteroffer' ? 'counteroffer' : 'offer';
        $amount = InputValidator::money(isset($input['amount']) ? $input['amount'] : 0, 'Offer amount');
        if ($amount <= 0) { throw new InvalidArgumentException('Offer amount must be greater than zero.'); }
        $currency = InputValidator::currency(isset($input['currency']) ? $input['currency'] : $case->currency);
        $expiresAt = isset($input['expires_at']) ? InputValidator::futureDate($input['expires_at']) : null;

        $offerId = $this->offers->create(array(
            'case_id' => (int) $caseId,
            'amount' => $amount,
            'currency' => $currency,
            'kind' => $kind,
            'from_party' => $fromParty,
            'to_party' => $toParty,
            'source' => isset($input['source']) ? $this->party($input['source']) : $fromParty,
            'provider_key' => isset($input['provider_key']) ? substr((string) $input['provider_key'], 0, 32) : (string) $case->provider_key,
            'created_by_admin_id' => isset($input['admin_id']) ? (int) $input['admin_id'] : null,
            'created_by_client_id' => isset($input['client_id']) ? (int) $input['client_id'] : null,
            'expires_at' => $expiresAt,
            'correlation_id' => isset($input['correlation_id']) ? substr((string) $input['correlation_id'], 0, 64) : Logger::correlationId(),
            'idempotency_key' => $idempotencyKey,
        ));

        $summary = ($kind === 'counteroffer' ? 'Counteroffer' : 'Offer') . ' of ' . $currency . ' ' . number_format($amount, 2) . ' from ' . $fromParty . ' to ' . $toParty . '.';
        $this->events->record(array(
            'case_id' => (int) $caseId, 'event_type' => $kind === 'counteroffer' ? 'offer.countered' : 'offer.received',
            'visibility' => 'customer', 'actor_type' => $fromParty === 'customer' ? 'customer' : ($fromParty === 'broker' ? 'admin' : 'provider'),
            'actor_id' => isset($input['admin_id']) ? (int) $input['admin_id'] : null, 'summary' => $summary,
            'metadata_json' => json_encode(array('offer_id' => $offerId)),
        ));

        if ($toParty === 'customer') {
            $this->moveTo($case, CaseStatus::AWAITING_CUSTOMER);
            if ($kind === 'counteroffer') {
                $this->notifier->counterofferReceived($case->client_id, $case->case_number, $case->domain, number_format($amount, 2), $currency);
            } else {
                $this->notifier->offerReceived($case->client_id, $case->case_number, $case->domain, number_format($amount, 2), $currency);
            }
        } elseif ($toParty === 'seller' || $toParty === 'provider') {
            $this->moveTo($case, CaseStatus::AWAITING_SELLER);
        }

        AuditLogger::record('cloudhost247_broker', $kind === 'counteroffer' ? 'negotiation.counteroffer' : 'negotiation.offer', 'broker_case', $caseId,
            array(), array('amount' => $amount, 'currency' => $currency, 'from' => $fromParty, 'to' => $toParty), 'success', null, isset($input['admin_id']) ? (int) $input['admin_id'] : null);

        return $this->offers->find($offerId);
    }

    public function accept($offerId, $actorType, $actorId)
    {
        $offer = $this->requireOffer($offerId);
        if ($this->status($offerId) !== 'pending') { throw new RuntimeException('This offer is no longer pending.'); }
        $case = $this->requireCase($offer->case_id);
        $this->events->record(array(
            'case_id' => $offer->case_id, 'event_type' => 'offer.accepted', 'visibility' => 'customer',
            'actor_type' => $actorType, 'actor_id' => $actorId ? (int) $actorId : null,
            'summary' => 'Offer of ' . $offer->currency . ' ' . number_format($offer->amount, 2) . ' accepted.',
            'metadata_json' => json_encode(array('offer_id' => (int) $offerId)),
        ));
        $updated = $this->cases->find($offer->case_id);
        if (!CaseStatus::isTerminal($updated->status) && $updated->status !== CaseStatus::OFFER_ACCEPTED) {
            $this->moveTo($updated, CaseStatus::OFFER_ACCEPTED);
        }
        AuditLogger::record('cloudhost247_broker', 'negotiation.accept', 'broker_case', $offer->case_id, array(), array('offer_id' => (int) $offerId), 'success', null, $actorType === 'admin' ? $actorId : null);
        $this->notifier->offerAccepted($case->client_id, $case->case_number, $case->domain);
        return $this->cases->find($offer->case_id);
    }

    public function reject($offerId, $actorType, $actorId, $reason = '')
    {
        $offer = $this->requireOffer($offerId);
        if ($this->status($offerId) !== 'pending') { throw new RuntimeException('This offer is no longer pending.'); }
        $this->events->record(array(
            'case_id' => $offer->case_id, 'event_type' => 'offer.rejected', 'visibility' => 'customer',
            'actor_type' => $actorType, 'actor_id' => $actorId ? (int) $actorId : null,
            'summary' => 'Offer of ' . $offer->currency . ' ' . number_format($offer->amount, 2) . ' rejected.' . ($reason ? ' ' . InputValidator::shortText($reason, 255) : ''),
            'metadata_json' => json_encode(array('offer_id' => (int) $offerId)),
        ));
        AuditLogger::record('cloudhost247_broker', 'negotiation.reject', 'broker_case', $offer->case_id, array(), array('offer_id' => (int) $offerId), 'success', null, $actorType === 'admin' ? $actorId : null);
        return $this->cases->find($offer->case_id);
    }

    /** Derived status: pending, accepted, rejected, expired or superseded. Never stored, always computed. */
    public function status($offerId)
    {
        $offer = $this->requireOffer($offerId);
        foreach ($this->events->fullTimeline($offer->case_id) as $event) {
            if (!in_array($event->event_type, array('offer.accepted', 'offer.rejected'), true)) { continue; }
            $meta = json_decode((string) $event->metadata_json, true);
            if (is_array($meta) && isset($meta['offer_id']) && (int) $meta['offer_id'] === (int) $offerId) {
                return $event->event_type === 'offer.accepted' ? 'accepted' : 'rejected';
            }
        }
        if ($offer->expires_at && strtotime($offer->expires_at) < time()) { return 'expired'; }
        $newer = $this->offers->forCase($offer->case_id)->first(function ($row) use ($offer) {
            return (int) $row->id > (int) $offer->id && $row->from_party === $offer->from_party && $row->to_party === $offer->to_party;
        });
        if ($newer) { return 'superseded'; }
        return 'pending';
    }

    public function timelineFor($caseId)
    {
        $offers = array();
        foreach ($this->offers->forCase($caseId) as $offer) {
            $offer->derived_status = $this->status($offer->id);
            $offers[] = $offer;
        }
        return $offers;
    }

    public function acceptedOffer($caseId)
    {
        foreach ($this->events->fullTimeline($caseId) as $event) {
            if ($event->event_type !== 'offer.accepted') { continue; }
            $meta = json_decode((string) $event->metadata_json, true);
            if (is_array($meta) && isset($meta['offer_id'])) { return $this->offers->find((int) $meta['offer_id']); }
        }
        return null;
    }

    private function moveTo($case, $status)
    {
        if ($case->status === $status || !CaseStatus::canTransition($case->status, $status)) { return; }
        $this->cases->update($case->id, array('status' => $status));
    }

    private function party($value)
    {
        $value = strtolower(trim((string) $value));
        if (!in_array($value, array('customer', 'broker', 'seller', 'provider', 'system'), true)) {
            throw new InvalidArgumentException('Invalid negotiation party.');
        }
        return $value;
    }

    private function requireOffer($offerId)
    {
        $offer = $this->offers->find($offerId);
        if (!$offer) { throw new RuntimeException('Offer not found.'); }
        return $offer;
    }

    private function requireCase($caseId)
    {
        $case = $this->cases->find($caseId);
        if (!$case) { throw new RuntimeException('Brokerage case not found.'); }
        return $case;
    }
}
