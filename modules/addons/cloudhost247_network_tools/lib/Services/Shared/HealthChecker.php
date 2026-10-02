<?php
namespace CloudHost247\NetworkTools\Services\Shared;

use CloudHost247\NetworkTools\Core\Repository\HealthRepository;
use CloudHost247\NetworkTools\Core\Repository\ProviderRepository;
use CloudHost247\NetworkTools\Core\Repository\ResolverRepository;
use CloudHost247\NetworkTools\Core\Repository\SettingsRepository;
use CloudHost247\NetworkTools\Core\Integration\ProviderBridge;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Dns\ResolverPool;

/**
 * Resolver and provider health (docs sections 71, 72).
 *
 * Runs the real check — a DNS query for a well-known name through each enabled
 * resolver, and the provider's own connection test — and records the measured
 * latency or the error. A subject that cannot be checked is recorded as
 * UNKNOWN, never as healthy. Called by the WHMCS cron and from the control
 * centre.
 */
final class HealthChecker
{
    /** @var ResolverRepository */
    private $resolvers;
    /** @var ProviderRepository */
    private $providers;
    /** @var SettingsRepository */
    private $settings;
    /** @var HealthRepository */
    private $health;

    public function __construct(ResolverRepository $resolvers = null, ProviderRepository $providers = null, SettingsRepository $settings = null, HealthRepository $health = null)
    {
        $this->resolvers = $resolvers ?: new ResolverRepository();
        $this->providers = $providers ?: new ProviderRepository();
        $this->settings = $settings ?: new SettingsRepository();
        $this->health = $health ?: new HealthRepository();
    }

