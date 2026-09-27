<?php
/**
 * SMM Addon Hooks
 * Handles cron jobs and order automation
 */

use Illuminate\Database\Capsule\Manager as Capsule;
use SmmAddon\Helper;
use SmmAddon\ApiClient;

require_once __DIR__ . '/lib/Helper.php';
require_once __DIR__ . '/lib/ApiClient.php';

/**
 * Daily Cron Hook - Sync services and check order statuses
 */
add_hook('DailyCronJob', 1, function ($vars) {
    try {
        // Auto sync services if enabled
        $autoSync = Helper::getConfig('auto_sync');
        if ($autoSync === 'on') {
            smmaddon_perform_sync();
        }

        // Check all pending/processing orders
        smmaddon_check_orders();
    } catch (Exception $e) {
        logActivity('SMM Addon Cron Error: ' . $e->getMessage());
    }
});

/**
 * After Module Create Hook - Place SMM order when provisioning runs
 */
add_hook('AfterModuleCreate', 1, function ($vars) {
    try {
        $serviceId = $vars['params']['serviceid'] ?? 0;
        $productId = $vars['params']['pid'] ?? 0;
        $orderId   = $vars['params']['orderid'] ?? 0;
        $userId    = $vars['params']['clientsdetails']['userid'] ?? 0;

        if (!$serviceId || !$productId) {
            return;
        }

        // Find mapped SMM service
        $smmService = Capsule::table('mod_smm_services')
            ->where('whmcs_product_id', $productId)
            ->where('is_active', 1)
            ->first();

        if (!$smmService) {
            return;
        }

        // Get service custom fields
        $customFields = Capsule::table('tblcustomfieldsvalues')
            ->join('tblcustomfields', 'tblcustomfields.id', '=', 'tblcustomfieldsvalues.fieldid')
            ->where('tblcustomfieldsvalues.relid', $serviceId)
            ->select('tblcustomfields.fieldname', 'tblcustomfieldsvalues.value')
            ->get();

        $link = '';
        $quantity = 0;
        $comments = '';
        $usernames = '';

        foreach ($customFields as $cf) {
            $name = strtolower(trim($cf->fieldname));
            if (strpos($name, 'link') !== false || strpos($name, 'url') !== false) {
                $link = $cf->value;
            }
            if (strpos($name, 'quantity') !== false || strpos($name, 'count') !== false || strpos($name, 'amount') !== false) {
                $quantity = (int) $cf->value;
            }
            if (strpos($name, 'comment') !== false) {
                $comments = $cf->value;
            }
            if (strpos($name, 'username') !== false) {
                $usernames = $cf->value;
            }
        }

        // Fallback: try to get from order notes or domain field
        if (empty($link)) {
            $hosting = Capsule::table('tblhosting')->where('id', $serviceId)->first();
            if ($hosting && !empty($hosting->domain)) {
                $link = $hosting->domain;
            }
        }

        if (empty($link) || $quantity < 1) {
            logActivity("SMM Addon: Missing link or quantity for service ID {$serviceId}");
            return;
        }

        // Ensure quantity is within min/max bounds
        if ($quantity < $smmService->smm_min) {
            $quantity = (int) $smmService->smm_min;
        }
        if ($smmService->smm_max > 0 && $quantity > $smmService->smm_max) {
            $quantity = (int) $smmService->smm_max;
        }

        $config = Helper::getServerConfig($smmService->whmcs_server_id);
        $apiUrl = $config['api_url'];
        $apiKey = $config['api_key'];
        $debug  = Helper::getConfig('debug_mode') === 'on';

        if (empty($apiUrl) || empty($apiKey)) {
            logActivity("SMM Addon: API not configured for server {$smmService->whmcs_server_id}");
            return;
        }

        $client = new ApiClient($apiUrl, $apiKey, $debug);
        $result = $client->placeOrder($smmService->smm_service_id, $link, $quantity, $comments, $usernames);

        if (isset($result['order'])) {
            // Success
            Capsule::table('mod_smm_orders')->insert([
                'whmcs_order_id'  => $orderId,
                'whmcs_service_id'=> $serviceId,
                'whmcs_user_id'   => $userId,
                'smm_order_id'    => (string) $result['order'],
                'smm_service_id'  => $smmService->smm_service_id,
                'quantity'        => $quantity,
                'link'            => $link,
                'status'          => 'pending',
                'api_response'    => json_encode($result),
                'created_at'      => date('Y-m-d H:i:s'),
                'updated_at'      => date('Y-m-d H:i:s'),
            ]);

            // Update WHMCS service notes
            Capsule::table('tblhosting')
                ->where('id', $serviceId)
                ->update([
                    'notes' => 'SMM Order ID: ' . $result['order'],
                ]);

            logActivity("SMM Addon: Order placed successfully. WHMCS Service {$serviceId} -> SMM Order {$result['order']}");
        } else {
            // API returned error
            $errorMsg = isset($result['error']) ? $result['error'] : json_encode($result);
            logActivity("SMM Addon: Order failed for service {$serviceId}. Error: {$errorMsg}");

            // Store failed attempt
            Capsule::table('mod_smm_orders')->insert([
                'whmcs_order_id'  => $orderId,
                'whmcs_service_id'=> $serviceId,
                'whmcs_user_id'   => $userId,
                'smm_order_id'    => '',
                'smm_service_id'  => $smmService->smm_service_id,
                'quantity'        => $quantity,
                'link'            => $link,
                'status'          => 'error',
                'api_response'    => json_encode($result),
                'created_at'      => date('Y-m-d H:i:s'),
                'updated_at'      => date('Y-m-d H:i:s'),
            ]);
        }
    } catch (Exception $e) {
        logActivity('SMM Addon AfterModuleCreate Error: ' . $e->getMessage());
    }
});

