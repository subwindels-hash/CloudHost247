<?php
/**
 * Abstract Provider Base
 * Provides common functionality for all telecom providers
 */

namespace PhoneServices\Providers;

use PhoneServices\Interfaces\TelecomProviderInterface;
use PhoneServices\Core\Logger;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\RequestException;

abstract class AbstractProvider implements TelecomProviderInterface
{
    protected $config = [];
    protected $httpClient;
    protected $apiMode = 'sandbox';
    protected $lastError = null;
    
    public function __construct()
    {
        $this->httpClient = new Client([
            'timeout' => 30,
            'connect_timeout' => 10,
            'http_errors' => false,
        ]);
    }
    
    /**
     * Configure provider
     */
    public function configure(array $config): void
    {
        $this->config = array_merge($this->config, $config);
    }
    
    /**
     * Get last error
     */
    public function getLastError(): ?string
    {
        return $this->lastError;
    }
    
    /**
     * Log provider action
     */
    protected function log(string $action, array $context = []): void
    {
        Logger::info('[' . $this->getName() . '] ' . $action, $context);
    }
    
    /**
     * Log provider error
     */
    protected function logError(string $action, string $error, array $context = []): void
    {
        $this->lastError = $error;
        Logger::error('[' . $this->getName() . '] ' . $action . ': ' . $error, $context);
    }
    
    /**
     * Make HTTP GET request
     */
    protected function get(string $url, array $headers = []): array
    {
        try {
            $response = $this->httpClient->get($url, ['headers' => $headers]);
            return [
                'status' => $response->getStatusCode(),
                'body' => json_decode($response->getBody()->getContents(), true),
            ];
        } catch (RequestException $e) {
            $this->logError('HTTP GET failed', $e->getMessage(), ['url' => $url]);
            return ['status' => 0, 'error' => $e->getMessage()];
        }
    }
    
    /**
     * Make HTTP POST request
     */
    protected function post(string $url, array $data = [], array $headers = []): array
    {
        try {
            $options = ['headers' => $headers];
            if (!empty($data)) {
                $options['json'] = $data;
            }
            $response = $this->httpClient->post($url, $options);
            return [
                'status' => $response->getStatusCode(),
                'body' => json_decode($response->getBody()->getContents(), true),
            ];
        } catch (RequestException $e) {
            $this->logError('HTTP POST failed', $e->getMessage(), ['url' => $url]);
            return ['status' => 0, 'error' => $e->getMessage()];
        }
    }
    
    /**
     * Make HTTP DELETE request
     */
    protected function delete(string $url, array $headers = []): array
    {
        try {
            $response = $this->httpClient->delete($url, ['headers' => $headers]);
            return [
                'status' => $response->getStatusCode(),
                'body' => json_decode($response->getBody()->getContents(), true),
            ];
        } catch (RequestException $e) {
            $this->logError('HTTP DELETE failed', $e->getMessage(), ['url' => $url]);
            return ['status' => 0, 'error' => $e->getMessage()];
        }
    }
    
    /**
     * Format phone number to E.164
     */
    protected function formatE164(string $number, string $country = 'US'): string
    {
        $number = preg_replace('/[^0-9+]/', '', $number);
        if (strpos($number, '+') !== 0) {
            // Add country code - simplified, in production use libphonenumber
            $number = '+' . $number;
        }
        return $number;
    }
    
    /**
     * Validate required config keys
     */
    protected function validateConfig(array $required): bool
    {
        foreach ($required as $key) {
            if (empty($this->config[$key])) {
                $this->logError('Config validation failed', "Missing required config: {$key}");
                return false;
            }
        }
        return true;
    }
    
    abstract public function getName(): string;
    abstract public function isAvailable(): bool;
    abstract public function getCapabilities(): array;
    abstract public function testConnection(): bool;
}
