<?php
/**
 * SMM Panel Integration - Helper Class
 */

namespace SmmAddon;

use Illuminate\Database\Capsule\Manager as Capsule;
use Exception;

class Helper
{
    /**
     * Get module configuration
     */
    public static function getConfig($key = null, $default = null)
    {
        try {
            $settings = Capsule::table('mod_smm_config')
                ->pluck('value', 'setting')
                ->toArray();

            if ($key) {
                return isset($settings[$key]) ? $settings[$key] : $default;
            }
            return $settings;
        } catch (Exception $e) {
            return $default;
        }
    }

    /**
     * Set module configuration
     */
    public static function setConfig($key, $value)
    {
        try {
            Capsule::table('mod_smm_config')
                ->updateOrInsert(
                    ['setting' => $key],
                    ['value' => $value, 'updated_at' => date('Y-m-d H:i:s')]
                );
            return true;
        } catch (Exception $e) {
            return false;
        }
    }

    /**
     * Log API request/response
     */
    public static function logApi($action, $endpoint, $request, $response, $httpCode = null, $error = null)
    {
        try {
            Capsule::table('mod_smm_logs')->insert([
                'action'    => substr($action, 0, 255),
                'endpoint'  => substr($endpoint, 0, 500),
                'request'   => is_string($request) ? $request : json_encode($request),
                'response'  => is_string($response) ? $response : json_encode($response),
                'http_code' => $httpCode,
                'error'     => $error,
                'created_at'=> date('Y-m-d H:i:s'),
            ]);
        } catch (Exception $e) {
            // Silently fail logging to prevent crashes
        }
    }

    /**
     * Sanitize input
     */
    public static function sanitize($input, $type = 'string')
    {
        if (is_array($input)) {
            $clean = [];
            foreach ($input as $key => $val) {
                $clean[$key] = self::sanitize($val, $type);
            }
            return $clean;
        }

        switch ($type) {
            case 'int':
                return (int) $input;
            case 'float':
                return (float) $input;
            case 'url':
                return filter_var($input, FILTER_SANITIZE_URL);
            case 'email':
                return filter_var($input, FILTER_SANITIZE_EMAIL);
            case 'html':
                return htmlspecialchars($input, ENT_QUOTES, 'UTF-8');
            case 'string':
            default:
                return htmlspecialchars(trim($input), ENT_QUOTES, 'UTF-8');
        }
    }

    /**
     * Get all SMM services
     */
    public static function getServices($activeOnly = false, $productId = null)
    {
        try {
            $query = Capsule::table('mod_smm_services');
            if ($activeOnly) {
                $query->where('is_active', 1);
            }
            if ($productId) {
                $query->where('whmcs_product_id', $productId);
            }
            return $query->get()->toArray();
        } catch (Exception $e) {
            return [];
        }
    }

    /**
     * Get SMM order by WHMCS service ID
     */
    public static function getOrderByServiceId($serviceId)
    {
        try {
            return Capsule::table('mod_smm_orders')
                ->where('whmcs_service_id', $serviceId)
                ->first();
        } catch (Exception $e) {
            return null;
        }
    }

    /**
     * Get SMM order by WHMCS order ID
     */
    public static function getOrderByWHMCSOrderId($orderId)
    {
        try {
            return Capsule::table('mod_smm_orders')
                ->where('whmcs_order_id', $orderId)
                ->first();
        } catch (Exception $e) {
            return null;
        }
    }

    /**
     * Update order status
     */
    public static function updateOrderStatus($id, $status, $extra = [])
    {
        try {
            $data = array_merge(['status' => $status, 'updated_at' => date('Y-m-d H:i:s')], $extra);
            Capsule::table('mod_smm_orders')
                ->where('id', $id)
                ->update($data);
            return true;
        } catch (Exception $e) {
            return false;
        }
    }

    /**
     * Format price with markup
     */
    public static function calculatePrice($baseRate, $markupPercent, $markupFixed)
    {
        $price = $baseRate;
        if ($markupPercent > 0) {
            $price += ($price * ($markupPercent / 100));
        }
        if ($markupFixed > 0) {
            $price += $markupFixed;
        }
        return round($price, 4);
    }

    /**
     * Get server config from provisioning module
     */
    public static function getServerConfig($serverId)
    {
        try {
            $row = Capsule::table('mod_smm_server_map')
                ->where('server_id', $serverId)
                ->where('is_active', 1)
                ->first();

            if ($row) {
                return [
                    'api_url' => $row->api_url,
                    'api_key' => $row->api_key,
                ];
            }

            // Fallback to addon config
            return [
                'api_url' => self::getConfig('api_url'),
                'api_key' => self::getConfig('api_key'),
            ];
        } catch (Exception $e) {
            return [
                'api_url' => self::getConfig('api_url'),
                'api_key' => self::getConfig('api_key'),
            ];
        }
    }

    /**
     * Save server config
     */
    public static function setServerConfig($serverId, $apiUrl, $apiKey)
    {
        try {
            Capsule::table('mod_smm_server_map')
                ->updateOrInsert(
                    ['server_id' => $serverId],
                    [
                        'api_url'   => $apiUrl,
                        'api_key'   => $apiKey,
                        'is_active' => 1,
                        'updated_at'=> date('Y-m-d H:i:s')
                    ]
                );
            return true;
        } catch (Exception $e) {
            return false;
        }
    }

    /**
     * Safe JSON decode
     */
    public static function jsonDecode($string, $assoc = true)
    {
        if (empty($string)) {
            return null;
        }
        $result = json_decode($string, $assoc);
        return (json_last_error() === JSON_ERROR_NONE) ? $result : null;
    }

    /**
     * Get recent logs
     */
    public static function getLogs($limit = 100, $action = null)
    {
        try {
            $query = Capsule::table('mod_smm_logs')->orderBy('id', 'desc');
            if ($action) {
                $query->where('action', 'like', '%' . $action . '%');
            }
            return $query->limit($limit)->get()->toArray();
        } catch (Exception $e) {
            return [];
        }
    }

    /**
     * Delete logs older than X days
     */
    public static function purgeLogs($days = 30)
    {
        try {
            Capsule::table('mod_smm_logs')
                ->where('created_at', '<', date('Y-m-d H:i:s', strtotime("-{$days} days")))
                ->delete();
            return true;
        } catch (Exception $e) {
            return false;
        }
    }
}
