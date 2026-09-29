<?php
namespace CloudHost247\Broker\Http;

use CloudHost247\Broker\Domain\CaseStatus;
use CloudHost247\Broker\Providers\AdapterRegistry;
use CloudHost247\Broker\Repositories\CaseRepository;
use CloudHost247\Broker\Repositories\FeeRepository;
use CloudHost247\Broker\Repositories\ProviderConfigRepository;
use CloudHost247\Broker\Repositories\SettingsRepository;
use CloudHost247\Broker\Services\BrokerageService;
use CloudHost247\Broker\Services\NegotiationService;
use CloudHost247\Broker\Services\PaymentService;
use CloudHost247\Broker\Services\TransferService;
use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Foundation\Support\AuditRepository;
use CloudHost247\Foundation\Support\Logger;
use WHMCS\Database\Capsule;

/**
 * Super Admin dispatcher for Domain Brokerage (requirement #5). Every entry
 * point passes AdminGuard::requireAdmin(); every state-changing POST passes
 * AdminGuard::requirePostToken() plus a per-operation capability check, so a
 * WHMCS administrator role can be scoped down to only the brokerage actions
 * it should have (requirement #30).
 */
final class AdminController
{
    /** Case-list sections and the status filter each one applies. */
    private static $statusViews = array(
        'new_requests' => array('status' => CaseStatus::REQUEST_SUBMITTED),
        'manual_required' => array('status' => CaseStatus::MANUAL_BROKER_REQUIRED),
        'assigned' => array('status' => CaseStatus::BROKER_ASSIGNED),
        'negotiations' => array('status' => CaseStatus::NEGOTIATION),
        'awaiting_customer' => array('status' => CaseStatus::AWAITING_CUSTOMER),
        'awaiting_seller' => array('status' => CaseStatus::AWAITING_SELLER),
        'agreements' => array('status' => CaseStatus::OFFER_ACCEPTED),
        'payment_pending' => array('status' => CaseStatus::PAYMENT_PENDING),
        'transfer_pending' => array('status' => CaseStatus::TRANSFER_PENDING),
        'transfer_processing' => array('status' => CaseStatus::TRANSFER_PROCESSING),
        'completed' => array('status' => CaseStatus::COMPLETED),
        'cancelled' => array('status' => CaseStatus::CANCELLED),
        'failed' => array('status' => CaseStatus::FAILED),
        'disputed' => array('status' => CaseStatus::DISPUTED),
    );

    private $cases;
    private $providersConfig;
    private $settings;
    private $fees;
    private $brokerage;
    private $negotiation;
    private $payment;
    private $transfer;
    private $adapters;

    public function __construct()
    {
        $this->cases = new CaseRepository();
        $this->providersConfig = new ProviderConfigRepository();
        $this->settings = new SettingsRepository();
        $this->fees = new FeeRepository();
        $this->brokerage = new BrokerageService();
        $this->negotiation = new NegotiationService();
        $this->payment = new PaymentService();
        $this->transfer = new TransferService();
        $this->adapters = new AdapterRegistry();
    }

