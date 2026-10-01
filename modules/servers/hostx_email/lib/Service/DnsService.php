<?php
/**
 * DNS record retrieval, persistence and (optional) verification.
 *
 * Two hard rules:
 *   1. Records are only ever stored if a provider returned them or an
 *      administrator configured them. No MX hostname, priority, DKIM selector
 *      or verification token is ever synthesised by this module.
 *   2. "Verified" is only reported when the provider says so, or when a real
 *      DNS lookup confirms the published record matches the required value.
 *      Otherwise the state is "unknown" and the UI says so.
 *
 * The module never writes to a customer's DNS zone.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Service;

use CloudHost247\Email\Dns\RecordSet;
use CloudHost247\Email\Providers\ProviderFactory;
use CloudHost247\Email\Providers\ProviderInterface;
use CloudHost247\Email\Repository\AccountRepository;
use CloudHost247\Email\Support\Config;
use CloudHost247\Email\Support\Logger;
use CloudHost247\Email\Support\Result;
use CloudHost247\Email\Support\Validator;
use WHMCS\Database\Capsule;

final class DnsService
{
    const TABLE = 'mod_hostx_email_dns';

    const STATE_UNKNOWN      = 'unknown';
    const STATE_PENDING      = 'pending';
    const STATE_VERIFIED     = 'verified';
    const STATE_UNAVAILABLE  = 'unavailable';

    /** @var Config */
    private $config;

    /** @var ProviderInterface */
    private $provider;

    public function __construct(Config $config, ?ProviderInterface $provider = null)
    {
        $this->config = $config;
        $this->provider = $provider ?: ProviderFactory::make($config);
    }

    /**
     * Fetch the provider's records and store them against the service.
     *
     * @return array<string,mixed> Result; data.records (RecordSet), data.state
     */
    public function refresh(int $serviceId, string $domain): array
    {
        $domain = Validator::normaliseDomain($domain);

        if ($serviceId <= 0 || !Validator::isDomain($domain)) {
            return Result::fail(Result::CODE_VALIDATION, 'A service and a valid domain are required.');
        }

        $capabilities = $this->provider->capabilities();

        if (empty($capabilities['dns'])) {
            $this->setState($serviceId, self::STATE_UNAVAILABLE);

            return Result::fail(
                Result::CODE_NOT_SUPPORTED,
                sprintf('%s does not publish DNS records through its API.', $this->provider->label())
            );
        }

        $result = $this->provider->dnsRecords($domain);

        if (!Result::isOk($result)) {
            $this->setState($serviceId, self::STATE_UNAVAILABLE);

            return $result;
        }

        /** @var RecordSet $records */
        $records = $result['data']['records'];
        $verified = $result['data']['verified'];

        $this->store($serviceId, $domain, $records);

        $state = $verified === true
            ? self::STATE_VERIFIED
            : ($records->isEmpty() ? self::STATE_UNAVAILABLE : self::STATE_PENDING);

        $this->setState($serviceId, $state);

        Logger::info('dns.refreshed', [
            'service_id' => $serviceId,
            'provider'   => $this->provider->key(),
            'records'    => $records->count(),
            'state'      => $state,
        ]);

        return Result::ok(['records' => $records, 'state' => $state, 'verified' => $verified]);
    }

    /**
     * Records previously stored for a service (no provider call - safe to use
     * during page rendering).
     */
    public function stored(int $serviceId): RecordSet
    {
        try {
            $rows = Capsule::table(self::TABLE)
                ->where('service_id', $serviceId)
                ->orderByRaw("FIELD(purpose,'verification','mail','spf','dkim','dmarc','other')")
                ->orderBy('id')
                ->get();
        } catch (\Throwable $e) {
            return new RecordSet(RecordSet::SOURCE_PROVIDER, null);
        }

        $records = [];
        $source = RecordSet::SOURCE_PROVIDER;
        $verified = null;

        foreach ($rows as $row) {
            $records[] = [
                'type'     => $row->record_type,
                'host'     => $row->host,
                'value'    => $row->value,
                'priority' => $row->priority,
                'ttl'      => $row->ttl,
                'purpose'  => $row->purpose,
            ];

            $source = (string) $row->source;

            if ($row->is_verified !== null) {
                $verified = (bool) $row->is_verified;
            }
        }

        return RecordSet::fromRows($records, $source, $verified);
    }

    /**
     * Replace the stored record set for a service.
     */
    public function store(int $serviceId, string $domain, RecordSet $records): void
    {
        try {
            Capsule::connection()->transaction(function () use ($serviceId, $domain, $records) {
                Capsule::table(self::TABLE)->where('service_id', $serviceId)->delete();

                foreach ($records->all() as $record) {
                    Capsule::table(self::TABLE)->insert([
                        'service_id'  => $serviceId,
                        'domain'      => $domain,
                        'record_type' => $record['type'],
                        'host'        => $record['host'],
                        'value'       => $record['value'],
                        'priority'    => $record['priority'],
                        'ttl'         => $record['ttl'],
                        'purpose'     => $record['purpose'],
                        'source'      => $record['source'],
                        'is_verified' => $records->verified() === null ? null : (int) $records->verified(),
                        'updated_at'  => date('Y-m-d H:i:s'),
                    ]);
                }
            });
        } catch (\Throwable $e) {
            Logger::error('dns.store_failed', ['service_id' => $serviceId, 'error' => $e->getMessage()]);
        }
    }

    /**
     * Independent verification by resolving the zone.
     *
     * Only the records the provider requires are checked, and only MX/TXT/CNAME
     * are resolvable this way. A pass here means the published zone really does
     * contain the required values - it is not a claim made by the module.
     *
     * @return array<string,mixed> Result; data.checks[]
     */
    public function verifyPublished(int $serviceId): array
    {
        $records = $this->stored($serviceId);

        if ($records->isEmpty()) {
            return Result::fail(Result::CODE_NOT_FOUND, 'No DNS records are stored for this service yet.');
        }

        if (!function_exists('dns_get_record')) {
            return Result::fail(Result::CODE_NOT_SUPPORTED, 'DNS lookups are not available on this server.');
        }

        $account = AccountRepository::find($serviceId);
        $domain = $account ? (string) $account->domain : '';

        if (!Validator::isDomain($domain)) {
            return Result::fail(Result::CODE_VALIDATION, 'The service has no valid domain.');
        }

        $checks = [];
        $allMatched = true;

        foreach ($records->all() as $record) {
            $match = $this->lookupMatches($domain, $record);
            $checks[] = [
                'type'    => $record['type'],
                'host'    => $record['host'],
                'matched' => $match,
            ];

            if ($match !== true) {
                $allMatched = false;
            }
        }

        $state = $allMatched ? self::STATE_VERIFIED : self::STATE_PENDING;
        $this->setState($serviceId, $state);

        try {
            Capsule::table(self::TABLE)
                ->where('service_id', $serviceId)
                ->update(['is_verified' => (int) $allMatched, 'updated_at' => date('Y-m-d H:i:s')]);
        } catch (\Throwable $e) {
            Logger::debug('dns.verify_persist_failed', ['service_id' => $serviceId, 'error' => $e->getMessage()]);
        }

        return Result::ok(['checks' => $checks, 'state' => $state, 'verified' => $allMatched]);
    }

    /**
     * Resolve one record and compare it with the required value.
     *
     * @param  array<string,mixed> $record
     * @return bool|null null = could not be checked
     */
    private function lookupMatches(string $domain, array $record)
    {
        $host = (string) $record['host'];
        $name = ($host === '' || $host === '@') ? $domain : $host . '.' . $domain;
        $expected = strtolower(trim((string) $record['value']));

        try {
            switch (strtoupper((string) $record['type'])) {
                case 'MX':
                    $rows = @dns_get_record($name, DNS_MX) ?: [];

                    foreach ($rows as $row) {
                        if (strtolower(rtrim((string) ($row['target'] ?? ''), '.')) === rtrim($expected, '.')) {
                            return true;
                        }
                    }

                    return false;

                case 'TXT':
                    $rows = @dns_get_record($name, DNS_TXT) ?: [];

                    foreach ($rows as $row) {
                        $text = strtolower((string) ($row['txt'] ?? ''));

                        if ($text === $expected || strpos($text, $expected) !== false) {
                            return true;
                        }
                    }

                    return false;

                case 'CNAME':
                    $rows = @dns_get_record($name, DNS_CNAME) ?: [];

                    foreach ($rows as $row) {
                        if (strtolower(rtrim((string) ($row['target'] ?? ''), '.')) === rtrim($expected, '.')) {
                            return true;
                        }
                    }

                    return false;

                default:
                    return null;
            }
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function setState(int $serviceId, string $state): void
    {
        AccountRepository::update($serviceId, [
            'dns_state'      => $state,
            'dns_checked_at' => date('Y-m-d H:i:s'),
        ]);
    }

    /**
     * Human label for a DNS state.
     */
    public static function stateLabel(string $state): string
    {
        $labels = [
            self::STATE_VERIFIED    => 'Verified by the provider',
            self::STATE_PENDING     => 'Awaiting DNS propagation / verification',
            self::STATE_UNAVAILABLE => 'Not reported by the provider',
            self::STATE_UNKNOWN     => 'Not checked yet',
        ];

        return $labels[$state] ?? 'Not checked yet';
    }
}
