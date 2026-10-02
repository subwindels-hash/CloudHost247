<?php
namespace CloudHost247\Marketing\Services;

use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Marketing\Domain\ConsentStatus;
use CloudHost247\Marketing\Domain\SubscriberSource;
use CloudHost247\Marketing\Domain\SubscriberStatus;
use CloudHost247\Marketing\Domain\SuppressionReason;
use CloudHost247\Marketing\Repositories\ListRepository;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Repositories\SuppressionRepository;
use CloudHost247\Marketing\Repositories\TagRepository;
use CloudHost247\Marketing\Security\InputValidator;

/**
 * Subscriber lifecycle (requirement #5, #6, #29, #34).
 *
 * Three rules the whole platform depends on, enforced here and nowhere else:
 *
 *   1. A suppressed address is never subscribed, re-subscribed or imported
 *      back into a sendable state. Lifting a suppression is an explicit,
 *      audited administrator action.
 *   2. Consent evidence is recorded as given, never inferred. Importing a list
 *      of addresses does not manufacture consent.
 *   3. Every transition is idempotent: an unsubscribe link clicked twice, or a
 *      bounce webhook delivered twice, changes state once and audits once.
 */
final class SubscriptionService
{
    private $subscribers;
    private $suppressions;
    private $lists;
    private $tags;
    private $automations;

    public function __construct(
        SubscriberRepository $subscribers = null,
        SuppressionRepository $suppressions = null,
        ListRepository $lists = null,
        TagRepository $tags = null,
        AutomationService $automations = null
    ) {
        $this->subscribers = $subscribers ?: new SubscriberRepository();
        $this->suppressions = $suppressions ?: new SuppressionRepository();
        $this->lists = $lists ?: new ListRepository();
        $this->tags = $tags ?: new TagRepository();
        $this->automations = $automations ?: new AutomationService();
    }

    /**
     * Adds or updates a subscriber and its list memberships.
     *
     * $input: email (required), first_name, last_name, company, phone, country,
     *         fields (array), list_ids (array), tags (array of keys),
     *         consent_status (default unknown), consent_source, status.
     * $source: SubscriberSource constant.
     *
     * Returns array('ok' => bool, 'reason' => code, 'subscriber' => row|null,
     * 'created' => bool, 'lists_added' => int, 'tags_added' => int).
     *
     * $audit = false is used by the bulk importer, which records one audit row
     * for the whole import instead of one per address.
     */
    public function subscribe(array $input, $source = SubscriberSource::MANUAL, $audit = true)
    {
        $email = InputValidator::email(isset($input['email']) ? $input['email'] : '', 'email');

        if ($this->suppressions->isSuppressed($email)) {
            $suppression = $this->suppressions->findByEmail($email);
            if ($audit) {
                AuditLogger::record('cloudhost247_marketing', 'subscriber.subscribe_refused', 'marketing_subscriber', 0,
                    array('email' => $email), array('reason' => 'suppressed'), 'denied',
                    'Address is on the suppression list (' . $suppression->reason . ').');
            }
            return array('ok' => false, 'reason' => 'suppressed', 'subscriber' => null, 'created' => false, 'lists_added' => 0, 'tags_added' => 0,
                'suppression_reason' => (string) $suppression->reason);
        }

        $consent = isset($input['consent_status']) ? (string) $input['consent_status'] : ConsentStatus::UNKNOWN;
        if (!ConsentStatus::isValid($consent)) { throw new \InvalidArgumentException('Unknown consent status.'); }

        $result = $this->subscribers->upsert(array(
            'email' => $email,
            'first_name' => isset($input['first_name']) ? $input['first_name'] : '',
            'last_name' => isset($input['last_name']) ? $input['last_name'] : '',
            'company' => isset($input['company']) ? $input['company'] : '',
            'phone' => isset($input['phone']) ? $input['phone'] : '',
            'country' => isset($input['country']) ? $input['country'] : '',
            'fields' => isset($input['fields']) && is_array($input['fields']) ? $input['fields'] : array(),
            'client_id' => isset($input['client_id']) ? $input['client_id'] : null,
            'status' => isset($input['status']) ? $input['status'] : SubscriberStatus::SUBSCRIBED,
            'consent_status' => $consent,
            'consent_source' => isset($input['consent_source']) ? $input['consent_source'] : '',
        ), $source);

        $subscriber = $result['subscriber'];
        $listsAdded = 0;
        if (!empty($input['list_ids'])) {
            // addMembers(listId, subscriberIds) — the subscriber joins each list
            // in turn, and every membership insert is idempotent.
            foreach (array_unique(array_map('intval', (array) $input['list_ids'])) as $listId) {
                if ($listId > 0) { $listsAdded += $this->lists->addMembers($listId, array((int) $subscriber->id)); }
            }
        }
        $tagsAdded = 0;
        if (!empty($input['tags'])) {
            $tagIds = $this->tags->ensureMany((array) $input['tags']);
            $tagsAdded = $this->tags->assignMany((int) $subscriber->id, $tagIds);
        }

        if ($audit) {
            AuditLogger::record('cloudhost247_marketing', $result['created'] ? 'subscriber.created' : 'subscriber.updated',
                'marketing_subscriber', (int) $subscriber->id, array(), array(
                    'email' => $email, 'status' => (string) $subscriber->status,
                    'consent_status' => (string) $subscriber->consent_status, 'source' => $source,
                    'lists_added' => $listsAdded, 'tags_added' => $tagsAdded,
                ), 'success');
        }

        // Triggers fire after the row and its memberships exist. The hook is
        // deliberately inside the service, not in a WHMCS hook: an import or an
        // API call must start a journey exactly like the admin form does.
        $enrolled = $this->automations->enrollForSubscriber((int) $subscriber->id,
            isset($input['list_ids']) ? (array) $input['list_ids'] : array(), (bool) $result['created']);

        return array(
            'ok' => true, 'reason' => '', 'subscriber' => $subscriber, 'created' => (bool) $result['created'],
            'lists_added' => $listsAdded, 'tags_added' => $tagsAdded, 'automations_started' => $enrolled,
        );
    }

