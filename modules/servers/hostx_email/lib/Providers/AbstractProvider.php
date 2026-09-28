<?php
/**
 * Shared provider plumbing: HTTP, error mapping, uncertainty detection.
 *
 * The single most important behaviour here is classifying a failed call:
 *
 *   connection refused / DNS failure        -> failed   (nothing happened, safe to retry)
 *   timeout after the request was written   -> UNCERTAIN (reconcile, never retry)
 *   HTTP 5xx / 429                          -> failed   (retryable)
 *   HTTP 4xx                                -> failed   (permanent, mapped to a code)
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Providers;

use HostxEmail\Dns\RecordSet;
use HostxEmail\Support\Config;
use HostxEmail\Support\CurlClient;
use HostxEmail\Support\HttpClient;
use HostxEmail\Support\Logger;
use HostxEmail\Support\Redactor;
use HostxEmail\Support\Result;

abstract class AbstractProvider implements ProviderInterface
{
    /** @var Config */
    protected $config;

    /** @var HttpClient */
    protected $http;

    /** @var int */
    protected $timeout = 20;

    public function __construct(Config $config, ?HttpClient $http = null)
    {
        $this->config = $config;
        $this->http = $http ?: new CurlClient();
    }

    /**
     * Default capability matrix: adapters override what they really support.
     *
     * @return array<string,bool>
     */
    public function capabilities(): array
    {
        return [
            'create'          => false,
            'suspend'         => false,
            'unsuspend'       => false,
            'terminate'       => false,
            'change_password' => false,
            'assign_license'  => false,
            'remove_license'  => false,
            'status'          => false,
            'usage'           => false,
            'dns'             => false,
            'plans'           => false,
            'find_by_email'   => false,
        ];
    }

    public function supports(string $capability): bool
    {
        $capabilities = $this->capabilities();

        return !empty($capabilities[$capability]);
    }

    public function supportsWebhooks(): bool
    {
        return false;
    }

    /**
     * Standard "this provider cannot do that" answer.
     *
     * @return array<string,mixed>
     */
    protected function unsupported(string $capability): array
    {
        return Result::fail(
            Result::CODE_NOT_SUPPORTED,
            sprintf('%s does not support %s through its public API.', $this->label(), str_replace('_', ' ', $capability))
        );
    }

    /* ------------------------------------------------------------------
     | HTTP
     * ----------------------------------------------------------------- */

    /**
     * Perform a JSON API call.
     *
     * @param  array<string,string>     $headers
     * @param  array<string,mixed>|null $json
     * @param  bool                     $mutating whether a timeout implies the
     *                                            remote side may have applied it
     * @return array<string,mixed>      Result envelope; data.body holds decoded JSON
     */
    protected function call(string $method, string $url, array $headers = [], ?array $json = null, bool $mutating = false, string $event = ''): array
    {
        $body = $json === null ? null : (string) json_encode($json);

        $headers = array_merge([
            'Accept'       => 'application/json',
            'Content-Type' => 'application/json',
        ], $headers);

        $response = $this->http->request($method, $url, $headers, $body, $this->timeout);

        $event = $event !== '' ? $event : strtolower($this->key() . '.' . $method);

        Logger::moduleCall($event, [
            'method'  => $method,
            'url'     => $url,
            'headers' => Redactor::headers($headers),
            'body'    => $json === null ? null : Redactor::redact($json),
        ], [
            'status' => $response['status'],
            'body'   => Redactor::json((string) $response['body'], 2000),
            'error'  => $response['error'],
        ]);

        // Transport failure.
        if ((int) $response['status'] === 0) {
            if ($mutating && !empty($response['timed_out'])) {
                return Result::uncertain(
                    sprintf(
                        '%s did not respond before the timeout. The change may have been applied remotely; '
                        . 'the service has been queued for reconciliation instead of being retried.',
                        $this->label()
                    ),
                    ['url' => $url]
                );
            }

            return Result::fail(
                Result::CODE_TRANSPORT,
                sprintf('Could not reach %s: %s', $this->label(), $response['error'] ?: 'connection failed'),
                ['url' => $url]
            );
        }

        $decoded = json_decode((string) $response['body'], true);
        $decoded = is_array($decoded) ? $decoded : [];

        $status = (int) $response['status'];

        if ($status >= 200 && $status < 300) {
            return Result::ok(['status' => $status, 'body' => $decoded, 'raw' => (string) $response['body']]);
        }

        return Result::fail(
            self::mapStatus($status),
            $this->remoteMessage($decoded, $status),
            ['status' => $status, 'body' => $decoded]
        );
    }

    /**
     * Map an HTTP status onto a Result code.
     *
     * Pure helper (unit tested).
     */
    public static function mapStatus(int $status): string
    {
        if ($status === 401) {
            return Result::CODE_PERMISSION;
        }

        if ($status === 403) {
            return Result::CODE_PERMISSION;
        }

        if ($status === 404) {
            return Result::CODE_NOT_FOUND;
        }

        if ($status === 409) {
            return Result::CODE_CONFLICT;
        }

        if ($status === 422 || $status === 400) {
            return Result::CODE_VALIDATION;
        }

        if ($status === 429) {
            return Result::CODE_RATE_LIMIT;
        }

        if ($status >= 500) {
            return Result::CODE_REMOTE;
        }

        return Result::CODE_REMOTE;
    }

    /**
     * Extract a safe, human-readable message from a provider error body.
     *
     * @param array<string,mixed> $body
     */
    protected function remoteMessage(array $body, int $status): string
    {
        $candidates = [
            $body['error']['message'] ?? null,
            $body['error_description'] ?? null,
            $body['message'] ?? null,
            is_string($body['error'] ?? null) ? $body['error'] : null,
            $body['error']['errors'][0]['message'] ?? null,
        ];

        foreach ($candidates as $candidate) {
            if (is_string($candidate) && $candidate !== '') {
                return sprintf('%s returned HTTP %d: %s', $this->label(), $status, Redactor::scrub(substr($candidate, 0, 300)));
            }
        }

        return sprintf('%s returned HTTP %d.', $this->label(), $status);
    }

    /* ------------------------------------------------------------------
     | Defaults for optional capabilities
     * ----------------------------------------------------------------- */

    /**
     * @param array<string,mixed> $account
     */
    public function assignLicense(array $account, string $sku): array
    {
        return $this->unsupported('assign_license');
    }

    /**
     * @param array<string,mixed> $account
     */
    public function removeLicense(array $account, string $sku): array
    {
        return $this->unsupported('remove_license');
    }

    public function listPlans(): array
    {
        return $this->unsupported('plans');
    }

    public function findByEmail(string $email): array
    {
        return $this->unsupported('find_by_email');
    }

    public function checkAvailability(string $sku): array
    {
        // Providers without a licensing API cannot be checked; that is not an
        // error, but it is explicitly reported as "unknown".
        return Result::ok(['checked' => false, 'available' => null], 'Seat availability is not reported by this provider.');
    }

    /**
     * Administrator-configured DNS records, used by providers whose API does
     * not publish them. Values come from the server "Access hash" JSON field:
     *
     *   {"dns": {"example.com": [{"type":"MX","host":"@","value":"...","priority":1}]}}
     *   {"dns": {"*": [ ... ]}}   // applies to every domain on the server
     *
     * Nothing is invented: if the operator has not configured records, the set
     * is empty and the UI tells the customer to follow the provider console.
     */
    protected function configuredDnsRecords(string $domain): RecordSet
    {
        $set = new RecordSet(RecordSet::SOURCE_CONFIG, null);

        $raw = $this->config->serverAccessHash();

        if ($raw === '' || strpos($raw, '{') === false) {
            return $set;
        }

        $decoded = json_decode($raw, true);

        if (!is_array($decoded) || empty($decoded['dns']) || !is_array($decoded['dns'])) {
            return $set;
        }

        $candidates = [];

        if (isset($decoded['dns'][$domain]) && is_array($decoded['dns'][$domain])) {
            $candidates = $decoded['dns'][$domain];
        } elseif (isset($decoded['dns']['*']) && is_array($decoded['dns']['*'])) {
            $candidates = $decoded['dns']['*'];
        }

        foreach ($candidates as $record) {
            if (!is_array($record)) {
                continue;
            }

            $type = (string) ($record['type'] ?? '');
            $host = (string) ($record['host'] ?? '@');
            $value = str_replace('{domain}', $domain, (string) ($record['value'] ?? ''));

            $set->add(
                $type,
                str_replace('{domain}', $domain, $host),
                $value,
                isset($record['priority']) ? (int) $record['priority'] : null,
                isset($record['ttl']) ? (int) $record['ttl'] : null,
                RecordSet::classify($type, $host, $value)
            );
        }

        return $set;
    }

    /**
     * Non-secret configuration from the access-hash JSON blob.
     *
     * @return array<string,mixed>
     */
    protected function accessHashJson(): array
    {
        $raw = $this->config->serverAccessHash();

        if ($raw === '' || strpos($raw, '{') === false) {
            return [];
        }

        $decoded = json_decode($raw, true);

        return is_array($decoded) ? $decoded : [];
    }
}
