<?php
/**
 * Airalo provider - eSIM provisioning and data plans (Partner API v2).
 *
 * Supports both authentication styles Airalo issues to partners: a static API
 * token, or client_id/client_secret exchanged for a short-lived OAuth token
 * (cached in module settings until it expires).
 *
 * @package PhoneServices
 */

namespace PhoneServices\Providers;

use PhoneServices\Core\Config;
use PhoneServices\Interfaces\EsimProviderInterface;

class AiraloProvider extends AbstractProvider implements EsimProviderInterface
{
    const BASE_URL = 'https://partners-api.airalo.com/v2';
    const SANDBOX_URL = 'https://sandbox-partners-api.airalo.com/v2';

    /** @var string|null */
    private $bearerToken;

    public function getName(): string
    {
        return 'airalo';
    }

    public function getCapabilities(): array
    {
        return ['esim'];
    }

    public function isAvailable(): bool
    {
        return (string) $this->cfg('api_token') !== ''
            || ((string) $this->cfg('client_id') !== '' && (string) $this->cfg('client_secret') !== '');
    }

    public function testConnection(): bool
    {
        if (!$this->isAvailable()) {
            $this->lastError = 'Airalo credentials are not configured';
            return false;
        }

        $response = $this->get($this->url('/packages'), ['limit' => 1], $this->headers());

        return (int) $response['status'] === 200;
    }

    /* ==================================================================
     | Plans
     * ================================================================= */

    /**
     * @return array<int,array<string,mixed>>
     */
    public function getPlans(?string $country = null, ?string $region = null): array
    {
        if (!$this->isAvailable()) {
            return [];
        }

        $query = ['limit' => 100];

        if ($country) {
            $query['filter[country]'] = strtoupper($country);
        }
        if ($region) {
            $query['filter[type]'] = 'global';
            $query['filter[region]'] = strtolower($region);
        }

        $response = $this->get($this->url('/packages'), $query, $this->headers());

        if ((int) $response['status'] !== 200) {
            return [];
        }

        $plans = [];

        // The catalogue is nested: country -> operators -> packages.
        foreach ($response['body']['data'] ?? [] as $entry) {
            if (isset($entry['operators']) && is_array($entry['operators'])) {
                foreach ($entry['operators'] as $operator) {
                    foreach ($operator['packages'] ?? [] as $package) {
                        $plans[] = $this->normalisePlan($package, [
                            'country'  => $entry['country_code'] ?? ($entry['slug'] ?? ''),
                            'operator' => $operator['title'] ?? '',
                            'coverage' => $operator['countries'] ?? [],
                            'network'  => $operator['type'] ?? '',
                        ]);
                    }
                }
                continue;
            }

            $plans[] = $this->normalisePlan($entry, [
                'country'  => $entry['country_code'] ?? '',
                'operator' => $entry['operator']['title'] ?? '',
                'coverage' => $entry['countries'] ?? [],
                'network'  => $entry['operator']['type'] ?? '',
            ]);
        }

        $this->log('eSIM catalogue retrieved', ['count' => count($plans), 'country' => $country]);

        return $plans;
    }

    /**
     * @param array<string,mixed> $package
     * @param array<string,mixed> $context
     * @return array<string,mixed>
     */
    private function normalisePlan(array $package, array $context): array
    {
        return [
            'plan_id'      => (string) ($package['id'] ?? ''),
            'slug'         => (string) ($package['slug'] ?? ''),
            'name'         => (string) ($package['title'] ?? ($package['name'] ?? '')),
            'description'  => (string) ($package['short_info'] ?? ($package['description'] ?? '')),
            'data'         => (string) ($package['data'] ?? ($package['amount'] ?? '0')),
            'data_mb'      => self::toMegabytes((string) ($package['data'] ?? '')),
            'validity'     => (int) ($package['day'] ?? ($package['validity'] ?? 0)),
            'price'        => (float) ($package['price'] ?? 0),
            'currency'     => (string) ($package['currency'] ?? 'USD'),
            'country'      => strtoupper((string) $context['country']),
            'countries'    => $context['coverage'],
            'operator'     => $context['operator'],
            'network_type' => $context['network'] ?: '4G/LTE',
            'is_global'    => is_array($context['coverage']) && count($context['coverage']) > 1,
            'provider'     => $this->getName(),
        ];
    }