/**
 * After Module Suspend Hook
 */
add_hook('AfterModuleSuspend', 1, function ($vars) {
    try {
        $serviceId = $vars['params']['serviceid'] ?? 0;
        $order = Helper::getOrderByServiceId($serviceId);
        if ($order && !empty($order->smm_order_id)) {
            $config = Helper::getServerConfig($order->whmcs_service_id);
            $apiUrl = $config['api_url'];
            $apiKey = $config['api_key'];
            $debug  = Helper::getConfig('debug_mode') === 'on';
            $client = new ApiClient($apiUrl, $apiKey, $debug);
            $client->cancelOrder($order->smm_order_id);
        }
    } catch (Exception $e) {
        logActivity('SMM Addon AfterModuleSuspend Error: ' . $e->getMessage());
    }
});

/**
 * After Module Terminate Hook
 */
add_hook('AfterModuleTerminate', 1, function ($vars) {
    try {
        $serviceId = $vars['params']['serviceid'] ?? 0;
        $order = Helper::getOrderByServiceId($serviceId);
        if ($order && !empty($order->smm_order_id)) {
            $config = Helper::getServerConfig($order->whmcs_service_id);
            $apiUrl = $config['api_url'];
            $apiKey = $config['api_key'];
            $debug  = Helper::getConfig('debug_mode') === 'on';
            $client = new ApiClient($apiUrl, $apiKey, $debug);
            $client->cancelOrder($order->smm_order_id);
        }
    } catch (Exception $e) {
        logActivity('SMM Addon AfterModuleTerminate Error: ' . $e->getMessage());
    }
});

/**
 * Client Area Page Hook - Inject SMM order status into service details
 */
add_hook('ClientAreaPageProductDetails', 1, function ($vars) {
    try {
        $serviceId = $vars['serviceid'] ?? 0;
        if (!$serviceId) {
            return $vars;
        }

        $order = Helper::getOrderByServiceId($serviceId);
        if ($order) {
            $vars['smm_order'] = (array) $order;
        }

        return $vars;
    } catch (Exception $e) {
        return $vars;
    }
});

