<?php

declare(strict_types=1);

namespace CloudHost247\LTEProxy;

/**
 * CloudHost247 LTE Proxy API Client
 *
 * Handles all communication with the LTE Proxy API backend.
 * Implements rate limiting, request caching, and comprehensive error handling.
 *
 * @package CloudHost247\LTEProxy
 * @version 1.0.0
 */
class ApiClient
{
    /** @var string API base URL */
    private string $apiBaseUrl;

    /** @var string API authentication key */
    private string $apiKey;

    /** @var string API secret */
    private string $apiSecret;

    /** @var Logger Module logger instance */
    private Logger $logger;

    /** @var RateLimiter Rate limiter instance */
    private RateLimiter $rateLimiter;

    /** @var Cache Simple cache instance */
    private Cache $cache;

    /** @var int Request timeout in seconds */
    private int $timeout;

    /** @var bool SSL verification flag */
    private bool $sslVerify;

    /** @var string|null Last error message */
    private ?string $lastError = null;

    /** @var int|null Last HTTP response code */
    private ?int $lastHttpCode = null;

    /** @var array Default request headers */
    private array $defaultHeaders = [];

    /** @var float API version */
    private const API_VERSION = 1.0;

    /** @var int Default cache TTL in seconds */
    private const DEFAULT_CACHE_TTL = 300;

    /** @var int Max retries for failed requests */
    private const MAX_RETRIES = 3;

    /** @var int Retry delay in milliseconds */
    private const RETRY_DELAY_MS = 1000;

    /**
     * Constructor
     *
     * @param array $config Module configuration
     * @param Logger $logger Logger instance
     */
    public function __construct(array $config, Logger $logger)
    {
        $this->apiBaseUrl = rtrim($config['api_base_url'] ?? 'https://api.cloudhost247.com', '/');
        $this->apiKey = $config['api_key'] ?? '';
        $this->apiSecret = $config['api_secret'] ?? '';
        $this->timeout = (int) ($config['api_timeout'] ?? 30);
        $this->sslVerify = (bool) ($config['api_ssl_verify'] ?? true);
        $this->logger = $logger;
        $this->rateLimiter = new RateLimiter($config);
        $this->cache = new Cache($config);

        $this->defaultHeaders = [
            'Authorization: Bearer ' . $this->apiKey,
            'Content-Type: application/json',
            'Accept: application/json',
            'X-API-Version: ' . self::API_VERSION,
            'X-Client-Module: CloudHost247-LTEProxy/' . self::API_VERSION,
        ];
    }

    /**
     * Get account information
     *
     * @return array Account info response
     * @throws ApiException
     */
    public function getAccountInfo(): array
    {
        return $this->makeRequest('GET', '/account/info');
    }

    /**
     * Get account balance
     *
     * @return array Balance response
     * @throws ApiException
     */
    public function getBalance(): array
    {
        $cacheKey = 'balance_' . md5($this->apiKey);

        if ($cached = $this->cache->get($cacheKey)) {
            return $cached;
        }

        $response = $this->makeRequest('GET', '/account/balance');
        $this->cache->set($cacheKey, $response, 60);

        return $response;
    }

    /**
     * Get all active orders
     *
     * @param array $filters Optional filters (status, type, date_from, date_to)
     * @return array Orders list
     * @throws ApiException
     */
    public function getOrders(array $filters = []): array
    {
        $query = http_build_query($filters);
        $endpoint = '/orders' . ($query ? '?' . $query : '');

        return $this->makeRequest('GET', $endpoint);
    }

    /**
     * Get proxies for a specific order
     *
     * @param string $orderId Order identifier
     * @return array Proxy list for order
     * @throws ApiException
     */
    public function getOrderProxies(string $orderId): array
    {
        if (empty($orderId)) {
            throw new ApiException('Order ID is required', 400);
        }

        return $this->makeRequest('GET', '/orders/' . urlencode($orderId) . '/proxies');
    }

    /**
     * Get expired orders
     *
     * @param array $filters Optional filters
     * @return array Expired orders list
     * @throws ApiException
     */
    public function getExpiredOrders(array $filters = []): array
    {
        $query = http_build_query($filters);
        $endpoint = '/orders/expired' . ($query ? '?' . $query : '');

        return $this->makeRequest('GET', $endpoint);
    }

