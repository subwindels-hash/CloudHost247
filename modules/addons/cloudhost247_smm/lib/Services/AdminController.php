<?php
namespace CloudHost247\Smm\Services;

use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Foundation\Support\Logger;
use CloudHost247\Smm\Adapters\AdapterFactory;
use CloudHost247\Smm\Repositories\LogRepository;
use CloudHost247\Smm\Repositories\OrderRepository;
use CloudHost247\Smm\Repositories\ProviderRepository;
use CloudHost247\Smm\Support\StatusMap;
use InvalidArgumentException;
use WHMCS\Database\Capsule;

/**
 * Admin dispatcher for the SMM addon. Every entry passes requireAdmin();
 * every state-changing POST passes requirePostToken() plus a capability
 * check. GET only ever reads; no provider API is called during rendering —
 * network operations run only from explicit POST actions or the cron.
 */
final class AdminController
{
    const PAGE_SIZE = 25;

    private $providers;
    private $orders;
    private $logs;
    private $factory;

    public function __construct(ProviderRepository $providers = null, OrderRepository $orders = null, LogRepository $logs = null, AdapterFactory $factory = null)
    {
        $this->providers = $providers ?: new ProviderRepository();
        $this->orders = $orders ?: new OrderRepository();
        $this->logs = $logs ?: new LogRepository();
        $this->factory = $factory ?: new AdapterFactory();
    }

