<?php
/**
 * Truphone Provider Implementation
 * Supports: eSIM services
 */

namespace PhoneServices\Providers;

use PhoneServices\Interfaces\EsimProviderInterface;
use PhoneServices\Core\Logger;

class TruphoneProvider extends AbstractProvider implements EsimProviderInterface
{
    private $apiKey;
    private $apiUrl = 'https://api.truphone.com/esim/v1';
    
    public function getName(): string
    {
        return 'truphone';
    }
    
    public function configure(array $config): void
    {
        parent::configure($config);
        $this->apiKey = $config['api_key'] ?? '';
        if ($this->apiKey) {
            $this->httpClient = new \GuzzleHttp\Client([
                'base_uri' => $this->apiUrl,
                'timeout' => 30,
                'headers' => [
                    'Authorization' => 'ApiKey ' . $this->apiKey,
                    'Accept' => 'application/json',
                    'Content-Type' => 'application/json',
                ],
            ]);
        }
    }
    
    public function isAvailable(): bool
    {
        return !empty($this->apiKey);
    }
    
    public function getCapabilities(): array
    {
        return ['esim', 'data'];
    }
    
    public function testConnection(): bool
    {
        if (!$this->isAvailable()) {
            return false;
        }
        
        try {
            $response = $this->httpClient->get('/products');
            return $response->getStatusCode() === 200;
        } catch (\Exception $e) {
            $this->logError('Connection test failed', $e->getMessage());
            return false;
        }
    }
    
    // ==================== eSIM SERVICES ====================
    
    public function getPlans(string $country = null, string $region = null): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $params = [];
            if ($country) {
                $params['country'] = strtoupper($country);
            }
            if ($region) {
                $params['region'] = $region;
            }
            
            $response = $this->httpClient->get('/products', ['query' => $params]);
            $data = json_decode($response->getBody()->getContents(), true);
            
            $plans = [];
            if (isset($data['products'])) {
                foreach ($data['products'] as $product) {
                    $plans[] = [
                        'plan_id' => $product['id'] ?? '',
                        'name' => $product['name'] ?? '',
                        'description' => $product['description'] ?? '',
                        'data' => $product['data_allowance_gb'] ?? 0,
                        'validity' => $product['duration_days'] ?? 0,
                        'price' => $product['price'] ?? 0,
                        'currency' => $product['currency'] ?? 'USD',
                        'countries' => $product['countries'] ?? [],
                        'network_type' => $product['network_type'] ?? '4G',
                    ];
                }
            }
            
            $this->log('Plans retrieved', ['count' => count($plans), 'country' => $country]);
            return $plans;
        } catch (\Exception $e) {
            $this->logError('Get plans failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function purchasePlan(string $planId, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $payload = [
                'product_id' => $planId,
                'quantity' => $options['quantity'] ?? 1,
            ];
            
            if (!empty($options['email'])) {
                $payload['customer_email'] = $options['email'];
            }
            
            $response = $this->httpClient->post('/orders', ['json' => $payload]);
            $data = json_decode($response->getBody()->getContents(), true);
            
            $this->log('eSIM plan purchased', ['plan' => $planId, 'order' => $data['order_id'] ?? '']);
            
            return [
                'success' => true,
                'order_id' => $data['order_id'] ?? '',
                'esim_id' => $data['esims'][0]['id'] ?? '',
                'iccid' => $data['esims'][0]['iccid'] ?? '',
                'activation_code' => $data['esims'][0]['activation_code'] ?? '',
                'qr_code_data' => $data['esims'][0]['qr_code_data'] ?? '',
                'status' => $data['status'] ?? 'pending',
            ];
        } catch (\Exception $e) {
            $this->logError('Purchase plan failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function getEsimDetails(string $esimId): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $response = $this->httpClient->get('/esims/' . $esimId);
            $data = json_decode($response->getBody()->getContents(), true);
            
            $esim = $data['esim'] ?? [];
            return [
                'esim_id' => $esim['id'] ?? $esimId,
                'iccid' => $esim['iccid'] ?? '',
                'status' => $esim['status'] ?? 'unknown',
                'product' => $esim['product'] ?? [],
                'created_at' => $esim['created_at'] ?? '',
                'activated_at' => $esim['activated_at'] ?? '',
                'expires_at' => $esim['expires_at'] ?? '',
            ];
        } catch (\Exception $e) {
            $this->logError('Get eSIM details failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function getQrCodeData(string $esimId): string
    {
        if (!$this->isAvailable()) {
            return '';
        }
        
        try {
            $response = $this->httpClient->get('/esims/' . $esimId . '/qr');
            $data = json_decode($response->getBody()->getContents(), true);
            return $data['qr_code_data'] ?? '';
        } catch (\Exception $e) {
            $this->logError('Get QR code failed', $e->getMessage());
            
            // Fallback
            $details = $this->getEsimDetails($esimId);
            if (!empty($details['activation_code'])) {
                return $details['activation_code'];
            }
            return '';
        }
    }
    
    public function checkUsage(string $esimId): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $response = $this->httpClient->get('/esims/' . $esimId . '/usage');
            $data = json_decode($response->getBody()->getContents(), true);
            
            $usage = $data['usage'] ?? [];
            return [
                'esim_id' => $esimId,
                'total_data_mb' => $usage['total_data_mb'] ?? 0,
                'used_data_mb' => $usage['used_data_mb'] ?? 0,
                'remaining_data_mb' => $usage['remaining_data_mb'] ?? 0,
                'percentage_used' => $usage['percentage_used'] ?? 0,
                'expiry_date' => $usage['expiry_date'] ?? '',
                'status' => $usage['status'] ?? 'unknown',
            ];
        } catch (\Exception $e) {
            $this->logError('Check usage failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
    
    public function topUp(string $esimId, string $planId): array
    {
        if (!$this->isAvailable()) {
            return ['error' => 'Provider not available'];
        }
        
        try {
            $response = $this->httpClient->post('/esims/' . $esimId . '/top-up', [
                'json' => ['product_id' => $planId]
            ]);
            $data = json_decode($response->getBody()->getContents(), true);
            
            $this->log('eSIM topped up', ['esim' => $esimId, 'plan' => $planId]);
            
            return [
                'success' => true,
                'topup_id' => $data['topup_id'] ?? '',
                'status' => $data['status'] ?? 'pending',
            ];
        } catch (\Exception $e) {
            $this->logError('Top up failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
}