    /**
     * Get available 1:1 proxies
     *
     * @return array Available 1:1 proxy list
     * @throws ApiException
     */
    public function getAvailable1By1Proxies(): array
    {
        return $this->makeRequest('GET', '/proxies/available/1by1');
    }

    /**
     * Get available US proxies
     *
     * @return array Available US proxy list
     * @throws ApiException
     */
    public function getAvailableUsProxies(): array
    {
        return $this->makeRequest('GET', '/proxies/available/us');
    }

    /**
     * Get available non-US proxies
     *
     * @return array Available non-US proxy list
     * @throws ApiException
     */
    public function getAvailableNonUsProxies(): array
    {
        return $this->makeRequest('GET', '/proxies/available/non-us');
    }

    /**
     * Get available US carrier proxies
     *
     * @param string|null $carrier Specific carrier filter
     * @return array Available US carrier proxies
     * @throws ApiException
     */
    public function getAvailableUsCarrierProxies(?string $carrier = null): array
    {
        $endpoint = '/proxies/available/us-carrier';
        if ($carrier) {
            $endpoint .= '?carrier=' . urlencode($carrier);
        }

        return $this->makeRequest('GET', $endpoint);
    }

    /**
     * Buy 1:1 proxy
     *
     * @param array $params Purchase parameters
     * @return array Purchase response
     * @throws ApiException
     */
    public function buyProxy1By1(array $params): array
    {
        $required = ['region', 'carrier', 'proxy_type', 'duration'];
        $this->validateRequiredParams($params, $required);

        return $this->makeRequest('POST', '/proxies/buy/1by1', $params);
    }

    /**
     * Buy standard proxy
     *
     * @param array $params Purchase parameters
     * @return array Purchase response
     * @throws ApiException
     */
    public function buyProxy(array $params): array
    {
        $required = ['quantity', 'region', 'carrier', 'proxy_type', 'duration'];
        $this->validateRequiredParams($params, $required);

        return $this->makeRequest('POST', '/proxies/buy', $params);
    }

    /**
     * Update client IP whitelist
     *
     * @param string $proxyId Proxy identifier
     * @param string $clientIp Client IP address
     * @return array Update response
     * @throws ApiException
     */
    public function updateClientIp(string $proxyId, string $clientIp): array
    {
        if (empty($proxyId)) {
            throw new ApiException('Proxy ID is required', 400);
        }

        if (!filter_var($clientIp, FILTER_VALIDATE_IP)) {
            throw new ApiException('Invalid IP address format', 400);
        }

        return $this->makeRequest('POST', '/proxies/' . urlencode($proxyId) . '/client-ip', [
            'client_ip' => $clientIp,
        ]);
    }

    /**
     * Update proxy region
     *
     * @param string $proxyId Proxy identifier
     * @param string $region New region
     * @return array Update response
     * @throws ApiException
     */
    public function updateRegion(string $proxyId, string $region): array
    {
        if (empty($proxyId)) {
            throw new ApiException('Proxy ID is required', 400);
        }

        if (empty($region)) {
            throw new ApiException('Region is required', 400);
        }

        return $this->makeRequest('POST', '/proxies/' . urlencode($proxyId) . '/region', [
            'region' => $region,
        ]);
    }

    /**
     * Update proxy carrier
     *
     * @param string $proxyId Proxy identifier
     * @param string $carrier New carrier
     * @return array Update response
     * @throws ApiException
     */
    public function updateCarrier(string $proxyId, string $carrier): array
    {
        if (empty($proxyId)) {
            throw new ApiException('Proxy ID is required', 400);
        }

        if (empty($carrier)) {
            throw new ApiException('Carrier is required', 400);
        }

        return $this->makeRequest('POST', '/proxies/' . urlencode($proxyId) . '/carrier', [
            'carrier' => $carrier,
        ]);
    }

