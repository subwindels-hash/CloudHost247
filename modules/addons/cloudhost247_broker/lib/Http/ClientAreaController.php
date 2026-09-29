<?php
namespace CloudHost247\Broker\Http;

use CloudHost247\Broker\Domain\CaseStatus;
use CloudHost247\Broker\Domain\DomainState;
use CloudHost247\Broker\Domain\DomainStatusResolver;
use CloudHost247\Broker\Domain\PaymentStatus;
use CloudHost247\Broker\Domain\TransferStatus;
use CloudHost247\Broker\Repositories\CaseRepository;
use CloudHost247\Broker\Repositories\DocumentRepository;
use CloudHost247\Broker\Repositories\EventRepository;
use CloudHost247\Broker\Repositories\MessageRepository;
use CloudHost247\Broker\Repositories\PaymentRepository;
use CloudHost247\Broker\Repositories\SettingsRepository;
use CloudHost247\Broker\Repositories\TransferRepository;
use CloudHost247\Broker\Security\CaseGuard;
use CloudHost247\Broker\Security\ClientGuard;
use CloudHost247\Broker\Security\InputValidator;
use CloudHost247\Broker\Services\BrokerageService;
use CloudHost247\Broker\Services\NegotiationService;
use RuntimeException;

/**
 * Customer Dashboard -> Domain Brokerage (requirement #4). Every read and
 * write is scoped to the logged-in client id; a customer can never view or
 * act on another customer's case, even by guessing an id (requirement #6).
 */
final class ClientAreaController
{
    private $cases;
    private $events;
    private $messages;
    private $payments;
    private $transfers;
    private $documents;
    private $settings;
    private $brokerage;
    private $negotiation;
    private $guard;

    public function __construct()
    {
        $this->cases = new CaseRepository();
        $this->guard = new CaseGuard($this->cases);
        $this->events = new EventRepository();
        $this->messages = new MessageRepository();
        $this->payments = new PaymentRepository();
        $this->transfers = new TransferRepository();
        $this->documents = new DocumentRepository();
        $this->settings = new SettingsRepository();
        $this->brokerage = new BrokerageService();
        $this->negotiation = new NegotiationService();
    }

