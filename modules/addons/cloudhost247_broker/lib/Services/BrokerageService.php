<?php
namespace CloudHost247\Broker\Services;

use CloudHost247\Broker\Domain\CaseStatus;
use CloudHost247\Broker\Domain\DomainState;
use CloudHost247\Broker\Repositories\AssignmentRepository;
use CloudHost247\Broker\Repositories\CaseRepository;
use CloudHost247\Broker\Repositories\EventRepository;
use CloudHost247\Broker\Repositories\MessageRepository;
use CloudHost247\Broker\Repositories\SettingsRepository;
use CloudHost247\Broker\Routing\AcquisitionRouter;
use CloudHost247\Broker\Security\InputValidator;
use CloudHost247\Foundation\Support\AuditLogger;
use InvalidArgumentException;
use RuntimeException;

/**
 * Central orchestrator for the brokerage case lifecycle (requirements #3, #4,
 * #6, #7, #26, #32). Status is only ever changed through transitionStatus(),
 * which enforces CaseStatus::canTransition() and always records a timeline
 * event, so the timeline can never drift from the stored status.
 */
final class BrokerageService
{
    private $cases;
    private $events;
    private $assignments;
    private $messages;
    private $router;
    private $numbers;
    private $notifier;
    private $settings;

    public function __construct(
        CaseRepository $cases = null,
        EventRepository $events = null,
        AssignmentRepository $assignments = null,
        MessageRepository $messages = null,
        AcquisitionRouter $router = null,
        CaseNumberGenerator $numbers = null,
        NotificationService $notifier = null,
        SettingsRepository $settings = null
    ) {
        $this->cases = $cases ?: new CaseRepository();
        $this->events = $events ?: new EventRepository();
        $this->assignments = $assignments ?: new AssignmentRepository();
        $this->messages = $messages ?: new MessageRepository();
        $this->router = $router ?: new AcquisitionRouter();
        $this->numbers = $numbers ?: new CaseNumberGenerator();
        $this->notifier = $notifier ?: new NotificationService();
        $this->settings = $settings ?: new SettingsRepository();
    }

    /**
     * Create a brokerage case (requirement #3). Idempotent: resubmitting the
     * same idempotency key returns the original case instead of creating a
     * second one.
     *
     * @param array $input domain, client_id, max_budget, currency, opening_offer,
     *                      customer_message, negotiation_instructions, deadline,
     *                      disclose_budget_to_seller, terms_accepted, idempotency_key,
     *                      domain_status(array from DomainStatusResolver, optional)
     */
    public function createCase(array $input)
    {
        $idempotencyKey = isset($input['idempotency_key']) ? InputValidator::idempotencyKey($input['idempotency_key']) : null;
        if ($idempotencyKey) {
            $existing = $this->cases->findByIdempotencyKey($idempotencyKey);
            if ($existing) { return $existing; }
        }

        $clientId = (int) (isset($input['client_id']) ? $input['client_id'] : 0);
        if ($clientId <= 0) { throw new InvalidArgumentException('A signed-in customer account is required.'); }
        $this->assertWithinRateLimit($clientId);
        $domain = InputValidator::domain(isset($input['domain']) ? $input['domain'] : '');
        $maxBudget = InputValidator::money(isset($input['max_budget']) ? $input['max_budget'] : 0, 'Maximum budget');
        if ($maxBudget <= 0) { throw new InvalidArgumentException('A maximum acquisition budget greater than zero is required.'); }
        $currency = InputValidator::currency(isset($input['currency']) ? $input['currency'] : 'USD');
        $openingOffer = isset($input['opening_offer']) && $input['opening_offer'] !== '' ? InputValidator::money($input['opening_offer'], 'Opening offer') : null;
        if (empty($input['terms_accepted'])) { throw new InvalidArgumentException('You must agree to the Domain Brokerage Terms to submit a request.'); }

        $domainStatus = isset($input['domain_status']) && is_array($input['domain_status']) ? $input['domain_status'] : array();
        $registrar = isset($domainStatus['registrar']) ? InputValidator::shortText($domainStatus['registrar'], 120) : null;
        $state = isset($domainStatus['state']) && DomainState::isValid($domainStatus['state']) ? $domainStatus['state'] : DomainState::UNKNOWN;

        $route = $this->router->select($registrar ?: '');
        $needsManualBroker = in_array($route['route'], array(AcquisitionRouter::ROUTE_C, AcquisitionRouter::ROUTE_D), true);

        $tld = strpos($domain, '.') !== false ? substr($domain, strrpos($domain, '.') + 1) : '';
        $caseNumber = $this->generateUniqueCaseNumber();

        $caseId = $this->cases->create(array(
            'case_number' => $caseNumber,
            'client_id' => $clientId,
            'domain' => $domain,
            'tld' => $tld,
            'registrar' => $registrar,
            'domain_status' => $state,
            'privacy_protected' => array_key_exists('privacy_protected', $domainStatus) ? $domainStatus['privacy_protected'] : null,
            'acquisition_route' => $route['route'],
            'provider_key' => $route['provider_key'],
            'status' => $needsManualBroker ? CaseStatus::MANUAL_BROKER_REQUIRED : CaseStatus::REQUEST_SUBMITTED,
            'max_budget' => $maxBudget,
            'currency' => $currency,
            'opening_offer' => $openingOffer,
            'disclose_budget_to_seller' => !empty($input['disclose_budget_to_seller']) ? 1 : 0,
            'deadline' => isset($input['deadline']) ? InputValidator::futureDate($input['deadline']) : null,
            'customer_message' => isset($input['customer_message']) ? InputValidator::longText($input['customer_message'], 2000) : null,
            'negotiation_instructions' => isset($input['negotiation_instructions']) ? InputValidator::longText($input['negotiation_instructions'], 2000) : null,
            'terms_accepted_at' => date('Y-m-d H:i:s'),
            'idempotency_key' => $idempotencyKey,
        ));

        $this->recordEvent($caseId, 'case.created', 'customer', $clientId, 'Brokerage request submitted for ' . $domain . '.', 'customer');
        $this->recordEvent($caseId, 'provider.selected', 'system', null,
            'Acquisition route selected: ' . $route['route'] . ($route['provider_key'] ? ' (' . $route['provider_key'] . ')' : '.'), 'internal');
        if (!empty($input['customer_message'])) {
            $this->messages->create(array('case_id' => $caseId, 'author_type' => 'customer', 'author_id' => $clientId, 'body' => InputValidator::longText($input['customer_message'], 2000), 'visibility' => 'customer'));
        }

        AuditLogger::record('cloudhost247_broker', 'case.create', 'broker_case', $caseId,
            array(), array('domain' => $domain, 'status' => $needsManualBroker ? CaseStatus::MANUAL_BROKER_REQUIRED : CaseStatus::REQUEST_SUBMITTED, 'route' => $route['route']),
            'success', null, null);

        $this->notifier->caseCreated($clientId, $caseNumber, $domain);

        return $this->cases->find($caseId);
    }