    public function handle()
    {
        $adminId = AdminGuard::requireAdmin();
        $data = array('view' => 'overview', 'notice' => '', 'error' => '', 'token' => $this->token(), 'status_views' => self::$statusViews);
        try {
            if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET') === 'POST') {
                $this->handlePost($adminId, $data);
            }
            $this->handleGet($data);
        } catch (\Throwable $e) {
            $data['error'] = $e->getMessage();
            Logger::write('cloudhost247_broker', 'error', 'admin.failed', array('message' => $e->getMessage()));
        }
        return $data;
    }

    private function isSuperAdmin($adminId)
    {
        // WHMCS reserves adminroleid 1 for the Super Administrator role.
        return (int) (isset($_SESSION['adminroleid']) ? $_SESSION['adminroleid'] : 0) === 1
            || AdminGuard::capability('cloudhost247_broker', 'cases.view_all');
    }

    private function handlePost($adminId, array &$data)
    {
        AdminGuard::requirePostToken();
        $op = isset($_POST['operation']) ? (string) $_POST['operation'] : '';
        $caseId = (int) (isset($_POST['case_id']) ? $_POST['case_id'] : 0);
        $view = isset($_POST['view']) ? (string) $_POST['view'] : 'overview';
        if (!preg_match('/^[a-z_]+$/', $view)) { $view = 'overview'; }
        $data['view'] = $view;

        switch ($op) {
            case 'assign_broker':
                AdminGuard::requireCapability('cloudhost247_broker', 'cases.assign');
                $this->brokerage->assignBroker($caseId, (int) $_POST['admin_id'], $adminId, isset($_POST['note']) ? $_POST['note'] : '');
                $data['notice'] = 'Broker assigned.';
                break;
            case 'unassign_broker':
                AdminGuard::requireCapability('cloudhost247_broker', 'cases.assign');
                $this->brokerage->unassign($caseId, $adminId);
                $data['notice'] = 'Broker unassigned.';
                break;
            case 'record_contact':
                $this->assertCaseAccess($caseId, $adminId);
                $this->brokerage->recordContactAttempt($caseId, $adminId, isset($_POST['summary']) ? $_POST['summary'] : '');
                $data['notice'] = 'Contact attempt recorded.';
                break;
            case 'record_owner_response':
                $this->assertCaseAccess($caseId, $adminId);
                $this->brokerage->recordOwnerResponse($caseId, $adminId, isset($_POST['summary']) ? $_POST['summary'] : '');
                $data['notice'] = 'Owner response recorded.';
                break;
            case 'submit_offer':
                $this->assertCaseAccess($caseId, $adminId);
                $this->negotiation->submit($caseId, array(
                    'amount' => isset($_POST['amount']) ? $_POST['amount'] : 0,
                    'currency' => isset($_POST['currency']) ? $_POST['currency'] : 'USD',
                    'kind' => isset($_POST['kind']) ? $_POST['kind'] : 'offer',
                    'from_party' => isset($_POST['from_party']) ? $_POST['from_party'] : 'broker',
                    'to_party' => isset($_POST['to_party']) ? $_POST['to_party'] : 'customer',
                    'expires_at' => isset($_POST['expires_at']) ? $_POST['expires_at'] : null,
                    'admin_id' => $adminId,
                    'idempotency_key' => isset($_POST['idempotency_key']) ? $_POST['idempotency_key'] : null,
                ));
                $data['notice'] = 'Offer recorded.';
                break;
            case 'add_note':
                $this->assertCaseAccess($caseId, $adminId);
                $this->brokerage->addMessage($caseId, 'broker', $adminId, isset($_POST['body']) ? $_POST['body'] : '', isset($_POST['visibility']) ? $_POST['visibility'] : 'internal');
                $data['notice'] = 'Note saved.';
                break;
            case 'cancel_case':
                AdminGuard::requireCapability('cloudhost247_broker', 'cases.cancel');
                $this->brokerage->cancel($caseId, 'admin', $adminId, isset($_POST['reason']) ? $_POST['reason'] : '');
                $data['notice'] = 'Case cancelled.';
                break;
            case 'mark_disputed':
                AdminGuard::requireCapability('cloudhost247_broker', 'cases.dispute');
                $this->brokerage->markDisputed($caseId, $adminId, isset($_POST['reason']) ? $_POST['reason'] : '');
                $data['notice'] = 'Case marked as disputed.';
                break;
            case 'resolve_dispute':
                AdminGuard::requireCapability('cloudhost247_broker', 'cases.dispute');
                $this->brokerage->resolveDispute($caseId, $adminId, isset($_POST['resume_status']) ? $_POST['resume_status'] : CaseStatus::NEGOTIATION, isset($_POST['note']) ? $_POST['note'] : '');
                $data['notice'] = 'Dispute resolved.';
                break;
            case 'create_invoice':
                AdminGuard::requireCapability('cloudhost247_broker', 'payments.manage');
                $this->payment->createInvoice($caseId, isset($_POST['acquisition_price']) ? $_POST['acquisition_price'] : 0, $adminId);
                $data['notice'] = 'Invoice created.';
                break;
            case 'sync_payment':
                AdminGuard::requireCapability('cloudhost247_broker', 'payments.manage');
                $this->payment->syncStatus($caseId);
                $data['notice'] = 'Payment status refreshed from WHMCS.';
                break;
            case 'refund_payment':
                AdminGuard::requireCapability('cloudhost247_broker', 'payments.manage');
                $this->payment->markRefunded($caseId, $adminId, isset($_POST['reason']) ? $_POST['reason'] : '');
                $data['notice'] = 'Payment marked refunded.';
                break;
            case 'transfer_authorize':
                AdminGuard::requireCapability('cloudhost247_broker', 'transfers.manage');
                $this->transfer->authorize($caseId, $adminId, isset($_POST['registrar']) ? $_POST['registrar'] : '');
                $data['notice'] = 'Transfer authorized.';
                break;
            case 'transfer_initiate':
                AdminGuard::requireCapability('cloudhost247_broker', 'transfers.manage');
                $this->transfer->initiate($caseId, $adminId, isset($_POST['provider_reference']) ? $_POST['provider_reference'] : '');
                $data['notice'] = 'Transfer initiated.';
                break;
            case 'transfer_provider_confirmed':
                AdminGuard::requireCapability('cloudhost247_broker', 'transfers.manage');
                $this->transfer->providerConfirmed($caseId, $adminId);
                $data['notice'] = 'Provider confirmation recorded.';
                break;
            case 'transfer_processing':
                AdminGuard::requireCapability('cloudhost247_broker', 'transfers.manage');
                $this->transfer->processing($caseId, $adminId);
                $data['notice'] = 'Transfer marked processing.';
                break;
            case 'transfer_verify':
                AdminGuard::requireCapability('cloudhost247_broker', 'transfers.manage');
                $this->transfer->verify($caseId, $adminId);
                $data['notice'] = 'Transfer verified.';
                break;
            case 'transfer_complete':
                AdminGuard::requireCapability('cloudhost247_broker', 'transfers.manage');
                $this->transfer->complete($caseId, $adminId, isset($_POST['destination_account']) ? $_POST['destination_account'] : '');
                $data['notice'] = 'Case completed.';
                break;
            case 'transfer_fail':
                AdminGuard::requireCapability('cloudhost247_broker', 'transfers.manage');
                $this->transfer->fail($caseId, $adminId, isset($_POST['reason']) ? $_POST['reason'] : '');
                $data['notice'] = 'Transfer marked failed.';
                break;
            case 'provider_save':
                AdminGuard::requireCapability('cloudhost247_broker', 'providers.manage');
                $key = preg_replace('/[^a-z0-9_]/', '', isset($_POST['provider_key']) ? $_POST['provider_key'] : '');
                $before = $this->providersConfig->find($key);
                $this->providersConfig->save($key, array(
                    'priority' => max(1, min(999, (int) (isset($_POST['priority']) ? $_POST['priority'] : 100))),
                    'enabled' => !empty($_POST['enabled']) ? 1 : 0,
                    'partner_agreement_confirmed' => !empty($_POST['partner_agreement_confirmed']) ? 1 : 0,
                    'agreement_reference' => substr((string) (isset($_POST['agreement_reference']) ? $_POST['agreement_reference'] : ''), 0, 191),
                    'notes' => substr((string) (isset($_POST['notes']) ? $_POST['notes'] : ''), 0, 2000),
                ));
                AuditLogger::record('cloudhost247_broker', 'provider.save', 'broker_provider', $key, (array) $before, $_POST, 'success', null, $adminId);
                $data['notice'] = 'Provider policy saved.';
                break;
            case 'settings_save':
                AdminGuard::requireCapability('cloudhost247_broker', 'settings.manage');
                $before = $this->settings->all();
                $values = array(
                    'brokerage_enabled' => !empty($_POST['brokerage_enabled']) ? '1' : '0',
                    'manual_broker_fallback' => !empty($_POST['manual_broker_fallback']) ? '1' : '0',
                    'supported_currencies' => strtoupper(preg_replace('/[^A-Za-z,]/', '', isset($_POST['supported_currencies']) ? $_POST['supported_currencies'] : 'USD')),
                    'contact_attempt_limit' => max(1, min(20, (int) (isset($_POST['contact_attempt_limit']) ? $_POST['contact_attempt_limit'] : 3))),
                    'negotiation_expiration_hours' => max(1, min(720, (int) (isset($_POST['negotiation_expiration_hours']) ? $_POST['negotiation_expiration_hours'] : 72))),
                    'customer_notifications_enabled' => !empty($_POST['customer_notifications_enabled']) ? '1' : '0',
                    'transfer_verification_required' => !empty($_POST['transfer_verification_required']) ? '1' : '0',
                    'refund_window_days' => max(0, min(365, (int) (isset($_POST['refund_window_days']) ? $_POST['refund_window_days'] : 14))),
                );
                $this->settings->setMany($values);
                AuditLogger::record('cloudhost247_broker', 'settings.save', 'broker_settings', 0, $before, $values, 'success', null, $adminId);
                $data['notice'] = 'Settings saved.';
                break;
            case 'fee_save':
                AdminGuard::requireCapability('cloudhost247_broker', 'fees.manage');
                $feeData = array(
                    'name' => substr((string) (isset($_POST['name']) ? $_POST['name'] : ''), 0, 120),
                    'fee_type' => in_array(isset($_POST['fee_type']) ? $_POST['fee_type'] : '', array('fixed', 'percentage'), true) ? $_POST['fee_type'] : 'fixed',
                    'applies_to' => in_array(isset($_POST['applies_to']) ? $_POST['applies_to'] : '', array('brokerage_fee', 'transfer_fee', 'service_fee'), true) ? $_POST['applies_to'] : 'brokerage_fee',
                    'amount' => (float) (isset($_POST['amount']) ? $_POST['amount'] : 0),
                    'min_amount' => $_POST['min_amount'] !== '' ? (float) $_POST['min_amount'] : null,
                    'currency' => $_POST['currency'] !== '' ? strtoupper(substr((string) $_POST['currency'], 0, 8)) : null,
                    'provider_key' => $_POST['provider_key'] !== '' ? substr((string) $_POST['provider_key'], 0, 32) : null,
                    'enabled' => !empty($_POST['enabled']) ? 1 : 0,
                );
                $feeId = (int) (isset($_POST['fee_id']) ? $_POST['fee_id'] : 0);
                if ($feeId > 0) { $this->fees->update($feeId, $feeData); } else { $feeId = $this->fees->create($feeData); }
                AuditLogger::record('cloudhost247_broker', 'fee.save', 'broker_fee', $feeId, array(), $feeData, 'success', null, $adminId);
                $data['notice'] = 'Fee rule saved.';
                break;
            case 'fee_delete':
                AdminGuard::requireCapability('cloudhost247_broker', 'fees.manage');
                $feeId = (int) (isset($_POST['fee_id']) ? $_POST['fee_id'] : 0);
                $this->fees->delete($feeId);
                AuditLogger::record('cloudhost247_broker', 'fee.delete', 'broker_fee', $feeId, array(), array(), 'success', null, $adminId);
                $data['notice'] = 'Fee rule removed.';
                break;
            default:
                if ($op !== '') { $data['error'] = 'Unknown operation.'; }
        }
    }

    private function assertCaseAccess($caseId, $adminId)
    {
        if ($this->isSuperAdmin($adminId)) { return; }
        $case = $this->cases->find($caseId);
        if (!$case || (int) $case->assigned_admin_id !== (int) $adminId) {
            throw new \RuntimeException('You are not authorized to act on this brokerage case.');
        }
    }

    private function handleGet(array &$data)
    {
        $view = isset($_GET['view']) ? (string) $_GET['view'] : $data['view'];
        if (!preg_match('/^[a-z_]+$/', $view)) { $view = 'overview'; }
        $data['view'] = $view;
        $page = max(1, (int) (isset($_GET['page']) ? $_GET['page'] : 1));
        $data['page'] = $page;
        $data['filters'] = array(
            'case_number' => isset($_GET['case_number']) ? (string) $_GET['case_number'] : '',
            'domain' => isset($_GET['domain']) ? (string) $_GET['domain'] : '',
            'client_id' => isset($_GET['client_id']) ? (int) $_GET['client_id'] : 0,
            'assigned_admin_id' => isset($_GET['assigned_admin_id']) ? (int) $_GET['assigned_admin_id'] : 0,
            'provider_key' => isset($_GET['provider_key']) ? (string) $_GET['provider_key'] : '',
            'registrar' => isset($_GET['registrar']) ? (string) $_GET['registrar'] : '',
            'payment_status' => isset($_GET['payment_status']) ? (string) $_GET['payment_status'] : '',
            'transfer_status' => isset($_GET['transfer_status']) ? (string) $_GET['transfer_status'] : '',
            'from' => isset($_GET['from']) ? (string) $_GET['from'] : '',
            'to' => isset($_GET['to']) ? (string) $_GET['to'] : '',
            'q' => isset($_GET['q']) ? trim((string) $_GET['q']) : '',
        );

        if ($view === 'case_detail') {
            $caseId = (int) (isset($_GET['id']) ? $_GET['id'] : 0);
            $data['case'] = $this->cases->find($caseId);
            if ($data['case']) {
                $data['offers'] = $this->negotiation->timelineFor($caseId);
                $data['events'] = Capsule::table('mod_cloudhost247_broker_events')->where('case_id', $caseId)->orderBy('id')->get();
                $data['messages'] = Capsule::table('mod_cloudhost247_broker_messages')->where('case_id', $caseId)->orderBy('id')->get();
                $data['payments'] = Capsule::table('mod_cloudhost247_broker_payments')->where('case_id', $caseId)->orderBy('id', 'desc')->get();
                $data['transfers'] = Capsule::table('mod_cloudhost247_broker_transfers')->where('case_id', $caseId)->orderBy('id', 'desc')->get();
                $data['documents'] = Capsule::table('mod_cloudhost247_broker_documents')->where('case_id', $caseId)->orderBy('id', 'desc')->get();
                $data['assignment_history'] = Capsule::table('mod_cloudhost247_broker_assignments')->where('case_id', $caseId)->orderBy('id')->get();
            }
            return;
        }

        if (isset(self::$statusViews[$view])) {
            $filters = array_merge($data['filters'], self::$statusViews[$view]);
            $data['results'] = $this->cases->search($filters, $page);
            return;
        }

        switch ($view) {
            case 'providers':
                $rows = array();
                foreach ($this->adapters->all($this->providersConfig) as $key => $adapter) {
                    $config = $this->providersConfig->ensure($key);
                    $rows[] = array('adapter' => $adapter, 'config' => $config);
                }
                $data['provider_rows'] = $rows;
                break;
            case 'brokers':
                $data['admins'] = Capsule::table('tbladmins')->select('id', 'username', 'firstname', 'lastname')->orderBy('username')->get();
                $data['assignment_counts'] = array();
                foreach (Capsule::table('mod_cloudhost247_broker_cases')->whereNull('deleted_at')->whereNotNull('assigned_admin_id')
                    ->selectRaw('assigned_admin_id, count(*) as total')->groupBy('assigned_admin_id')->get() as $row) {
                    $data['assignment_counts'][$row->assigned_admin_id] = (int) $row->total;
                }
                break;
            case 'settings':
                $data['settings'] = $this->settings->all();
                break;
            case 'fees':
                $data['fee_rows'] = $this->fees->all();
                break;
            case 'reports':
                $data['status_counts'] = $this->cases->statusCounts();
                $data['revenue'] = $this->cases->revenueTotals();
                $data['average_acquisition'] = $this->cases->averageAcquisitionAmount();
                $data['provider_activity'] = $this->cases->providerActivity();
                break;
            case 'audit_logs':
                $filters = array('module' => 'cloudhost247_broker');
                foreach (array('q', 'action', 'resource_type', 'resource', 'result', 'correlation_id', 'admin_id', 'from', 'to') as $key) {
                    if (isset($_GET[$key])) { $filters[$key] = (string) $_GET[$key]; }
                }
                $data['audit'] = (new AuditRepository())->search($filters, isset($_GET['audit_page']) ? $_GET['audit_page'] : 1, 25);
                break;
            case 'overview':
            default:
                $data['view'] = 'overview';
                $data['status_counts'] = $this->cases->statusCounts();
                $data['revenue'] = $this->cases->revenueTotals();
                $data['average_acquisition'] = $this->cases->averageAcquisitionAmount();
                $data['recent'] = $this->cases->search(array(), 1, 10);
        }
    }

    private function token()
    {
        return function_exists('generate_token') ? generate_token('plain') : '';
    }
}