    /**
     * Unsubscribe. Never throws for an unknown address: an unsubscribe link
     * must always work, so an address that has no subscriber row still gets a
     * suppression record.
     */
    public function unsubscribe($email, $source = 'recipient', $detail = '')
    {
        try {
            $email = InputValidator::email($email);
        } catch (\InvalidArgumentException $error) {
            return array('ok' => false, 'reason' => 'invalid_address');
        }
        $subscriber = $this->subscribers->findByEmail($email);
        $changed = false;
        if ($subscriber) {
            $changed = $this->subscribers->setStatus((int) $subscriber->id, SubscriberStatus::UNSUBSCRIBED) || $changed;
            $this->subscribers->setConsent((int) $subscriber->id, ConsentStatus::REVOKED, $source);
        }
        $suppression = $this->suppressions->suppress($email, SuppressionReason::UNSUBSCRIBED, $source === 'admin' ? 'admin' : 'recipient', $detail);
        // A journey that enrolled this address must stop: consent was withdrawn,
        // and a queue filled five minutes ago is not consent.
        $cancelledRuns = $subscriber ? $this->automations->cancelRunsForSubscriber((int) $subscriber->id, 'unsubscribed') : 0;
        if ($changed || $suppression['created']) {
            AuditLogger::record('cloudhost247_marketing', 'subscriber.unsubscribed', 'marketing_subscriber',
                $subscriber ? (int) $subscriber->id : 0, array('status' => $subscriber ? (string) $subscriber->status : ''),
                array('email' => $email, 'reason' => 'unsubscribed', 'source' => $source, 'automations_cancelled' => $cancelledRuns), 'success');
        }
        return array('ok' => true, 'reason' => 'unsubscribed', 'changed' => $changed,
            'suppression_created' => (bool) $suppression['created'], 'automations_cancelled' => $cancelledRuns);
    }

    /** Administrator action: put an address on the suppression list directly. */
    public function suppress($email, $reason, $detail = '')
    {
        $result = $this->suppressions->suppress($email, $reason, 'admin', $detail);
        $subscriber = $this->subscribers->findByEmail($email);
        if ($subscriber) {
            $this->subscribers->setStatus((int) $subscriber->id, SubscriberStatus::SUPPRESSED);
            $this->subscribers->setConsent((int) $subscriber->id, ConsentStatus::REVOKED, 'admin');
            $this->automations->cancelRunsForSubscriber((int) $subscriber->id, 'suppressed');
        }
        AuditLogger::record('cloudhost247_marketing', 'suppression.added', 'marketing_suppression',
            $result['row'] ? (int) $result['row']->id : 0, array(), array('email' => $email, 'reason' => $reason), 'success');
        return $result;
    }

    /**
     * Explicit, audited administrator reversal of a suppression. A spam
     * complaint or hard bounce needs `$force = true` (the UI asks twice).
     */
    public function releaseSuppression($email, $force = false)
    {
        $email = InputValidator::email($email);
        $released = $this->suppressions->release($email, $force);
        if ($released) {
            AuditLogger::record('cloudhost247_marketing', 'suppression.released', 'marketing_suppression', 0,
                array('email' => $email), array('force' => (bool) $force), 'success');
        }
        return $released;
    }