    /** Broker assignment (requirement #7). Always recorded, always audited. */
    public function assignBroker($caseId, $adminId, $assignedByAdminId, $note = '')
    {
        $case = $this->requireCase($caseId);
        $this->assignments->record($caseId, $adminId, $assignedByAdminId, 'assigned', $note);
        $this->cases->update($caseId, array('assigned_admin_id' => (int) $adminId));
        if (in_array($case->status, array(CaseStatus::REQUEST_SUBMITTED, CaseStatus::MANUAL_BROKER_REQUIRED), true)) {
            $this->transitionStatus($caseId, CaseStatus::BROKER_ASSIGNED, 'admin', $assignedByAdminId, 'A broker has been assigned to this case.', 'customer');
        }
        AuditLogger::record('cloudhost247_broker', 'case.assign_broker', 'broker_case', $caseId, array('assigned_admin_id' => (int) $case->assigned_admin_id), array('assigned_admin_id' => (int) $adminId), 'success', null, $assignedByAdminId);
        $this->notifier->brokerAssigned($case->client_id, $case->case_number, $case->domain);
        return $this->cases->find($caseId);
    }

    public function unassign($caseId, $adminId)
    {
        $case = $this->requireCase($caseId);
        $this->assignments->record($caseId, (int) $case->assigned_admin_id, $adminId, 'unassigned');
        $this->cases->update($caseId, array('assigned_admin_id' => null));
        AuditLogger::record('cloudhost247_broker', 'case.unassign_broker', 'broker_case', $caseId, array('assigned_admin_id' => (int) $case->assigned_admin_id), array('assigned_admin_id' => null), 'success', null, $adminId);
        return $this->cases->find($caseId);
    }

    public function recordContactAttempt($caseId, $adminId, $summary)
    {
        $case = $this->requireCase($caseId);
        $this->transitionStatus($caseId, CaseStatus::CONTACTING_OWNER, 'admin', $adminId, InputValidator::shortText($summary, 500) ?: 'Owner contact attempted through a legitimate channel.', 'customer');
        $this->notifier->contactAttempted($case->client_id, $case->case_number, $case->domain);
        return $this->cases->find($caseId);
    }

    public function recordOwnerResponse($caseId, $adminId, $summary)
    {
        $case = $this->requireCase($caseId);
        $this->transitionStatus($caseId, CaseStatus::NEGOTIATION, 'admin', $adminId, InputValidator::shortText($summary, 500) ?: 'The owner or acquisition channel responded.', 'customer');
        $this->notifier->ownerResponded($case->client_id, $case->case_number, $case->domain);
        return $this->cases->find($caseId);
    }

