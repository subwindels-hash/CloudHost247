<?php
namespace CloudHost247\Smm\Contracts;

/** Order persistence used by the order services. Implemented by the Capsule repository; faked in tests. */
interface OrderStore
{
    /** @return object|null order row for a WHMCS service id */
    public function findByServiceId($whmcsServiceId);

    /** @return object|null order row by primary key */
    public function findById($orderId);

    /** @return int new order id */
    public function create(array $data);

    /**
     * Optimistically claim an awaiting order for submission.
     * @return bool true when this caller owns the submission
     */
    public function claimForSubmission($orderId);

    /** Mark accepted: provider_order_id + snapshot fields. */
    public function markAccepted($orderId, $providerOrderId, array $extra = array());

    /** Mark rejected (definitive provider refusal). */
    public function markRejected($orderId, $message);

    /** Mark uncertain (unknown outcome — reconciliation required). */
    public function markUncertain($orderId, $message);

    /** Arbitrary whitelisted field update. */
    public function updateFields($orderId, array $fields);

    /** Attach a provider order id during reconciliation. */
    public function attachProviderOrderId($orderId, $providerOrderId);

    /**
     * Bounded list of orders eligible for status synchronization:
     * accepted, not suspended, provider enabled, status not verified-terminal —
     * PLUS orders that turned terminal within the re-verification window so a
     * provider contradicting a verified terminal status is caught and flagged
     * (never overwritten). After the window the terminal order is left alone.
     * @param int $limit
     * @param int $terminalRecheckWindow seconds since terminal status was set
     * @return array rows
     */
    public function eligibleForStatusSync($limit, $terminalRecheckWindow = 86400);

    /** Orders in a given submission state (bounded). */
    public function findByState($state, $limit);

    /** Orders flagged needs_review (bounded). */
    public function findNeedingReview($limit);

    /** Orders for one client, newest first (bounded, ownership scope). */
    public function forClient($clientId, $limit = 200);

    /** Order by WHMCS service id AND client id (ownership enforced lookup). */
    public function findByWhmcsService($whmcsServiceId, $clientId);

    /** Orders stuck in in_flight since before $cutoffDateTime (crashed workers). */
    public function staleInFlight($cutoffDateTime, $limit);

    /** Append an order event row. */
    public function recordEvent($orderId, $event, $fromStatus, $toStatus, $note, $actor, $actorId, $correlationId);
}