    /**
     * Update proxy type (SOCKS5/HTTPS)
     *
     * @param string $proxyId Proxy identifier
     * @param string $proxyType New proxy type
     * @return array Update response
     * @throws ApiException
     */
    public function updateProxyType(string $proxyId, string $proxyType): array
    {
        if (empty($proxyId)) {
            throw new ApiException('Proxy ID is required', 400);
        }

        $allowedTypes = ['SOCKS5', 'HTTPS', 'HTTP'];
        $proxyType = strtoupper($proxyType);

        if (!in_array($proxyType, $allowedTypes, true)) {
            throw new ApiException('Invalid proxy type. Allowed: ' . implode(', ', $allowedTypes), 400);
        }

        return $this->makeRequest('POST', '/proxies/' . urlencode($proxyId) . '/type', [
            'proxy_type' => $proxyType,
        ]);
    }

    /**
     * Update proxy authentication method
     *
     * @param string $proxyId Proxy identifier
     * @param array $authParams Authentication parameters
     * @return array Update response
     * @throws ApiException
     */
    public function updateProxyAuth(string $proxyId, array $authParams): array
    {
        if (empty($proxyId)) {
            throw new ApiException('Proxy ID is required', 400);
        }

        $authType = $authParams['auth_type'] ?? '';
        $allowedAuthTypes = ['ip_whitelist', 'username_password', 'both'];

        if (!in_array($authType, $allowedAuthTypes, true)) {
            throw new ApiException('Invalid auth type. Allowed: ' . implode(', ', $allowedAuthTypes), 400);
        }

        return $this->makeRequest('POST', '/proxies/' . urlencode($proxyId) . '/auth', $authParams);
    }

    /**
     * Update proxy rotation settings
     *
     * @param string $proxyId Proxy identifier
     * @param array $rotationParams Rotation parameters
     * @return array Update response
     * @throws ApiException
     */
    public function updateProxyRotation(string $proxyId, array $rotationParams): array
    {
        if (empty($proxyId)) {
            throw new ApiException('Proxy ID is required', 400);
        }

        $rotationType = $rotationParams['rotation_type'] ?? '';
        $allowedTypes = ['manual', 'timed', 'per_request', 'off'];

        if (!in_array($rotationType, $allowedTypes, true)) {
            throw new ApiException('Invalid rotation type. Allowed: ' . implode(', ', $allowedTypes), 400);
        }

        return $this->makeRequest('POST', '/proxies/' . urlencode($proxyId) . '/rotation', $rotationParams);
    }

    /**
     * Rotate proxy IP manually
     *
     * @param string $proxyId Proxy identifier
     * @return array Rotation response
     * @throws ApiException
     */
    public function rotateProxyIp(string $proxyId): array
    {
        if (empty($proxyId)) {
            throw new ApiException('Proxy ID is required', 400);
        }

        return $this->makeRequest('POST', '/proxies/' . urlencode($proxyId) . '/rotate');
    }

    /**
     * Reveal 1:1 proxy IP
     *
     * @param string $proxyId Proxy identifier
     * @return array IP revelation response
     * @throws ApiException
     */
    public function reveal1By1ProxyIp(string $proxyId): array
    {
        if (empty($proxyId)) {
            throw new ApiException('Proxy ID is required', 400);
        }

        return $this->makeRequest('POST', '/proxies/' . urlencode($proxyId) . '/reveal');
    }

    /**
     * Extend order duration
     *
     * @param string $orderId Order identifier
     * @param int $durationDays Number of days to extend
     * @return array Extension response
     * @throws ApiException
     */
    public function extendOrder(string $orderId, int $durationDays): array
    {
        if (empty($orderId)) {
            throw new ApiException('Order ID is required', 400);
        }

        if ($durationDays < 1 || $durationDays > 365) {
            throw new ApiException('Duration must be between 1 and 365 days', 400);
        }

        return $this->makeRequest('POST', '/orders/' . urlencode($orderId) . '/extend', [
            'duration_days' => $durationDays,
        ]);
    }

    /**
     * Cancel an order
     *
     * @param string $orderId Order identifier
     * @param string $reason Cancellation reason
     * @return array Cancellation response
     * @throws ApiException
     */
    public function cancelOrder(string $orderId, string $reason = ''): array
    {
        if (empty($orderId)) {
            throw new ApiException('Order ID is required', 400);
        }

        $params = [];
        if (!empty($reason)) {
            $params['reason'] = $reason;
        }

        return $this->makeRequest('POST', '/orders/' . urlencode($orderId) . '/cancel', $params);
    }

