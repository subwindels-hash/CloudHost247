<?php
/**
 * Admin Area Dispatcher
 */

namespace SmmAddon;

use Illuminate\Database\Capsule\Manager as Capsule;
use Exception;

class AdminDispatcher
{
    private $vars;

    public function dispatch($vars)
    {
        $this->vars = $vars;
        $action = isset($_REQUEST['action']) ? Helper::sanitize($_REQUEST['action'], 'string') : 'dashboard';

        // Handle AJAX actions
        if (isset($_REQUEST['ajax']) && $_REQUEST['ajax'] == '1') {
            $this->handleAjax($action);
            return;
        }

        // Handle POST actions
        if ($_SERVER['REQUEST_METHOD'] === 'POST' && !isset($_REQUEST['ajax'])) {
            $this->handlePost($action);
        }

        // Render view
        $this->render($action);
    }

    private function handlePost($action)
    {
        try {
            switch ($action) {
                case 'settings':
                    $apiUrl = Helper::sanitize($_POST['api_url'] ?? '', 'url');
                    $apiKey = trim($_POST['api_key'] ?? '');
                    $autoSync = isset($_POST['auto_sync']) ? 'on' : 'off';
                    $debugMode = isset($_POST['debug_mode']) ? 'on' : 'off';

                    if (!empty($apiUrl) && !empty($apiKey)) {
                        Helper::setConfig('api_url', $apiUrl);
                        Helper::setConfig('api_key', $apiKey);
                        Helper::setConfig('auto_sync', $autoSync);
                        Helper::setConfig('debug_mode', $debugMode);
                        $this->setFlash('success', 'Settings saved successfully.');
                    } else {
                        $this->setFlash('error', 'API URL and Key are required.');
                    }
                    header('Location: ' . $this->vars['modulelink'] . '&action=settings');
                    exit;

                case 'sync_services':
                    $this->syncServices();
                    header('Location: ' . $this->vars['modulelink'] . '&action=services');
                    exit;

                case 'map_service':
                    $smmId = Helper::sanitize($_POST['smm_service_id'] ?? '', 'string');
                    $productId = Helper::sanitize($_POST['whmcs_product_id'] ?? 0, 'int');
                    $serverId = Helper::sanitize($_POST['whmcs_server_id'] ?? 0, 'int');
                    $markupPercent = Helper::sanitize($_POST['markup_percent'] ?? 0, 'float');
                    $markupFixed = Helper::sanitize($_POST['markup_fixed'] ?? 0, 'float');

                    if ($smmId && $productId) {
                        Capsule::table('mod_smm_services')
                            ->where('smm_service_id', $smmId)
                            ->update([
                                'whmcs_product_id' => $productId,
                                'whmcs_server_id'  => $serverId,
                                'markup_percent'   => $markupPercent,
                                'markup_fixed'     => $markupFixed,
                                'is_active'        => 1,
                                'updated_at'       => date('Y-m-d H:i:s'),
                            ]);
                        $this->setFlash('success', 'Service mapped successfully.');
                    }
                    header('Location: ' . $this->vars['modulelink'] . '&action=services');
                    exit;

                case 'toggle_service':
                    $id = Helper::sanitize($_POST['id'] ?? 0, 'int');
                    $active = Helper::sanitize($_POST['is_active'] ?? 0, 'int');
                    Capsule::table('mod_smm_services')
                        ->where('id', $id)
                        ->update(['is_active' => $active, 'updated_at' => date('Y-m-d H:i:s')]);
                    $this->setFlash('success', 'Service status updated.');
                    header('Location: ' . $this->vars['modulelink'] . '&action=services');
                    exit;

                case 'clear_logs':
                    $days = Helper::sanitize($_POST['days'] ?? 30, 'int');
                    Helper::purgeLogs($days);
                    $this->setFlash('success', 'Logs cleared successfully.');
                    header('Location: ' . $this->vars['modulelink'] . '&action=logs');
                    exit;

                case 'refresh_order':
                    $orderId = Helper::sanitize($_POST['smm_order_id'] ?? '', 'string');
                    if ($orderId) {
                        $this->refreshOrderStatus($orderId);
                    }
                    header('Location: ' . $this->vars['modulelink'] . '&action=orders');
                    exit;

                case 'cancel_smm_order':
                    $orderId = Helper::sanitize($_POST['smm_order_id'] ?? '', 'string');
                    if ($orderId) {
                        $this->cancelSmmOrder($orderId);
                    }
                    header('Location: ' . $this->vars['modulelink'] . '&action=orders');
                    exit;
            }
        } catch (Exception $e) {
            $this->setFlash('error', $e->getMessage());
        }
    }

