<?php
namespace CloudHost247\Broker\Domain;

/**
 * The complete, closed set of brokerage case statuses (requirement #4) plus
 * the allowed forward transitions between them. Nothing outside
 * Services\BrokerageService is allowed to write case.status directly, so this
 * map is the single source of truth for what can happen next.
 */
final class CaseStatus
{
    const REQUEST_SUBMITTED = 'request_submitted';
    const MANUAL_BROKER_REQUIRED = 'manual_broker_required';
    const BROKER_ASSIGNED = 'broker_assigned';
    const CONTACTING_OWNER = 'contacting_owner';
    const NEGOTIATION = 'negotiation';
    const AWAITING_CUSTOMER = 'awaiting_customer';
    const AWAITING_SELLER = 'awaiting_seller';
    const OFFER_ACCEPTED = 'offer_accepted';
    const PAYMENT_PENDING = 'payment_pending';
    const TRANSFER_PENDING = 'transfer_pending';
    const TRANSFER_PROCESSING = 'transfer_processing';
    const COMPLETED = 'completed';
    const CANCELLED = 'cancelled';
    const FAILED = 'failed';
    const DISPUTED = 'disputed';

    private static $labels = array(
        self::REQUEST_SUBMITTED => 'Request Submitted',
        self::MANUAL_BROKER_REQUIRED => 'Manual Broker Required',
        self::BROKER_ASSIGNED => 'Broker Assigned',
        self::CONTACTING_OWNER => 'Contacting Owner',
        self::NEGOTIATION => 'Negotiation',
        self::AWAITING_CUSTOMER => 'Awaiting Customer',
        self::AWAITING_SELLER => 'Awaiting Seller',
        self::OFFER_ACCEPTED => 'Offer Accepted',
        self::PAYMENT_PENDING => 'Payment Pending',
        self::TRANSFER_PENDING => 'Transfer Pending',
        self::TRANSFER_PROCESSING => 'Transfer Processing',
        self::COMPLETED => 'Completed',
        self::CANCELLED => 'Cancelled',
        self::FAILED => 'Failed',
        self::DISPUTED => 'Disputed',
    );

    /** Forward transition map. Disputed can be entered from any active (non-terminal) status. */
    private static $transitions = array(
        self::REQUEST_SUBMITTED => array(self::BROKER_ASSIGNED, self::MANUAL_BROKER_REQUIRED, self::CANCELLED, self::FAILED),
        self::MANUAL_BROKER_REQUIRED => array(self::BROKER_ASSIGNED, self::CANCELLED, self::FAILED),
        self::BROKER_ASSIGNED => array(self::CONTACTING_OWNER, self::CANCELLED, self::FAILED),
        self::CONTACTING_OWNER => array(self::NEGOTIATION, self::AWAITING_SELLER, self::CANCELLED, self::FAILED),
        self::NEGOTIATION => array(self::AWAITING_CUSTOMER, self::AWAITING_SELLER, self::OFFER_ACCEPTED, self::CANCELLED, self::FAILED),
        self::AWAITING_CUSTOMER => array(self::NEGOTIATION, self::AWAITING_SELLER, self::OFFER_ACCEPTED, self::CANCELLED, self::FAILED),
        self::AWAITING_SELLER => array(self::NEGOTIATION, self::AWAITING_CUSTOMER, self::OFFER_ACCEPTED, self::CANCELLED, self::FAILED),
        self::OFFER_ACCEPTED => array(self::PAYMENT_PENDING, self::CANCELLED, self::FAILED),
        self::PAYMENT_PENDING => array(self::TRANSFER_PENDING, self::CANCELLED, self::FAILED),
        self::TRANSFER_PENDING => array(self::TRANSFER_PROCESSING, self::FAILED),
        self::TRANSFER_PROCESSING => array(self::COMPLETED, self::FAILED),
        self::COMPLETED => array(),
        self::CANCELLED => array(),
        self::FAILED => array(),
        self::DISPUTED => array(),
    );

    /** Terminal statuses a disputed case may still resolve back into once the dispute is cleared. */
    private static $disputeResume = array(
        self::NEGOTIATION, self::AWAITING_CUSTOMER, self::AWAITING_SELLER, self::OFFER_ACCEPTED,
        self::PAYMENT_PENDING, self::TRANSFER_PENDING, self::TRANSFER_PROCESSING,
    );

    public static function all() { return array_keys(self::$labels); }

    public static function isValid($status) { return is_string($status) && isset(self::$labels[$status]); }

    public static function label($status) { return self::isValid($status) ? self::$labels[$status] : (string) $status; }

    public static function isTerminal($status)
    {
        return in_array($status, array(self::COMPLETED, self::CANCELLED, self::FAILED), true);
    }

    public static function canTransition($from, $to)
    {
        if ($to === self::DISPUTED) {
            return !self::isTerminal($from) && $from !== self::DISPUTED;
        }
        if ($from === self::DISPUTED) {
            return in_array($to, self::$disputeResume, true) || $to === self::CANCELLED || $to === self::FAILED;
        }
        return isset(self::$transitions[$from]) && in_array($to, self::$transitions[$from], true);
    }
}