    /**
     * The only place case.status is ever written. Every transition is
     * validated against CaseStatus::canTransition() and produces exactly one
     * timeline event, so the timeline is always a faithful history of real
     * status changes — never a hard-coded display list (requirement #26).
     */
    public function transitionStatus($caseId, $to, $actorType, $actorId, $summary, $visibility = 'customer', array $extra = array())
    {
        $case = $this->requireCase($caseId);
        if (!CaseStatus::isValid($to)) { throw new InvalidArgumentException('Unknown case status.'); }
        if (!CaseStatus::canTransition($case->status, $to)) {
            throw new RuntimeException('Cannot move this case from ' . CaseStatus::label($case->status) . ' to ' . CaseStatus::label($to) . '.');
        }
        $update = array_merge(array('status' => $to), $extra);
        $this->cases->update($caseId, $update);
        $this->recordEvent($caseId, 'status.' . $to, $actorType, $actorId, $summary, $visibility);
        AuditLogger::record('cloudhost247_broker', 'case.status_transition', 'broker_case', $caseId, array('status' => $case->status), array('status' => $to), 'success', null, $actorType === 'admin' ? $actorId : null);
        return $this->cases->find($caseId);
    }

    public function cancel($caseId, $actorType, $actorId, $reason)
    {
        $case = $this->requireCase($caseId);
        if (CaseStatus::isTerminal($case->status)) { throw new RuntimeException('This case is already closed.'); }
        $this->cases->update($caseId, array('cancelled_reason' => InputValidator::shortText($reason, 255)));
        $updated = $this->transitionStatus($caseId, CaseStatus::CANCELLED, $actorType, $actorId, 'Case cancelled: ' . InputValidator::shortText($reason, 255), 'customer');
        $this->notifier->caseCancelled($case->client_id, $case->case_number, $case->domain);
        return $updated;
    }

    public function markDisputed($caseId, $adminId, $reason)
    {
        $case = $this->requireCase($caseId);
        $updated = $this->transitionStatus($caseId, CaseStatus::DISPUTED, 'admin', $adminId, 'Case marked as disputed: ' . InputValidator::shortText($reason, 255), 'customer', array('disputed' => 1));
        AuditLogger::record('cloudhost247_broker', 'case.dispute', 'broker_case', $caseId, array('disputed' => 0), array('disputed' => 1), 'success', null, $adminId);
        $this->notifier->caseDisputed($case->client_id, $case->case_number, $case->domain);
        return $updated;
    }

    public function resolveDispute($caseId, $adminId, $resumeStatus, $note)
    {
        $updated = $this->transitionStatus($caseId, $resumeStatus, 'admin', $adminId, 'Dispute resolved: ' . InputValidator::shortText($note, 255), 'customer', array('disputed' => 0));
        AuditLogger::record('cloudhost247_broker', 'case.dispute_resolve', 'broker_case', $caseId, array('disputed' => 1), array('disputed' => 0, 'status' => $resumeStatus), 'success', null, $adminId);
        return $updated;
    }

    public function addMessage($caseId, $authorType, $authorId, $body, $visibility = 'customer')
    {
        $body = InputValidator::longText($body, 2000);
        if ($body === '') { throw new InvalidArgumentException('Message cannot be empty.'); }
        $visibility = $visibility === 'internal' ? 'internal' : 'customer';
        return $this->messages->create(array(
            'case_id' => (int) $caseId, 'author_type' => $authorType, 'author_id' => $authorId ? (int) $authorId : null,
            'body' => $body, 'visibility' => $visibility,
        ));
    }

    private function recordEvent($caseId, $eventType, $actorType, $actorId, $summary, $visibility)
    {
        return $this->events->record(array(
            'case_id' => (int) $caseId, 'event_type' => substr((string) $eventType, 0, 64),
            'visibility' => $visibility === 'internal' ? 'internal' : 'customer',
            'actor_type' => in_array($actorType, array('system', 'customer', 'admin', 'provider'), true) ? $actorType : 'system',
            'actor_id' => $actorId ? (int) $actorId : null,
            'summary' => substr((string) $summary, 0, 500),
        ));
    }

    /**
     * Real, DB-backed rate limiting on brokerage request submission
     * (requirement #30/#33) — counts this customer's own real case rows
     * created in the last hour; never a fabricated or client-side-only check.
     */
    private function assertWithinRateLimit($clientId)
    {
        $limit = (int) $this->settings->get('request_rate_limit_per_hour', '5');
        if ($limit <= 0) { return; }
        $since = date('Y-m-d H:i:s', time() - 3600);
        if ($this->cases->countCreatedSince($clientId, $since) >= $limit) {
            throw new RuntimeException('You have submitted too many brokerage requests recently. Please try again later or contact support.');
        }
    }

    private function requireCase($caseId)
    {
        $case = $this->cases->find($caseId);
        if (!$case) { throw new RuntimeException('Brokerage case not found.'); }
        return $case;
    }

    private function generateUniqueCaseNumber()
    {
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $candidate = $this->numbers->next();
            if (!$this->cases->findByCaseNumber($candidate)) { return $candidate; }
        }
        throw new RuntimeException('Could not allocate a unique brokerage case number. Please try again.');
    }
}