/**
 * Perform service sync (called by cron or admin)
 */
function smmaddon_perform_sync()
{
    try {
        $apiUrl = Helper::getConfig('api_url');
        $apiKey = Helper::getConfig('api_key');
        $debug  = Helper::getConfig('debug_mode') === 'on';

        if (empty($apiUrl) || empty($apiKey)) {
            logActivity('SMM Addon Sync: API not configured.');
            return;
        }

        $client = new ApiClient($apiUrl, $apiKey, $debug);
        $services = $client->getServices();

        if (!is_array($services)) {
            logActivity('SMM Addon Sync: Invalid API response.');
            return;
        }

        foreach ($services as $svc) {
            $smmId = isset($svc['service']) ? (string) $svc['service'] : null;
            if (!$smmId) {
                continue;
            }

            $exists = Capsule::table('mod_smm_services')
                ->where('smm_service_id', $smmId)
                ->first();

            $data = [
                'smm_name'     => $svc['name'] ?? 'Unknown',
                'smm_category' => $svc['category'] ?? 'General',
                'smm_rate'     => isset($svc['rate']) ? (float) $svc['rate'] : 0,
                'smm_min'      => isset($svc['min']) ? (int) $svc['min'] : 0,
                'smm_max'      => isset($svc['max']) ? (int) $svc['max'] : 0,
                'smm_type'     => $svc['type'] ?? 'default',
                'updated_at'   => date('Y-m-d H:i:s'),
            ];

            if ($exists) {
                Capsule::table('mod_smm_services')
                    ->where('id', $exists->id)
                    ->update($data);
            } else {
                $data['smm_service_id'] = $smmId;
                $data['created_at'] = date('Y-m-d H:i:s');
                Capsule::table('mod_smm_services')->insert($data);
            }
        }

        logActivity('SMM Addon: Services synced via cron. Count: ' . count($services));
    } catch (Exception $e) {
        logActivity('SMM Addon Sync Error: ' . $e->getMessage());
    }
}

/**
 * Check order statuses (called by cron)
 */
function smmaddon_check_orders()
{
    try {
        $orders = Capsule::table('mod_smm_orders')
            ->whereIn('status', ['pending', 'processing', 'inprogress'])
            ->get();

        if (count($orders) === 0) {
            return;
        }

        foreach ($orders as $order) {
            try {
                if (empty($order->smm_order_id)) {
                    continue;
                }

                $config = Helper::getServerConfig($order->whmcs_service_id);
                $apiUrl = $config['api_url'];
                $apiKey = $config['api_key'];
                $debug  = Helper::getConfig('debug_mode') === 'on';

                $client = new ApiClient($apiUrl, $apiKey, $debug);
                $status = $client->getOrderStatus($order->smm_order_id);

                $update = [
                    'last_check' => date('Y-m-d H:i:s'),
                    'api_response' => json_encode($status),
                ];

                if (isset($status['status'])) {
                    $smmStatus = strtolower($status['status']);
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
                    $whmcsStatus = isset($map[$smmStatus]) ? $map[$smmStatus] : 'pending';
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

                // Sync WHMCS service status
                $whmcsStatus = 'Pending';
                if ($update['status'] === 'completed') {
                    $whmcsStatus = 'Active';
                } elseif (in_array($update['status'], ['canceled', 'error'])) {
                    $whmcsStatus = 'Cancelled';
                } elseif (in_array($update['status'], ['processing', 'inprogress'])) {
                    $whmcsStatus = 'Active';
                }

                Capsule::table('tblhosting')
                    ->where('id', $order->whmcs_service_id)
                    ->update(['domainstatus' => $whmcsStatus]);

            } catch (Exception $innerEx) {
                logActivity("SMM Addon Cron Check Error for order {$order->id}: " . $innerEx->getMessage());
            }
        }
    } catch (Exception $e) {
        logActivity('SMM Addon Check Orders Error: ' . $e->getMessage());
    }
}