    /* ==================================================================
     | Provisioning
     * ================================================================= */

    /**
     * @param array<string,mixed> $options
     * @return array<string,mixed>
     */
    public function purchasePlan(string $planId, array $options = []): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Airalo provider is not configured');
        }

        $payload = [
            'package_id'  => $planId,
            'quantity'    => (int) ($options['quantity'] ?? 1),
            'type'        => 'sim',
            'description' => (string) ($options['description'] ?? 'WHMCS order'),
        ];

        if (!empty($options['email'])) {
            $payload['to_email'] = (string) $options['email'];
        }

        $response = $this->post($this->url('/orders'), $payload, $this->headers());
        $status = (int) $response['status'];

        if ($status < 200 || $status >= 300) {
            return $this->failure((string) ($response['error'] ?? 'eSIM order failed'), ['provider_status' => $status]);
        }

        $data = $response['body']['data'] ?? [];
        $sim = $data['sims'][0] ?? [];

        $this->log('eSIM ordered', ['plan' => $planId, 'order' => $data['id'] ?? '']);

        return $this->success([
            'order_id'     => (string) ($data['id'] ?? ''),
            'code'         => (string) ($data['code'] ?? ''),
            'esim_id'      => (string) ($sim['id'] ?? ''),
            'iccid'        => (string) ($sim['iccid'] ?? ''),
            'lpa_code'     => (string) ($sim['lpa'] ?? ''),
            'matching_id'  => (string) ($sim['matching_id'] ?? ''),
            'smdp_address' => (string) ($sim['apn_type'] ?? ($sim['qrcode'] ?? '')),
            'manual_code'  => (string) ($sim['manual_installation'] ?? ($sim['manualInstallation'] ?? '')),
            'qr_code_data' => (string) ($sim['qrcode'] ?? ''),
            'qr_code_url'  => (string) ($sim['qrcode_url'] ?? ''),
            'status'       => (string) ($data['status'] ?? 'pending'),
            'provider'     => $this->getName(),
        ]);
    }

    /**
     * @return array<string,mixed>
     */
    public function getEsimDetails(string $esimId): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Airalo provider is not configured');
        }

        $response = $this->get($this->url('/sims/' . rawurlencode($esimId)), [], $this->headers());

        if ((int) $response['status'] !== 200) {
            return $this->failure((string) ($response['error'] ?? 'eSIM lookup failed'));
        }

        $sim = $response['body']['data'] ?? [];

        return $this->success([
            'esim_id'      => (string) ($sim['id'] ?? $esimId),
            'iccid'        => (string) ($sim['iccid'] ?? ''),
            'lpa_code'     => (string) ($sim['lpa'] ?? ''),
            'qr_code_url'  => (string) ($sim['qrcode_url'] ?? ''),
            'status'       => (string) ($sim['status'] ?? 'unknown'),
            'package'      => $sim['simable'] ?? ($sim['package'] ?? []),
            'created_at'   => (string) ($sim['created_at'] ?? ''),
            'activated_at' => (string) ($sim['activated_at'] ?? ''),
            'expires_at'   => (string) ($sim['expired_at'] ?? ($sim['expires_at'] ?? '')),
        ]);
    }

    public function getQrCodeData(string $esimId): string
    {
        if (!$this->isAvailable()) {
            return '';
        }

        $response = $this->get($this->url('/sims/' . rawurlencode($esimId)), [], $this->headers());
        $sim = $response['body']['data'] ?? [];

        foreach (['qrcode', 'lpa'] as $key) {
            if (!empty($sim[$key])) {
                return (string) $sim[$key];
            }
        }

        return '';
    }

    /**
     * @return array<string,mixed>
     */
    public function checkUsage(string $esimId): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Airalo provider is not configured');
        }

        $response = $this->get($this->url('/sims/' . rawurlencode($esimId) . '/usage'), [], $this->headers());

        if ((int) $response['status'] !== 200) {
            return $this->failure((string) ($response['error'] ?? 'Usage lookup failed'));
        }

        $usage = $response['body']['data'] ?? [];
        $total = (float) ($usage['total'] ?? 0);
        $remaining = (float) ($usage['remaining'] ?? 0);

        return $this->success([
            'esim_id'         => $esimId,
            'total_data'      => $total,
            'used_data'       => max(0.0, $total - $remaining),
            'remaining_data'  => $remaining,
            'unit'            => 'MB',
            'percentage_used' => $total > 0 ? round((($total - $remaining) / $total) * 100, 2) : 0.0,
            'expiry_date'     => (string) ($usage['expired_at'] ?? ''),
            'status'          => (string) ($usage['status'] ?? 'unknown'),
        ]);
    }

    /**
     * @return array<string,mixed>
     */
    public function topUp(string $esimId, string $planId): array
    {
        if (!$this->isAvailable()) {
            return $this->failure('Airalo provider is not configured');
        }

        $response = $this->post($this->url('/orders/topups'), [
            'package_id' => $planId,
            'iccid'      => $esimId,
        ], $this->headers());

        $status = (int) $response['status'];

        if ($status < 200 || $status >= 300) {
            return $this->failure((string) ($response['error'] ?? 'Top-up failed'), ['provider_status' => $status]);
        }

        $data = $response['body']['data'] ?? [];
        $this->log('eSIM topped up', ['esim' => $esimId, 'plan' => $planId]);

        return $this->success([
            'topup_id' => (string) ($data['id'] ?? ''),
            'status'   => (string) ($data['status'] ?? 'pending'),
        ]);
    }

    /* ==================================================================
     | Internals
     * ================================================================= */

    private function url(string $path): string
    {
        return ($this->isSandbox() ? self::SANDBOX_URL : self::BASE_URL) . $path;
    }

    /**
     * @return array<string,string>
     */
    private function headers(): array
    {
        return [
            'Authorization' => 'Bearer ' . $this->token(),
            'Accept'        => 'application/json',
        ];
    }

    /**
     * Static token when provided, otherwise an OAuth client-credentials token
     * cached until shortly before it expires.
     */
    private function token(): string
    {
        $static = (string) $this->cfg('api_token');
        if ($static !== '') {
            return $static;
        }

        if ($this->bearerToken !== null) {
            return $this->bearerToken;
        }

        $cached = (string) Config::get('airalo_oauth_token', '');
        $expiry = (int) Config::get('airalo_oauth_expires', 0);

        if ($cached !== '' && $expiry > time() + 60) {
            return $this->bearerToken = $cached;
        }

        $response = $this->httpClient->postForm($this->url('/token'), [
            'client_id'     => (string) $this->cfg('client_id'),
            'client_secret' => (string) $this->cfg('client_secret'),
            'grant_type'    => 'client_credentials',
        ], ['Accept' => 'application/json']);

        $token = (string) ($response['body']['data']['access_token'] ?? '');

        if ($token === '') {
            $this->logError('OAuth token request', (string) ($response['error'] ?? 'No token returned'));
            return '';
        }

        $expiresIn = (int) ($response['body']['data']['expires_in'] ?? 3600);
        Config::set('airalo_oauth_token', $token);
        Config::set('airalo_oauth_expires', (string) (time() + $expiresIn));

        return $this->bearerToken = $token;
    }

    /**
     * "1 GB" / "500 MB" -> megabytes.
     */
    public static function toMegabytes(string $data): float
    {
        if ($data === '') {
            return 0.0;
        }

        if (!preg_match('/([0-9.]+)\s*(GB|MB|TB)?/i', $data, $matches)) {
            return 0.0;
        }

        $value = (float) $matches[1];

        switch (strtoupper($matches[2] ?? 'MB')) {
            case 'TB':
                return $value * 1024 * 1024;
            case 'GB':
                return $value * 1024;
            default:
                return $value;
        }
    }
}
