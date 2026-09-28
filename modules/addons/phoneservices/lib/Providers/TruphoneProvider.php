<?php
/**
 * Truphone (1GLOBAL) provider - eSIM services.
 *
 * Secondary eSIM provider; implements the same EsimProviderInterface contract
 * as Airalo so the platform can switch between them from the admin panel with
 * no code change.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Providers;

use PhoneServices\Interfaces\EsimProviderInterface;

class TruphoneProvider extends AbstractProvider implements EsimProviderInterface
{
    const BASE_URL = 'https://api.truphone.com/esim/v1';

    public function getName(): string
    {
        return 'truphone';
    }

    public function getCapabilities(): array
    {
        return ['esim'];
    }

    public function isAvailable(): bool
    {
        return (string) $this->cfg('api_key') !== '';
    }

    public function testConnection(): bool
    {
        if (!$this->isAvailable()) {
            $this->lastError = 'Truphone API key is not configured';
            return false;
        }

        $response = $this->get(self::BASE_URL . '/products', ['limit' => 1], $this->headers());

        return (int) $response['status'] === 200;
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function getPlans(?string $country = null, ?string $region = null): array
    {
        if (!$this->isAvailable()) {
            return [];
        }

        $query = [];
        if ($country) {
            $query['country'] = strtoupper($country);
        }
        if ($region) {
            $query['region'] = strtolower($region);
        }

        $response = $this->get(self::BASE_URL . '/products', $query, $this->headers());

        if ((int) $response['status'] !== 200) {
            return [];
        }

        $plans = [];
        foreach ($response['body']['products'] ?? ($response['body']['data'] ?? []) as $product) {
            $plans[] = [
                'plan_id'      => (string) ($product['id'] ?? ($product['productId'] ?? '')),
                'name'         => (string) ($product['name'] ?? ''),
                'description'  => (string) ($product['description'] ?? ''),
                'data'         => (string) ($product['dataAllowance'] ?? ($product['data'] ?? '0')),
                'data_mb'      => (float) ($product['dataAllowanceMb'] ?? AiraloProvider::toMegabytes((string) ($product['dataAllowance'] ?? ''))),
                'validity'     => (int) ($product['validityDays'] ?? ($product['validity'] ?? 0)),
                'price'        => (float) ($product['price']['amount'] ?? ($product['price'] ?? 0)),
                'currency'     => (string) ($product['price']['currency'] ?? ($product['currency'] ?? 'USD')),
                'country'      => strtoupper((string) ($product['country'] ?? ($country ?? ''))),
                'countries'    => (array) ($product['coverage'] ?? []),
                'network_type' => (string) ($product['networkType'] ?? '4G/LTE'),
                'is_global'    => count((array) ($product['coverage'] ?? [])) > 1,
                'provider'     => $this->getName(),
            ];
        }

        $this->log('eSIM catalogue retrieved', ['count' => count($plans)]);

        return $plans;
    }

    /**
     * @param array<string,mixed> $options
     * @return array<string,mixed>
     */
    public function purchasePlan(string $planId, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Truphone provider is not configured');
        }

        $payload = [
            'productId' => $planId,
            'quantity'  => (int) ($options['quantity'] ?? 1),
            'reference' => (string) ($options['reference'] ?? ('whmcs-' . time())),
        ];

        if (!empty($options['email'])) {
            $payload['customerEmail'] = (string) $options['email'];
        }

        $response = $this->post(self::BASE_URL . '/orders', $payload, $this->headers());
        $status = (int) $response['status'];

        if ($status < 200 || $status >= 300) {
            return $this->failure((string) ($response['error'] ?? 'eSIM order failed'), ['provider_status' => $status]);
        }

        $body = $response['body'] ?? [];
        $esim = $body['esims'][0] ?? ($body['esim'] ?? []);

        $this->log('eSIM ordered', ['plan' => $planId, 'order' => $body['orderId'] ?? '']);

        return $this->success([
            'order_id'     => (string) ($body['orderId'] ?? ($body['id'] ?? '')),
            'esim_id'      => (string) ($esim['id'] ?? ($esim['esimId'] ?? '')),
            'iccid'        => (string) ($esim['iccid'] ?? ''),
            'lpa_code'     => (string) ($esim['activationCode'] ?? ($esim['lpa'] ?? '')),
            'smdp_address' => (string) ($esim['smdpAddress'] ?? ''),
            'matching_id'  => (string) ($esim['matchingId'] ?? ''),
            'qr_code_data' => (string) ($esim['activationCode'] ?? ''),
            'qr_code_url'  => (string) ($esim['qrCodeUrl'] ?? ''),
            'status'       => (string) ($body['status'] ?? 'pending'),
            'provider'     => $this->getName(),
        ]);
    }

    /**
     * @return array<string,mixed>
     */
    public function getEsimDetails(string $esimId): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Truphone provider is not configured');
        }

        $response = $this->get(self::BASE_URL . '/esims/' . rawurlencode($esimId), [], $this->headers());

        if ((int) $response['status'] !== 200) {
            return $this->failure((string) ($response['error'] ?? 'eSIM lookup failed'));
        }

        $esim = $response['body'] ?? [];

        return $this->success([
            'esim_id'      => (string) ($esim['id'] ?? $esimId),
            'iccid'        => (string) ($esim['iccid'] ?? ''),
            'lpa_code'     => (string) ($esim['activationCode'] ?? ''),
            'smdp_address' => (string) ($esim['smdpAddress'] ?? ''),
            'qr_code_url'  => (string) ($esim['qrCodeUrl'] ?? ''),
            'status'       => (string) ($esim['status'] ?? 'unknown'),
            'created_at'   => (string) ($esim['createdAt'] ?? ''),
            'activated_at' => (string) ($esim['activatedAt'] ?? ''),
            'expires_at'   => (string) ($esim['expiresAt'] ?? ''),
        ]);
    }

    public function getQrCodeData(string $esimId): string
    {
        $details = $this->getEsimDetails($esimId);

        if (!empty($details['lpa_code'])) {
            return (string) $details['lpa_code'];
        }

        // Build the standard LPA activation string when only parts are known.
        if (!empty($details['smdp_address'])) {
            return 'LPA:1$' . $details['smdp_address'] . '$' . ($details['matching_id'] ?? '');
        }

        return '';
    }

    /**
     * @return array<string,mixed>
     */
    public function checkUsage(string $esimId): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Truphone provider is not configured');
        }

        $response = $this->get(self::BASE_URL . '/esims/' . rawurlencode($esimId) . '/usage', [], $this->headers());

        if ((int) $response['status'] !== 200) {
            return $this->failure((string) ($response['error'] ?? 'Usage lookup failed'));
        }

        $usage = $response['body'] ?? [];
        $total = (float) ($usage['totalMb'] ?? ($usage['total'] ?? 0));
        $used = (float) ($usage['usedMb'] ?? ($usage['used'] ?? 0));

        return $this->success([
            'esim_id'         => $esimId,
            'total_data'      => $total,
            'used_data'       => $used,
            'remaining_data'  => max(0.0, $total - $used),
            'unit'            => 'MB',
            'percentage_used' => $total > 0 ? round(($used / $total) * 100, 2) : 0.0,
            'expiry_date'     => (string) ($usage['expiresAt'] ?? ''),
            'status'          => (string) ($usage['status'] ?? 'unknown'),
        ]);
    }

    /**
     * @return array<string,mixed>
     */
    public function topUp(string $esimId, string $planId): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Truphone provider is not configured');
        }

        $response = $this->post(self::BASE_URL . '/esims/' . rawurlencode($esimId) . '/top-ups', [
            'productId' => $planId,
        ], $this->headers());

        $status = (int) $response['status'];

        if ($status < 200 || $status >= 300) {
            return $this->failure((string) ($response['error'] ?? 'Top-up failed'), ['provider_status' => $status]);
        }

        $body = $response['body'] ?? [];
        $this->log('eSIM topped up', ['esim' => $esimId, 'plan' => $planId]);

        return $this->success([
            'topup_id' => (string) ($body['id'] ?? ''),
            'status'   => (string) ($body['status'] ?? 'pending'),
        ]);
    }

    /**
     * @return array<string,string>
     */
    private function headers(): array
    {
        return [
            'Authorization' => 'ApiKey ' . $this->cfg('api_key'),
            'Accept'        => 'application/json',
        ];
    }
}