    public function handle()
    {
        $data = array('view' => 'list', 'notice' => '', 'error' => '', 'token' => $this->token(), 'brokerage_enabled' => $this->settings->isBrokerageEnabled());
        try {
            $clientId = ClientGuard::requireClient();
            $data['client_id'] = $clientId;
            if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET') === 'POST') {
                $this->handlePost($clientId, $data);
            }
            $this->handleGet($clientId, $data);
        } catch (\Throwable $e) {
            $data['error'] = $e->getMessage();
        }
        return $data;
    }

    private function handlePost($clientId, array &$data)
    {
        ClientGuard::requirePostToken();
        $op = isset($_POST['operation']) ? (string) $_POST['operation'] : '';
        switch ($op) {
            case 'create_case':
                $domainStatus = array();
                $domainInput = isset($_POST['domain']) ? (string) $_POST['domain'] : '';
                try { $domainStatus = (new DomainStatusResolver())->resolve($domainInput); } catch (\Throwable $e) { $domainStatus = array(); }
                $created = $this->brokerage->createCase(array(
                    'client_id' => $clientId,
                    'domain' => $domainInput,
                    'max_budget' => isset($_POST['max_budget']) ? $_POST['max_budget'] : 0,
                    'currency' => isset($_POST['currency']) ? $_POST['currency'] : 'USD',
                    'opening_offer' => isset($_POST['opening_offer']) ? $_POST['opening_offer'] : null,
                    'customer_message' => isset($_POST['customer_message']) ? $_POST['customer_message'] : '',
                    'negotiation_instructions' => isset($_POST['negotiation_instructions']) ? $_POST['negotiation_instructions'] : '',
                    'deadline' => isset($_POST['deadline']) ? $_POST['deadline'] : null,
                    'disclose_budget_to_seller' => !empty($_POST['disclose_budget_to_seller']),
                    'terms_accepted' => !empty($_POST['terms_accepted']),
                    'domain_status' => $domainStatus,
                    'idempotency_key' => isset($_POST['idempotency_key']) ? $_POST['idempotency_key'] : ('client-' . $clientId . '-' . md5($domainInput . (isset($_POST['form_token']) ? $_POST['form_token'] : ''))),
                ));
                $data['view'] = 'detail';
                $data['id'] = $created->id;
                $data['notice'] = 'Your brokerage request ' . $created->case_number . ' has been submitted.';
                break;
            case 'add_message':
                $caseId = (int) (isset($_POST['case_id']) ? $_POST['case_id'] : 0);
                $this->guard->assertOwnedByClient($caseId, $clientId);
                $this->brokerage->addMessage($caseId, 'customer', $clientId, isset($_POST['body']) ? $_POST['body'] : '', 'customer');
                $data['view'] = 'detail'; $data['id'] = $caseId;
                $data['notice'] = 'Message sent to your broker.';
                break;
            case 'accept_offer':
                $offerId = (int) (isset($_POST['offer_id']) ? $_POST['offer_id'] : 0);
                $offer = $this->requireOfferOwnedByClient($offerId, $clientId);
                $this->negotiation->accept($offerId, 'customer', $clientId);
                $data['view'] = 'detail'; $data['id'] = $offer->case_id;
                $data['notice'] = 'Offer accepted. Your broker will proceed with payment arrangements.';
                break;
            case 'reject_offer':
                $offerId = (int) (isset($_POST['offer_id']) ? $_POST['offer_id'] : 0);
                $offer = $this->requireOfferOwnedByClient($offerId, $clientId);
                $this->negotiation->reject($offerId, 'customer', $clientId, isset($_POST['reason']) ? $_POST['reason'] : '');
                $data['view'] = 'detail'; $data['id'] = $offer->case_id;
                $data['notice'] = 'Offer rejected.';
                break;
            case 'submit_counteroffer':
                $caseId = (int) (isset($_POST['case_id']) ? $_POST['case_id'] : 0);
                $this->guard->assertOwnedByClient($caseId, $clientId);
                $this->negotiation->submit($caseId, array(
                    'amount' => isset($_POST['amount']) ? $_POST['amount'] : 0,
                    'currency' => isset($_POST['currency']) ? $_POST['currency'] : 'USD',
                    'kind' => 'counteroffer', 'from_party' => 'customer', 'to_party' => 'seller',
                    'client_id' => $clientId, 'idempotency_key' => isset($_POST['idempotency_key']) ? $_POST['idempotency_key'] : null,
                ));
                $data['view'] = 'detail'; $data['id'] = $caseId;
                $data['notice'] = 'Your counteroffer has been recorded and will be relayed by your broker.';
                break;
            case 'cancel_case':
                $caseId = (int) (isset($_POST['case_id']) ? $_POST['case_id'] : 0);
                $this->guard->assertOwnedByClient($caseId, $clientId);
                $this->brokerage->cancel($caseId, 'customer', $clientId, isset($_POST['reason']) ? $_POST['reason'] : 'Cancelled by customer.');
                $data['view'] = 'detail'; $data['id'] = $caseId;
                $data['notice'] = 'Your brokerage request has been cancelled.';
                break;
            default:
                if ($op !== '') { $data['error'] = 'Unknown operation.'; }
        }
    }

    private function handleGet($clientId, array &$data)
    {
        $view = isset($_GET['a']) ? (string) $_GET['a'] : $data['view'];
        if (!in_array($view, array('list', 'new', 'detail'), true)) { $view = 'list'; }
        $data['view'] = $view;

        if ($view === 'new') {
            $data['currencies'] = InputValidator::supportedCurrencies();
            $domain = isset($_GET['domain']) ? (string) $_GET['domain'] : '';
            $data['prefill_domain'] = $domain;
            if ($domain !== '') {
                try { $data['domain_status'] = (new DomainStatusResolver())->resolve($domain); } catch (\Throwable $e) { $data['domain_status'] = null; }
            }
            return;
        }

        if ($view === 'detail') {
            $caseId = (int) (isset($_GET['id']) ? $_GET['id'] : (isset($data['id']) ? $data['id'] : 0));
            $this->guard->assertOwnedByClient($caseId, $clientId);
            $data['case'] = $this->cases->find($caseId);
            if (!$data['case']) { throw new RuntimeException('Brokerage case not found.'); }
            $this->decorate($data['case']);
            $data['events'] = $this->events->customerTimeline($caseId);
            $data['messages'] = $this->messages->customerThread($caseId);
            $data['offers'] = $this->negotiation->timelineFor($caseId);
            $data['payments'] = $this->payments->forCase($caseId);
            $data['transfer'] = $this->transfers->currentForCase($caseId);
            $data['documents'] = $this->documents->customerVisible($caseId);
            return;
        }

        $page = max(1, (int) (isset($_GET['page']) ? $_GET['page'] : 1));
        $data['results'] = $this->cases->forClient($clientId, $page);
        foreach ($data['results']['rows'] as $row) { $this->decorate($row); }
    }

    /** Attaches human-readable labels to a case row for template display. Never mutates stored data. */
    private function decorate($case)
    {
        $case->status_label = CaseStatus::label($case->status);
        $case->payment_status_label = PaymentStatus::label($case->payment_status);
        $case->transfer_status_label = TransferStatus::label($case->transfer_status);
        $case->domain_status_label = DomainState::label($case->domain_status);
        return $case;
    }

    private function requireOfferOwnedByClient($offerId, $clientId)
    {
        $offer = (new \CloudHost247\Broker\Repositories\OfferRepository())->find($offerId);
        if (!$offer) { throw new RuntimeException('Offer not found.'); }
        $this->guard->assertOwnedByClient($offer->case_id, $clientId);
        if ($offer->to_party !== 'customer') { throw new RuntimeException('This offer is not awaiting your response.'); }
        return $offer;
    }

    private function token()
    {
        return function_exists('generate_token') ? generate_token('plain') : '';
    }
}