    /**
     * Restores a suppressed/unsubscribed address to a sendable state after an
     * explicit administrator decision. Refuses while a suppression row remains,
     * so the two-step flow (release, then re-subscribe) is always visible in
     * the audit trail.
     */
    public function resubscribe($email, $consentSource = 'admin', $consentStatus = ConsentStatus::GRANTED)
    {
        $email = InputValidator::email($email);
        if ($this->suppressions->isSuppressed($email)) {
            return array('ok' => false, 'reason' => 'suppressed');
        }
        $subscriber = $this->subscribers->findByEmail($email);
        if (!$subscriber) { return array('ok' => false, 'reason' => 'unknown_subscriber'); }
        $this->subscribers->setStatus((int) $subscriber->id, SubscriberStatus::SUBSCRIBED);
        $this->subscribers->setConsent((int) $subscriber->id, $consentStatus, $consentSource);
        AuditLogger::record('cloudhost247_marketing', 'subscriber.resubscribed', 'marketing_subscriber',
            (int) $subscriber->id, array('status' => (string) $subscriber->status),
            array('email' => $email, 'consent_status' => $consentStatus, 'consent_source' => $consentSource), 'success');
        return array('ok' => true, 'reason' => '', 'subscriber' => $this->subscribers->find((int) $subscriber->id));
    }

    /**
     * Bounce handling. Hard bounces suppress immediately; soft bounces
     * accumulate until the configured threshold — a single "mailbox full" is
     * not evidence that the address is dead.
     */
    public function recordBounce($email, $type, $softThreshold = 3)
    {
        $email = InputValidator::email($email);
        $subscriber = $this->subscribers->findByEmail($email);
        $type = $type === 'hard' ? 'hard' : 'soft';
        if (!$subscriber) {
            if ($type === 'hard') { $this->suppressions->suppress($email, SuppressionReason::HARD_BOUNCE, 'bounce', 'Hard bounce for an address with no subscriber row'); }
            return array('ok' => true, 'reason' => 'unknown_subscriber', 'suppressed' => $type === 'hard');
        }
        $result = $this->subscribers->recordBounce((int) $subscriber->id, $type, (int) $softThreshold);
        $suppressed = false;
        if ($result['suppress']) {
            // The closed suppression set has five reasons; a soft bounce that
            // crossed the threshold is promoted to the hard-bounce reason with
            // the count in the detail, rather than inventing a sixth reason.
            $this->suppressions->suppress($email, SuppressionReason::HARD_BOUNCE, 'bounce',
                $type . ' bounce #' . $result['count'] . ' reached the configured threshold');
            $this->subscribers->setStatus((int) $subscriber->id, SubscriberStatus::BOUNCED);
            $this->automations->cancelRunsForSubscriber((int) $subscriber->id, 'bounced');
            $suppressed = true;
        }
        AuditLogger::record('cloudhost247_marketing', 'subscriber.bounced', 'marketing_subscriber', (int) $subscriber->id,
            array('bounce_count' => isset($subscriber->bounce_count) ? (int) $subscriber->bounce_count : 0),
            array('type' => $type, 'count' => $result['count'], 'suppressed' => $suppressed), 'success');
        return array('ok' => true, 'reason' => '', 'suppressed' => $suppressed, 'count' => $result['count'], 'type' => $type);
    }

    /**
     * The single question every send path must ask before queueing a message.
     * Returns array('sendable' => bool, 'reason' => ''|code).
     */
    public function checkSendable($email)
    {
        try {
            $email = InputValidator::email($email);
        } catch (\InvalidArgumentException $error) {
            return array('sendable' => false, 'reason' => 'invalid_address');
        }
        $suppression = $this->suppressions->findByEmail($email);
        if ($suppression) {
            return array('sendable' => false, 'reason' => 'suppressed', 'suppression_reason' => (string) $suppression->reason);
        }
        $subscriber = $this->subscribers->findByEmail($email);
        if ($subscriber) {
            if (!in_array((string) $subscriber->status, SubscriberStatus::sendableSet(), true)) {
                return array('sendable' => false, 'reason' => 'status_' . (string) $subscriber->status);
            }
        }
        return array('sendable' => true, 'reason' => '');
    }

    public function lists() { return $this->lists; }
    public function subscribers() { return $this->subscribers; }
    public function suppressions() { return $this->suppressions; }
    public function tags() { return $this->tags; }
}
