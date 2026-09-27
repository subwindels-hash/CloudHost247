<?php
/**
 * Airalo Provider Implementation
 * Supports: eSIM provisioning, data plans
 */

namespace PhoneServices\Providers;

use PhoneServices\Interfaces\EsimProviderInterface;
use PhoneServices\Core\Logger;

class AiraloProvider extends AbstractProvider implements EsimProviderInterface
{
    private $apiToken;
    private $apiUrl = 'https://api.airalo.com/v2';
    
    public function getName(): string
    {
        return 'airalo';
    }
    
    public function configure(array $config): void
    {
        parent::configure($config);
        $this->apiToken = $config['api_token'] ?? '';
        if ($this->apiToken) {
            $this->httpClient = new \GuzzleHttp\Client([
                'base_uri' => $this->apiUrl,
                'timeout' => 30,
                'headers' => [
                    'Authorization' => 'Bearer ' . $this->apiToken,
                    'Accept' => 'application/json',
                ],
            ]);
        }
    }
    
    public function isAvailable(): bool
    {
        return !empty($this->apiToken);
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
            $response = $this->httpClient->get('/packages');
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
                $params['filter[country]'] = strtoupper($country);
            }
            if ($region) {
                $params['filter[region]'] = strtolower($region);
            }
            
            $response = $this->httpClient->get('/packages', ['query' => $params]);
            $data = json_decode($response->getBody()->getContents(), true);
            
            $plans = [];
            if (isset($data['data'])) {
                foreach ($data['data'] as $plan) {
                    $plans[] = [
                        'plan_id' => $plan['id'],
                        'slug' => $plan['slug'] ?? '',
                        'name' => $plan['title'] ?? '',
                        'description' => $plan['description'] ?? '',
                        'data' => $plan['data'] ?? '0',
                        'validity' => $plan['validity'] ?? 0,
                        'price' => $plan['price'] ?? 0,
                        'currency' => $plan['price_per_unit_currency'] ?? 'USD',
                        'countries' => $plan['countries'] ?? [],
                        'operator' => $plan['operator'] ?? [],
                        'network_type' => $plan['netmask'] ?? '3G/4G',
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
                'package_id' => $planId,
                'quantity' => $options['quantity'] ?? 1,
            ];
            
            if (!empty($options['email'])) {
                $payload['email'] = $options['email'];
            }
            if (!empty($options['phone_number'])) {
                $payload['phone_number'] = $options['phone_number'];
            }
            
            $response = $this->httpClient->post('/orders', ['json' => $payload]);
            $data = json_decode($response->getBody()->getContents(), true);
            
            $this->log('eSIM plan purchased', ['plan' => $planId, 'order' => $data['data']['id'] ?? '']);
            
            return [
                'success' => true,
                'order_id' => $data['data']['id'] ?? '',
                'code' => $data['data']['code'] ?? '',
                'esim_id' => $data['data']['sims'][0]['id'] ?? '',
                'iccid' => $data['data']['sims'][0]['iccid'] ?? '',
                'lpa_code' => $data['data']['sims'][0]['lpa'] ?? '',
                'manual_code' => $data['data']['sims'][0]['manualInstallation'] ?? '',
                'qr_code_data' => $data['data']['sims'][0]['qrcode'] ?? '',
                'status' => $data['data']['status'] ?? 'pending',
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
            $response = $this->httpClient->get('/sims/' . $esimId);
            $data = json_decode($response->getBody()->getContents(), true);
            
            $sim = $data['data'] ?? [];
            return [
                'esim_id' => $sim['id'] ?? $esimId,
                'iccid' => $sim['iccid'] ?? '',
                'lpa_code' => $sim['lpa'] ?? '',
                'status' => $sim['status'] ?? 'unknown',
                'package' => $sim['package'] ?? [],
                'created_at' => $sim['created_at'] ?? '',
                'activated_at' => $sim['activated_at'] ?? '',
                'expires_at' => $sim['expires_at'] ?? '',
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
            $response = $this->httpClient->get('/sims/' . $esimId . '/qr-code');
            $data = json_decode($response->getBody()->getContents(), true);
            return $data['data']['qrcode'] ?? '';
        } catch (\Exception $e) {
            $this->logError('Get QR code failed', $e->getMessage());
            
            // Fallback: construct LPA string
            $details = $this->getEsimDetails($esimId);
            if (!empty($details['lpa_code'])) {
                return $details['lpa_code'];
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
            $response = $this->httpClient->get('/sims/' . $esimId . '/usage');
            $data = json_decode($response->getBody()->getContents(), true);
            
            $usage = $data['data'] ?? [];
            return [
                'esim_id' => $esimId,
                'total_data' => $usage['total'] ?? '0',
                'used_data' => $usage['usage'] ?? '0',
                'remaining_data' => $usage['remaining'] ?? '0',
                'percentage_used' => $usage['percentage'] ?? 0,
                'expiry_date' => $usage['expire_date'] ?? '',
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
            $response = $this->httpClient->post('/sims/' . $esimId . '/top-ups', [
                'json' => ['package_id' => $planId]
            ]);
            $data = json_decode($response->getBody()->getContents(), true);
            
            $this->log('eSIM topped up', ['esim' => $esimId, 'plan' => $planId]);
            
            return [
                'success' => true,
                'topup_id' => $data['data']['id'] ?? '',
                'status' => $data['data']['status'] ?? 'pending',
            ];
        } catch (\Exception $e) {
            $this->logError('Top up failed', $e->getMessage());
            return ['error' => $e->getMessage()];
        }
    }
}