    private function handleAjax($action)
    {
        header('Content-Type: application/json');
        try {
            switch ($action) {
                case 'sync_services':
                    $result = $this->syncServices(true);
                    echo json_encode(['status' => 'success', 'message' => $result]);
                    break;

                case 'get_service_info':
                    $smmId = Helper::sanitize($_REQUEST['smm_service_id'] ?? '', 'string');
                    $service = Capsule::table('mod_smm_services')
                        ->where('smm_service_id', $smmId)
                        ->first();
                    echo json_encode(['status' => 'success', 'data' => $service]);
                    break;

                case 'refresh_order':
                    $orderId = Helper::sanitize($_REQUEST['smm_order_id'] ?? '', 'string');
                    $result = $this->refreshOrderStatus($orderId, true);
                    echo json_encode(['status' => 'success', 'data' => $result]);
                    break;

                default:
                    echo json_encode(['status' => 'error', 'message' => 'Unknown action']);
            }
        } catch (Exception $e) {
            echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
        }
        exit;
    }

    private function render($action)
    {
        $modulelink = $this->vars['modulelink'];
        $flash = $this->getFlash();

        switch ($action) {
            case 'services':
                $services = Helper::getServices();
                $products = Capsule::table('tblproducts')
                    ->select('id', 'name', 'servertype')
                    ->where('servertype', 'smmprovisioning')
                    ->orderBy('name')
                    ->get();
                $servers = Capsule::table('tblservers')
                    ->select('id', 'name')
                    ->get();
                require __DIR__ . '/templates/admin/services.php';
                break;

            case 'orders':
                $orders = Capsule::table('mod_smm_orders')
                    ->orderBy('id', 'desc')
                    ->limit(200)
                    ->get();
                require __DIR__ . '/templates/admin/orders.php';
                break;

            case 'logs':
                $logs = Helper::getLogs(200);
                require __DIR__ . '/templates/admin/logs.php';
                break;

            case 'settings':
                $config = Helper::getConfig();
                require __DIR__ . '/templates/admin/settings.php';
                break;

            case 'dashboard':
            default:
                $stats = $this->getDashboardStats();
                $recentOrders = Capsule::table('mod_smm_orders')
                    ->orderBy('id', 'desc')
                    ->limit(10)
                    ->get();
                require __DIR__ . '/templates/admin/dashboard.php';
                break;
        }
    }

    private function getDashboardStats()
    {
        try {
            return [
                'total_services' => Capsule::table('mod_smm_services')->count(),
                'active_services' => Capsule::table('mod_smm_services')->where('is_active', 1)->count(),
                'total_orders' => Capsule::table('mod_smm_orders')->count(),
                'pending_orders' => Capsule::table('mod_smm_orders')->where('status', 'pending')->count(),
                'processing_orders' => Capsule::table('mod_smm_orders')
                    ->whereIn('status', ['processing', 'inprogress'])->count(),
                'completed_orders' => Capsule::table('mod_smm_orders')->where('status', 'completed')->count(),
                'canceled_orders' => Capsule::table('mod_smm_orders')
                    ->whereIn('status', ['canceled', 'error'])->count(),
            ];
        } catch (Exception $e) {
            return [
                'total_services' => 0,
                'active_services' => 0,
                'total_orders' => 0,
                'pending_orders' => 0,
                'processing_orders' => 0,
                'completed_orders' => 0,
                'canceled_orders' => 0,
            ];
        }
    }

    private function syncServices($returnCount = false)
    {
        $apiUrl = Helper::getConfig('api_url');
        $apiKey = Helper::getConfig('api_key');
        $debug  = Helper::getConfig('debug_mode') === 'on';

        if (empty($apiUrl) || empty($apiKey)) {
            throw new Exception('API URL and Key must be configured first.');
        }

        $client = new ApiClient($apiUrl, $apiKey, $debug);
        $services = $client->getServices();

        if (!is_array($services)) {
            throw new Exception('Invalid response from SMM panel API.');
        }

        $inserted = 0;
        $updated  = 0;

        foreach ($services as $svc) {
            $smmId = isset($svc['service']) ? (string) $svc['service'] : null;
            if (!$smmId) {
                continue;
            }

            $exists = Capsule::table('mod_smm_services')
                ->where('smm_service_id', $smmId)
                ->first();

            $data = [
                'smm_name'      => $svc['name'] ?? 'Unknown',
                'smm_category'  => $svc['category'] ?? 'General',
                'smm_rate'      => isset($svc['rate']) ? (float) $svc['rate'] : 0,
                'smm_min'       => isset($svc['min']) ? (int) $svc['min'] : 0,
                'smm_max'       => isset($svc['max']) ? (int) $svc['max'] : 0,
                'smm_type'      => $svc['type'] ?? 'default',
                'updated_at'    => date('Y-m-d H:i:s'),
            ];

            if ($exists) {
                Capsule::table('mod_smm_services')
                    ->where('id', $exists->id)
                    ->update($data);
                $updated++;
            } else {
                $data['smm_service_id'] = $smmId;
                $data['created_at'] = date('Y-m-d H:i:s');
                Capsule::table('mod_smm_services')->insert($data);
                $inserted++;
            }
        }

        $message = "Services synced: {$inserted} inserted, {$updated} updated.";
        if (!$returnCount) {
            $this->setFlash('success', $message);
        }
        return $message;
    }