    /**
     * @param bool $resolversOnly provider checks can be slow; the cron splits them.
     * @return array{checked:int,healthy:int,failed:int,unknown:int,subjects:array}
     */
    public function run($resolversOnly = false, $providersOnly = false)
    {
        $checked = 0;
        $healthy = 0;
        $failed = 0;
        $unknown = 0;
        $subjects = array();
        $pool = new ResolverPool($this->resolvers, array(
            'dns_timeout_seconds' => max(2, $this->settings->int('dns_timeout_seconds', 5)),
            'dns_retries' => 1,
        ));
        foreach (($providersOnly ? array() : $this->resolvers->all(true)) as $row) {
            $checked++;
            $started = microtime(true);
            try {
                $client = $pool->clientFor($row);
                $response = $client->query('example.com', 'A');
                $latency = (int) round((microtime(true) - $started) * 1000);
                if ($response['ok'] && DnsClient::values($response['records'], 'A')) {
                    $healthy++;
                    $this->resolvers->recordHealth((int) $row->id, 'HEALTHY', $latency, '');
                    $this->health->record('resolver', (string) $row->name, 'AVAILABLE', $latency, 'Answered an A query for example.com.');
                    $subjects[] = array('subject' => $row->name, 'status' => 'HEALTHY', 'latency_ms' => $latency, 'detail' => '');
                } else {
                    $failed++;
                    $detail = isset($response['error']) && $response['error'] !== '' ? $response['error'] : 'No answer for example.com A.';
                    $this->resolvers->recordHealth((int) $row->id, 'FAILED', $latency, substr((string) $detail, 0, 255));
                    $this->health->record('resolver', (string) $row->name, 'FAILED', $latency, substr((string) $detail, 0, 500));
                    $subjects[] = array('subject' => $row->name, 'status' => 'FAILED', 'latency_ms' => $latency, 'detail' => $detail);
                }
            } catch (\Throwable $failure) {
                $failed++;
                $this->resolvers->recordHealth((int) $row->id, 'FAILED', null, 'The resolver could not be reached with the configured protocol.');
                $this->health->record('resolver', (string) $row->name, 'FAILED', null, 'The resolver could not be reached with the configured protocol.');
                $subjects[] = array('subject' => $row->name, 'status' => 'FAILED', 'latency_ms' => null, 'detail' => 'The resolver could not be reached with the configured protocol.');
            }
        }
        if ($resolversOnly && !$providersOnly) {
            return array('checked' => $checked, 'healthy' => $healthy, 'failed' => $failed, 'unknown' => $unknown, 'subjects' => $subjects);
        }
        $bridge = new ProviderBridge($this->providers);
        foreach ($this->providers->all(true) as $provider) {
            $checked++;
            $type = (string) $provider->type;
            $key = (string) $provider->provider_key;
            if ($type === 'dnsbl') {
                $zone = (string) $provider->endpoint;
                if ($zone === '') {
                    $unknown++;
                    $this->health->record('provider', $key, 'UNKNOWN', null, 'The DNSBL provider has no zone configured.');
                    continue;
                }
                $started = microtime(true);
                $client = $pool->defaultClient();
                $probe = $client->query('2.0.0.127.' . $zone, 'A');
                $latency = (int) round((microtime(true) - $started) * 1000);
                $reachable = $probe['ok'] || (isset($probe['error']) && stripos((string) $probe['error'], 'nxdomain') !== false);
                if ($reachable) {
                    $healthy++;
                    $this->providers->recordHealth((int) $provider->id, 'HEALTHY', 'The zone answered.');
                    $this->health->record('provider', $key, 'AVAILABLE', $latency, 'The zone resolved through the default resolver.');
                    $subjects[] = array('subject' => $key, 'status' => 'HEALTHY', 'latency_ms' => $latency, 'detail' => '');
                } else {
                    $failed++;
                    $detail = 'The zone did not answer through the default resolver. Public blocklists frequently refuse shared resolvers; check the provider policy before treating this as an outage.';
                    $this->providers->recordHealth((int) $provider->id, 'FAILED', $detail);
                    $this->health->record('provider', $key, 'FAILED', $latency, $detail);
                    $subjects[] = array('subject' => $key, 'status' => 'FAILED', 'latency_ms' => $latency, 'detail' => $detail);
                }
                continue;
            }
            if (!in_array($type, array('integration', 'http'), true)) {
                $unknown++;
                $this->health->record('provider', $key, 'UNKNOWN', null, 'No health check is defined for this provider type.');
                continue;
            }
            if (!$bridge->installed()) {
                $unknown++;
                $this->health->record('provider', $key, 'UNKNOWN', null, 'The API & Integrations centre is not installed, so no connection test can run.');
                continue;
            }
            try {
                $started = microtime(true);
                $available = $bridge->available($key);
                $latency = (int) round((microtime(true) - $started) * 1000);
                if ($available) {
                    $healthy++;
                    $this->providers->recordHealth((int) $provider->id, 'HEALTHY', 'Configured and enabled.');
                    $this->health->record('provider', $key, 'AVAILABLE', $latency, 'Configured and enabled in the integrations centre.');
                    $subjects[] = array('subject' => $key, 'status' => 'HEALTHY', 'latency_ms' => $latency, 'detail' => '');
                } else {
                    $failed++;
                    $detail = 'No enabled configuration exists for this provider.';
                    $this->providers->recordHealth((int) $provider->id, 'CONFIGURATION_REQUIRED', $detail);
                    $this->health->record('provider', $key, 'CONFIGURATION_REQUIRED', $latency, $detail);
                    $subjects[] = array('subject' => $key, 'status' => 'CONFIGURATION_REQUIRED', 'latency_ms' => $latency, 'detail' => $detail);
                }
            } catch (\Throwable $failure) {
                $failed++;
                $this->providers->recordHealth((int) $provider->id, 'FAILED', 'The health probe could not run.');
                $this->health->record('provider', $key, 'FAILED', null, 'The health probe could not run.');
                $subjects[] = array('subject' => $key, 'status' => 'FAILED', 'latency_ms' => null, 'detail' => 'The health probe could not run.');
            }
        }
        return array('checked' => $checked, 'healthy' => $healthy, 'failed' => $failed, 'unknown' => $unknown, 'subjects' => $subjects);
    }
}