    /**
     * Add trial proxy
     *
     * @param array $params Trial parameters
     * @return array Trial response
     * @throws ApiException
     */
    public function addTrial(array $params = []): array
    {
        return $this->makeRequest('POST', '/trials', $params);
    }

    /**
     * Test if proxy is alive
     *
     * @param string $proxyId Proxy identifier
     * @return array Alive test response
     * @throws ApiException
     */
    public function testProxyAlive(string $proxyId): array
    {
        if (empty($proxyId)) {
            throw new ApiException('Proxy ID is required', 400);
        }

        return $this->makeRequest('GET', '/proxies/' . urlencode($proxyId) . '/test/alive');
    }

    /**
     * Test proxy connection speed
     *
     * @param string $proxyId Proxy identifier
     * @return array Speed test response
     * @throws ApiException
     */
    public function testProxySpeed(string $proxyId): array
    {
        if (empty($proxyId)) {
            throw new ApiException('Proxy ID is required', 400);
        }

        return $this->makeRequest('GET', '/proxies/' . urlencode($proxyId) . '/test/speed');
    }

    /**
     * Make HTTP request to API
     *
     * @param string $method HTTP method
     * @param string $endpoint API endpoint
     * @param array|null $body Request body
     * @param int $retryCount Current retry attempt
     * @return array Decoded response
     * @throws ApiException
     */
    private function makeRequest(string $method, string $endpoint, ?array $body = null, int $retryCount = 0): array
    {
        // Check rate limiting
        if (!$this->rateLimiter->canProceed()) {
            $waitTime = $this->rateLimiter->getWaitTime();
            $this->logger->warning('Rate limit exceeded', [
                'endpoint' => $endpoint,
                'wait_time' => $waitTime,
            ]);
            throw new ApiException('Rate limit exceeded. Please try again in ' . $waitTime . ' seconds.', 429);
        }

        $url = $this->apiBaseUrl . $endpoint;

        $ch = curl_init();

        $headers = $this->defaultHeaders;

        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $this->timeout);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_MAXREDIRS, 3);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, $this->sslVerify);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, $this->sslVerify ? 2 : 0);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

        // Set HTTP method
        switch (strtoupper($method)) {
            case 'POST':
                curl_setopt($ch, CURLOPT_POST, true);
                if ($body !== null) {
                    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
                }
                break;
            case 'PUT':
                curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PUT');
                if ($body !== null) {
                    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
                }
                break;
            case 'DELETE':
                curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE');
                break;
            case 'PATCH':
                curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
                if ($body !== null) {
                    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
                }
                break;
            default:
                // GET is default
                break;
        }

        // Record request start time
        $startTime = microtime(true);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $totalTime = curl_getinfo($ch, CURLINFO_TOTAL_TIME);

        $this->lastHttpCode = $httpCode;

        if ($response === false) {
            $curlError = curl_error($ch);
            $curlErrno = curl_errno($ch);
            curl_close($ch);

            $this->logger->error('CURL request failed', [
                'endpoint' => $endpoint,
                'error' => $curlError,
                'errno' => $curlErrno,
            ]);

            // Retry on transient errors
            if ($retryCount < self::MAX_RETRIES && $this->isRetryableError($curlErrno)) {
                usleep(self::RETRY_DELAY_MS * 1000 * ($retryCount + 1));
                return $this->makeRequest($method, $endpoint, $body, $retryCount + 1);
            }

            throw new ApiException('API request failed: ' . $curlError, 0);
        }

        curl_close($ch);

        // Record request in rate limiter
        $this->rateLimiter->recordRequest();

        // Log the request
        $this->logger->debug('API request completed', [
            'method' => $method,
            'endpoint' => $endpoint,
            'http_code' => $httpCode,
            'response_time' => round($totalTime, 3),
        ]);

        // Handle HTTP errors
        if ($httpCode >= 400) {
            return $this->handleHttpError($httpCode, $response, $endpoint, $method, $body, $retryCount);
        }

        // Parse JSON response
        $decoded = json_decode($response, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            $this->logger->error('Invalid JSON response', [
                'endpoint' => $endpoint,
                'response_preview' => substr($response, 0, 500),
            ]);
            throw new ApiException('Invalid API response format', 500);
        }

        // Check API-level errors
        if (isset($decoded['success']) && $decoded['success'] === false) {
            $errorMessage = $decoded['message'] ?? $decoded['error'] ?? 'Unknown API error';
            $errorCode = $decoded['code'] ?? $httpCode;

            $this->logger->warning('API returned error', [
                'endpoint' => $endpoint,
                'error' => $errorMessage,
                'code' => $errorCode,
            ]);

            throw new ApiException($errorMessage, $errorCode, $decoded);
        }

        return $decoded;
    }

    /**
     * Handle HTTP error responses
     *
     * @param int $httpCode HTTP status code
     * @param string $response Raw response
     * @param string $endpoint API endpoint
     * @param string $method HTTP method
     * @param array|null $body Request body
     * @param int $retryCount Current retry count
     * @return array Never returns - always throws
     * @throws ApiException
     */
    private function handleHttpError(int $httpCode, string $response, string $endpoint, string $method, ?array $body, int $retryCount): array
    {
        $decoded = json_decode($response, true);
        $errorMessage = 'HTTP Error ' . $httpCode;

        if (json_last_error() === JSON_ERROR_NONE && isset($decoded['message'])) {
            $errorMessage = $decoded['message'];
        }

        $this->logger->error('HTTP error response', [
            'endpoint' => $endpoint,
            'http_code' => $httpCode,
            'error' => $errorMessage,
        ]);

        // Retry on specific status codes
        if ($retryCount < self::MAX_RETRIES && in_array($httpCode, [502, 503, 504], true)) {
            usleep(self::RETRY_DELAY_MS * 1000 * ($retryCount + 1));
            return $this->makeRequest($method, $endpoint, $body, $retryCount + 1);
        }

        throw new ApiException($errorMessage, $httpCode, $decoded ?? null);
    }

    /**
     * Check if a CURL error is retryable
     *
     * @param int $errno CURL error number
     * @return bool
     */
    private function isRetryableError(int $errno): bool
    {
        $retryableErrors = [
            CURLE_COULDNT_CONNECT,
            CURLE_OPERATION_TIMEDOUT,
            CURLE_GOT_NOTHING,
            CURLE_RECV_ERROR,
            CURLE_SEND_ERROR,
            CURLE_SSL_CONNECT_ERROR,
        ];

        return in_array($errno, $retryableErrors, true);
    }

    /**
     * Validate required parameters
     *
     * @param array $params Input parameters
     * @param array $required Required field names
     * @throws ApiException
     */
    private function validateRequiredParams(array $params, array $required): void
    {
        $missing = [];

        foreach ($required as $field) {
            if (!isset($params[$field]) || (is_string($params[$field]) && trim($params[$field]) === '')) {
                $missing[] = $field;
            }
        }

        if (!empty($missing)) {
            throw new ApiException('Missing required parameters: ' . implode(', ', $missing), 400);
        }
    }

    /**
     * Get the last error message
     *
     * @return string|null
     */
    public function getLastError(): ?string
    {
        return $this->lastError;
    }

    /**
     * Get the last HTTP response code
     *
     * @return int|null
     */
    public function getLastHttpCode(): ?int
    {
        return $this->lastHttpCode;
    }

    /**
     * Validate API credentials
     *
     * @return bool True if credentials are valid
     */
    public function validateCredentials(): bool
    {
        try {
            $this->getAccountInfo();
            return true;
        } catch (ApiException $e) {
            $this->lastError = $e->getMessage();
            return false;
        }
    }

    /**
     * Get API base URL
     *
     * @return string
     */
    public function getApiBaseUrl(): string
    {
        return $this->apiBaseUrl;
    }

    /**
     * Get configured API key (masked)
     *
     * @return string
     */
    public function getMaskedApiKey(): string
    {
        if (strlen($this->apiKey) <= 8) {
            return '****';
        }

        return substr($this->apiKey, 0, 4) . '****' . substr($this->apiKey, -4);
    }
}
