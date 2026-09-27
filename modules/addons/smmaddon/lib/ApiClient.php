<?php
/**
 * SMM Panel API Client
 * Generic SMM API v2 compatible
 */

namespace SmmAddon;

use Exception;

class ApiClient
{
    private $apiUrl;
    private $apiKey;
    private $debug;
    private $timeout = 30;

    public function __construct($apiUrl, $apiKey, $debug = false)
    {
        $this->apiUrl = rtrim($apiUrl, '/');
        $this->apiKey = $apiKey;
        $this->debug  = $debug;
    }

    /**
     * Send request to SMM Panel
     */
    private function request($endpoint, $params = [])
    {
        $url = $this->apiUrl . '/' . ltrim($endpoint, '/');
        $params['key'] = $this->apiKey;

        $postData = http_build_query($params);

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $this->timeout);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
        curl_setopt($ch, CURLOPT_USERAGENT, 'WHMCS-SMM-Module/1.0');
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/json',
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($this->debug) {
            Helper::logApi(
                'API_REQUEST',
                $url,
                $params,
                $response,
                $httpCode,
                $curlError ?: null
            );
        }

        if ($curlError) {
            throw new Exception('cURL Error: ' . $curlError);
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            throw new Exception('HTTP Error ' . $httpCode . ': ' . $response);
        }

        $decoded = Helper::jsonDecode($response);
        if ($decoded === null) {
            throw new Exception('Invalid JSON response from API');
        }

        return $decoded;
    }

    /**
     * Get balance
     */
    public function getBalance()
    {
        return $this->request('', ['action' => 'balance']);
    }

    /**
     * Get all services
     */
    public function getServices()
    {
        return $this->request('', ['action' => 'services']);
    }

    /**
     * Place order
     */
    public function placeOrder($serviceId, $link, $quantity, $comments = '', $usernames = '', $hashtag = '', $runs = 0, $interval = 0)
    {
        $params = [
            'action'    => 'add',
            'service'   => $serviceId,
            'link'      => $link,
            'quantity'  => $quantity,
        ];

        if (!empty($comments)) {
            $params['comments'] = $comments;
        }
        if (!empty($usernames)) {
            $params['usernames'] = $usernames;
        }
        if (!empty($hashtag)) {
            $params['hashtag'] = $hashtag;
        }
        if ($runs > 0) {
            $params['runs'] = $runs;
        }
        if ($interval > 0) {
            $params['interval'] = $interval;
        }

        return $this->request('', $params);
    }

    /**
     * Get order status
     */
    public function getOrderStatus($orderId)
    {
        return $this->request('', ['action' => 'status', 'order' => $orderId]);
    }

    /**
     * Get multiple orders status
     */
    public function getOrderStatuses($orderIds)
    {
        return $this->request('', ['action' => 'status', 'orders' => implode(',', (array) $orderIds)]);
    }

    /**
     * Refill order
     */
    public function refillOrder($orderId)
    {
        return $this->request('', ['action' => 'refill', 'order' => $orderId]);
    }

    /**
     * Cancel order
     */
    public function cancelOrder($orderId)
    {
        return $this->request('', ['action' => 'cancel', 'order' => $orderId]);
    }

    /**
     * Set timeout
     */
    public function setTimeout($seconds)
    {
        $this->timeout = max(5, min(120, (int) $seconds));
    }
}