    /**
     * @return array data + view name for AdminView
     */
    public function handle()
    {
        $adminId = AdminGuard::requireAdmin();
        $data = array(
            'view' => 'dashboard',
            'notice' => '',
            'error' => '',
            'token' => $this->token(),
        );
        try {
            if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET') === 'POST') {
                $this->handlePost($adminId, $data);
            }
            $this->handleGet($data);
        } catch (\Throwable $e) {
            $data['error'] = $e->getMessage();
            Logger::write('cloudhost247_smm', 'error', 'admin.failed', array(
                'message' => $e->getMessage(),
                'file' => basename($e->getFile()),
                'line' => $e->getLine(),
            ));
        }
        return $data;
    }

    private function handlePost($adminId, array &$data)
    {
        AdminGuard::requirePostToken();
        $op = isset($_POST['operation']) ? (string) $_POST['operation'] : '';
        $id = (int) (isset($_POST['id']) ? $_POST['id'] : 0);
        $view = isset($_POST['view']) ? (string) $_POST['view'] : 'dashboard';
        if (!preg_match('/^[a-z_]+$/', $view)) {
            $view = 'dashboard';
        }
        $data['view'] = $view;

        switch ($op) {
            case 'provider_save':
                AdminGuard::requireCapability('cloudhost247_smm', 'providers.manage');
                $result = (new ProviderService($this->providers, $this->logs, $this->factory))->save($_POST, $adminId);
                break;
            case 'provider_toggle':
                AdminGuard::requireCapability('cloudhost247_smm', 'providers.manage');
                $result = (new ProviderService($this->providers, $this->logs, $this->factory))
                    ->toggle($id, !empty($_POST['enabled']), $adminId);
                break;
            case 'provider_test':
                AdminGuard::requireCapability('cloudhost247_smm', 'providers.manage');
                $result = (new ProviderService($this->providers, $this->logs, $this->factory))->test($id);
                break;
            case 'provider_sync':
                AdminGuard::requireCapability('cloudhost247_smm', 'providers.manage');
                $result = (new SyncService($this->providers, $this->logs, $this->factory))->syncProvider($id, 'admin');
                break;
            case 'provider_delete':
                AdminGuard::requireCapability('cloudhost247_smm', 'providers.manage');
                $result = (new ProviderService($this->providers, $this->logs, $this->factory))
                    ->delete($id, !empty($_POST['confirm']), $adminId);
                break;
            case 'service_toggle':
                AdminGuard::requireCapability('cloudhost247_smm', 'providers.manage');
                $service = $this->providers->findService($id);
                if ($service === null) {
                    throw new InvalidArgumentException('Service not found.');
                }
                $this->providers->updateService($id, array('available' => !empty($_POST['available']) ? 1 : 0));
                AuditLogger::record('cloudhost247_smm', 'service.toggle', 'service', $id,
                    array('available' => (int) $service->available), array('available' => !empty($_POST['available']) ? 1 : 0), 'success', null, $adminId);
                $result = array('ok' => true, 'message' => 'Service availability updated.');
                break;
            case 'mapping_save':
                AdminGuard::requireCapability('cloudhost247_smm', 'mappings.manage');
                $result = (new MappingService($this->providers))->save($_POST, $adminId);
                break;
            case 'mapping_toggle':
                AdminGuard::requireCapability('cloudhost247_smm', 'mappings.manage');
                $result = (new MappingService($this->providers))->toggle($id, !empty($_POST['enabled']), $adminId);
                break;
            case 'mapping_delete':
                AdminGuard::requireCapability('cloudhost247_smm', 'mappings.manage');
                $result = (new MappingService($this->providers))->delete($id, !empty($_POST['confirm']), $adminId);
                break;
            case 'order_retry':
                AdminGuard::requireCapability('cloudhost247_smm', 'orders.manage');
                $result = $this->orderService()->retrySubmission($id, $adminId);
                break;
            case 'order_attach':
                AdminGuard::requireCapability('cloudhost247_smm', 'orders.manage');
                $result = $this->orderService()->attachProviderOrder($id, isset($_POST['provider_order_id']) ? $_POST['provider_order_id'] : '', $adminId);
                break;
            case 'order_sync':
                AdminGuard::requireCapability('cloudhost247_smm', 'orders.manage');
                $result = $this->statusSync()->syncSingle($id);
                break;
            case 'order_refill':
                AdminGuard::requireCapability('cloudhost247_smm', 'orders.manage');
                $result = $this->clientArea()->requestRefillById($id, $adminId);
                break;
            case 'order_cancel':
                AdminGuard::requireCapability('cloudhost247_smm', 'orders.manage');
                $result = $this->clientArea()->requestCancelById($id, $adminId);
                break;
            case 'automation_run':
                AdminGuard::requireCapability('cloudhost247_smm', 'settings.manage');
                $report = $this->automation()->run('admin');
                $result = array('ok' => true, 'message' => $report['ran']
                    ? 'Automation run executed. Tasks: ' . implode(', ', array_keys($report['tasks']))
                    : 'Automation run skipped: ' . $report['reason']);
                break;
            case 'settings_save':
                AdminGuard::requireCapability('cloudhost247_smm', 'settings.manage');
                $result = $this->saveSettings($adminId);
                break;
            case 'logs_purge':
                AdminGuard::requireCapability('cloudhost247_smm', 'logs.manage');
                if (empty($_POST['confirm'])) {
                    throw new InvalidArgumentException('Log purge requires the confirmation checkbox.');
                }
                $deleted = $this->logs->purgeOlderThanDays((int) (isset($_POST['retention_days']) ? $_POST['retention_days'] : 90));
                AuditLogger::record('cloudhost247_smm', 'logs.purge', 'api-log', 'global', array(), array('deleted' => $deleted), 'success', null, $adminId);
                $result = array('ok' => true, 'message' => $deleted . ' API log rows purged.');
                break;
            default:
                throw new InvalidArgumentException('Unknown operation.');
        }
        if (!empty($result['ok'])) {
            $data['notice'] = isset($result['message']) ? $result['message'] : 'Done.';
        } else {
            $data['error'] = isset($result['message']) ? $result['message'] : 'The operation failed.';
        }
    }

    private function handleGet(array &$data)
    {
        $view = isset($_GET['view']) ? (string) $_GET['view'] : $data['view'];
        if (!preg_match('/^[a-z_]+$/', $view)) {
            $view = 'dashboard';
        }
        $data['view'] = $view;
        $page = max(1, (int) (isset($_GET['page']) ? $_GET['page'] : 1));
        $data['page'] = $page;
        $data['filters'] = array(
            'provider_id' => (int) (isset($_GET['provider_id']) ? $_GET['provider_id'] : 0),
            'status' => isset($_GET['status']) ? (string) $_GET['status'] : '',
            'available' => isset($_GET['available']) ? (string) $_GET['available'] : '',
            'category' => isset($_GET['category']) ? (string) $_GET['category'] : '',
            'operation' => isset($_GET['operation']) ? (string) $_GET['operation'] : '',
            'result' => isset($_GET['result']) ? (string) $_GET['result'] : '',
            'q' => isset($_GET['q']) ? trim((string) $_GET['q']) : '',
        );
        $data['statuses'] = StatusMap::allStatuses();
        $data['providers'] = $this->providers->all();

        switch ($view) {
            case 'providers':
            case 'provider_edit':
                $data['adapters'] = AdapterFactory::availableAdapters();
                if ($view === 'provider_edit') {
                    $data['provider'] = $this->providers->find((int) (isset($_GET['id']) ? $_GET['id'] : 0));
                }
                break;
            case 'services':
                $data['services'] = $this->providers->servicesWithJoins($data['filters'], self::PAGE_SIZE, ($page - 1) * self::PAGE_SIZE);
                $data['total'] = $this->providers->countServices($data['filters']);
                break;
            case 'mappings':
            case 'mapping_edit':
                if ($view === 'mapping_edit') {
                    $data['mapping'] = $this->providers->mappingById((int) (isset($_GET['id']) ? $_GET['id'] : 0));
                }
                $data['mappings'] = $this->providers->mappingsWithJoins(array(), 200, 0);
                $data['products'] = $this->whmcsProducts();
                $data['catalog'] = $this->catalogForSelect();
                break;
            case 'orders':
            case 'order_view':
                if ($view === 'order_view') {
                    $id = (int) (isset($_GET['id']) ? $_GET['id'] : 0);
                    $data['order'] = $this->orders->findById($id);
                    $data['events'] = $this->orders->eventsForOrder($id, 100);
                    $data['api_calls'] = $this->logs->recentForProvider($data['order'] !== null ? (int) $data['order']->provider_id : 0, 10);
                } else {
                    $data['orders'] = $this->orders->search($data['filters'], self::PAGE_SIZE, ($page - 1) * self::PAGE_SIZE);
                    $data['total'] = $this->orders->countSearch($data['filters']);
                }
                break;
            case 'logs':
                $data['logs'] = $this->logs->search($data['filters'], self::PAGE_SIZE, ($page - 1) * self::PAGE_SIZE);
                $data['total'] = $this->logs->countSearch($data['filters']);
                break;
            case 'settings':
                $data['settings'] = Settings::all();
                $data['runtime'] = array(
                    'last_status_sync_at' => Settings::getRuntime('last_status_sync_at'),
                    'last_reconciliation_at' => Settings::getRuntime('last_reconciliation_at'),
                    'last_catalog_sync_at' => Settings::getRuntime('last_catalog_sync_at'),
                );
                break;
            case 'dashboard':
            default:
                $data['view'] = 'dashboard';
                $data['status_counts'] = $this->orders->statusCounts();
                $data['total_orders'] = $this->orders->countAll();
                $data['recent_orders'] = $this->orders->search(array(), 10, 0);
                $data['uncertain'] = $this->orders->findByState(OrderService::STATE_UNCERTAIN, 50);
                $data['needs_review'] = $this->orders->findNeedingReview(50);
                $data['runtime'] = array(
                    'last_status_sync_at' => Settings::getRuntime('last_status_sync_at'),
                    'last_catalog_sync_at' => Settings::getRuntime('last_catalog_sync_at'),
                );
                break;
        }
    }

    private function saveSettings($adminId)
    {
        $before = Settings::all();
        $pairs = array(
            'status_sync_minutes' => Settings::intBounds('status_sync_minutes', $_POST['status_sync_minutes'] ?? 15, 5, 1440),
            'catalog_sync_hours' => Settings::intBounds('catalog_sync_hours', $_POST['catalog_sync_hours'] ?? 24, 1, 720),
            'reconcile_minutes' => Settings::intBounds('reconcile_minutes', $_POST['reconcile_minutes'] ?? 60, 5, 1440),
            'order_batch_size' => Settings::intBounds('order_batch_size', $_POST['order_batch_size'] ?? 25, 1, 200),
            'reconcile_batch_size' => Settings::intBounds('reconcile_batch_size', $_POST['reconcile_batch_size'] ?? 10, 1, 200),
            'api_log_retention_days' => Settings::intBounds('api_log_retention_days', $_POST['api_log_retention_days'] ?? 90, 7, 3650),
            'cron_lock_minutes' => Settings::intBounds('cron_lock_minutes', $_POST['cron_lock_minutes'] ?? 10, 1, 60),
            'automation_enabled' => empty($_POST['automation_enabled']) ? 0 : 1,
        );
        Settings::saveMany($pairs, $adminId);
        AuditLogger::record('cloudhost247_smm', 'settings.update', 'smm-settings', 'global', $before, Settings::all(), 'success', null, $adminId);
        return array('ok' => true, 'message' => 'Settings saved.');
    }

    private function whmcsProducts()
    {
        // Read-only access to WHMCS products for the mapping dropdown.
        // The module never creates or modifies products or pricing.
        try {
            return Capsule::table('tblproducts')
                ->select('id', 'name', 'gid')
                ->orderBy('gid')->orderBy('name')
                ->get();
        } catch (\Throwable $e) {
            return array();
        }
    }

    private function catalogForSelect()
    {
        $out = array();
        foreach ($this->providers->all() as $provider) {
            foreach ($this->providers->servicesForProvider((int) $provider->id) as $service) {
                $out[] = array(
                    'id' => (int) $service->id,
                    'provider_id' => (int) $provider->id,
                    'provider_name' => (string) $provider->name,
                    'label' => (string) $service->name . ' [' . $service->provider_service_id . ']',
                    'available' => (int) $service->available,
                );
            }
        }
        return $out;
    }

    private function orderService()
    {
        return new OrderService($this->providers, $this->orders, $this->logs, $this->factory);
    }

    private function statusSync()
    {
        return new StatusSyncService($this->providers, $this->orders, $this->logs, $this->factory);
    }

    private function clientArea()
    {
        return new ClientAreaService($this->providers, $this->orders, $this->logs, $this->factory);
    }

    private function automation()
    {
        return new Automation($this->orders, $this->orderService(), $this->statusSync(),
            new ReconciliationService($this->providers, $this->orders, $this->logs, $this->factory),
            new SyncService($this->providers, $this->logs, $this->factory));
    }

    private function token()
    {
        return function_exists('generate_token') ? generate_token('plain') : '';
    }
}