    private function refreshOrderStatus($smmOrderId, $returnData = false)
    {
        $order = Capsule::table('mod_smm_orders')
            ->where('smm_order_id', $smmOrderId)
            ->first();

        if (!$order) {
            throw new Exception('Order not found.');
        }

        $config = Helper::getServerConfig($order->whmcs_service_id);
        $apiUrl = $config['api_url'];
        $apiKey = $config['api_key'];
        $debug  = Helper::getConfig('debug_mode') === 'on';

        $client = new ApiClient($apiUrl, $apiKey, $debug);
        $status = $client->getOrderStatus($smmOrderId);

        $update = [
            'last_check' => date('Y-m-d H:i:s'),
            'api_response' => json_encode($status),
        ];

        if (isset($status['status'])) {
            $smmStatus = strtolower($status['status']);
            $whmcsStatus = $this->mapStatus($smmStatus);
            $update['status'] = $whmcsStatus;

            if (isset($status['start_count'])) {
                $update['start_count'] = (int) $status['start_count'];
            }
            if (isset($status['remains'])) {
                $update['remains'] = (int) $status['remains'];
            }
        }

        Capsule::table('mod_smm_orders')
            ->where('id', $order->id)
            ->update($update);

        // Update WHMCS service status if applicable
        $this->syncWHMCSServiceStatus($order->whmcs_service_id, $update['status'] ?? $order->status);

        if ($returnData) {
            return array_merge((array) $order, $update);
        }
        $this->setFlash('success', 'Order status refreshed.');
        return true;
    }

    private function cancelSmmOrder($smmOrderId)
    {
        $order = Capsule::table('mod_smm_orders')
            ->where('smm_order_id', $smmOrderId)
            ->first();

        if (!$order) {
            throw new Exception('Order not found.');
        }

        $config = Helper::getServerConfig($order->whmcs_service_id);
        $apiUrl = $config['api_url'];
        $apiKey = $config['api_key'];
        $debug  = Helper::getConfig('debug_mode') === 'on';

        $client = new ApiClient($apiUrl, $apiKey, $debug);
        $result = $client->cancelOrder($smmOrderId);

        if (isset($result['cancel'])) {
            Capsule::table('mod_smm_orders')
                ->where('id', $order->id)
                ->update([
                    'status' => 'canceled',
                    'updated_at' => date('Y-m-d H:i:s'),
                    'api_response' => json_encode($result),
                ]);
            $this->syncWHMCSServiceStatus($order->whmcs_service_id, 'canceled');
            $this->setFlash('success', 'Order cancellation requested.');
        } else {
            throw new Exception('Cancel failed: ' . json_encode($result));
        }
    }

    private function mapStatus($smmStatus)
    {
        $map = [
            'pending'     => 'pending',
            'processing'  => 'processing',
            'in progress' => 'inprogress',
            'inprogress'  => 'inprogress',
            'completed'   => 'completed',
            'complete'    => 'completed',
            'canceled'    => 'canceled',
            'cancelled'   => 'canceled',
            'partial'     => 'partial',
            'refunded'    => 'refunded',
            'error'       => 'error',
        ];
        return isset($map[$smmStatus]) ? $map[$smmStatus] : 'pending';
    }

    private function syncWHMCSServiceStatus($serviceId, $status)
    {
        try {
            $whmcsStatus = 'Pending';
            if ($status === 'completed') {
                $whmcsStatus = 'Active';
            } elseif (in_array($status, ['canceled', 'error'])) {
                $whmcsStatus = 'Cancelled';
            } elseif (in_array($status, ['processing', 'inprogress'])) {
                $whmcsStatus = 'Active';
            }

            Capsule::table('tblhosting')
                ->where('id', $serviceId)
                ->update(['domainstatus' => $whmcsStatus]);
        } catch (Exception $e) {
            // Silent fail
        }
    }

    private function setFlash($type, $message)
    {
        $_SESSION['smmaddon_flash'] = ['type' => $type, 'message' => $message];
    }

    private function getFlash()
    {
        if (isset($_SESSION['smmaddon_flash'])) {
            $flash = $_SESSION['smmaddon_flash'];
            unset($_SESSION['smmaddon_flash']);
            return $flash;
        }
        return null;
    }
}
