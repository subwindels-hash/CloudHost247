<?php
namespace CloudHost247\NetworkTools\Services;

use CloudHost247\NetworkTools\Core\Http\HttpFetcher;
use CloudHost247\NetworkTools\Core\Integration\ProviderBridge;
use CloudHost247\NetworkTools\Core\Registry\ToolDefinition;
use CloudHost247\NetworkTools\Core\Repository\ProviderRepository;
use CloudHost247\NetworkTools\Core\Repository\ResolverRepository;
use CloudHost247\NetworkTools\Core\Result\ErrorCode;
use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\ResolverPool;
use CloudHost247\NetworkTools\Dns\DnsClient;
use InvalidArgumentException;

/**
 * Base class for every tool service.
 *
 * Provides the three things a service needs (settings, the resolver pool and
 * the provider bridge), converts an InvalidArgumentException — the only
 * exception a validator is allowed to raise — into the standard INVALID_INPUT
 * envelope, and turns any other failure into a SERVICE_UNAVAILABLE envelope
 * with a correlation id, so a service can never leak an internal error to a
 * browser or invent a result to hide one.
 */
abstract class Service
{
    /** @var array */
    protected $input = array();
    /** @var array */
    protected $context = array();

    final public function run(array $input, array $context)
    {
        $this->input = is_array($input) ? $input : array();
        $this->context = is_array($context) ? $context : array();
        try {
            return $this->execute();
        } catch (InvalidArgumentException $invalid) {
            return ToolResult::invalid($invalid->getMessage());
        } catch (\Throwable $failure) {
            return $this->unexpected($failure);
        }
    }

    /** @return ToolResult */
    abstract protected function execute();

    protected function setting($key, $default = null)
    {
        $settings = isset($this->context['settings']) && is_array($this->context['settings']) ? $this->context['settings'] : array();
        return array_key_exists($key, $settings) ? $settings[$key] : $default;
    }

    protected function intSetting($key, $default = 0)
    {
        return (int) $this->setting($key, $default);
    }

    /** The signed-in customer id for this request (0 for a guest or API call). */
    protected function clientId()
    {
        return isset($this->context['client_id']) ? (int) $this->context['client_id'] : 0;
    }

    /** The acting administrator id for this request (0 when not an admin). */
    protected function adminId()
    {
        return isset($this->context['admin_id']) ? (int) $this->context['admin_id'] : 0;
    }

    /** guest | customer | admin | api */
    protected function actor()
    {
        return isset($this->context['actor']) ? (string) $this->context['actor'] : 'guest';
    }

    protected function tool()
    {
        return isset($this->context['tool']) && $this->context['tool'] instanceof ToolDefinition ? $this->context['tool'] : null;
    }

    protected function pool()
    {
        return new ResolverPool(new ResolverRepository(), array(
            'dns_timeout_seconds' => $this->intSetting('dns_timeout_seconds', 5),
            'dns_retries' => $this->intSetting('dns_retries', 2),
            'propagation_resolver_limit' => $this->intSetting('propagation_resolver_limit', 40),
        ));
    }

    protected function provider()
    {
        if (isset($this->context['providers']) && $this->context['providers'] instanceof ProviderBridge) {
            return $this->context['providers'];
        }
        return new ProviderBridge(new ProviderRepository());
    }

    protected function fetcher($maxRedirects = 3, array $policy = array())
    {
        return new HttpFetcher($policy, $maxRedirects);
    }

    /** A resolver chosen by id/name, or the default resolver when empty. */
    protected function clientForRequest($value)
    {
        $value = trim((string) $value);
        $pool = $this->pool();
        if ($value === '' || $value === '0' || $value === 'default') {
            return $pool->defaultClient();
        }
        $repository = new ResolverRepository();
        if (ctype_digit($value)) {
            $row = $repository->find((int) $value);
            if ($row && (int) $row->enabled === 1) {
                return $pool->clientFor($row);
            }
            throw new InvalidArgumentException('That resolver is not in the registry or has been disabled.');
        }
        foreach ($repository->all(true) as $row) {
            if (strcasecmp((string) $row->name, $value) === 0) {
                return $pool->clientFor($row);
            }
        }
        throw new InvalidArgumentException('That resolver is not registered.');
    }

    /** Query the system resolver for one type, returning the raw response. */
    protected function querySystem($name, $type)
    {
        return $this->pool()->systemClient(array('retries' => max(1, $this->intSetting('dns_retries', 2))))->query($name, $type);
    }

    protected function unexpected(\Throwable $failure)
    {
        $correlation = '';
        if (class_exists('CloudHost247\\Foundation\\Support\\SafeError')) {
            $safe = \CloudHost247\Foundation\Support\SafeError::from($failure, 'cloudhost247_network_tools', 'service.failed', 'That tool could not complete.');
            $correlation = isset($safe['correlation_id']) ? (string) $safe['correlation_id'] : '';
        }
        $result = ToolResult::failure(ErrorCode::SERVICE_UNAVAILABLE, 'That tool could not complete. Please try again shortly.');
        return $result->withMeta(array('correlation_id' => $correlation, 'error_class' => get_class($failure)));
    }

    protected function dnsFailure(array $response, $label)
    {
        $code = ErrorCode::isValid($response['code']) ? $response['code'] : ErrorCode::DNS_LOOKUP_FAILED;
        if ($code === ErrorCode::DNS_LOOKUP_FAILED && isset($response['rcode']) && (int) $response['rcode'] === 3) {
            $code = ErrorCode::DOMAIN_NOT_FOUND;
        }
        return ToolResult::failure($code, $label . ': ' . (isset($response['error']) && $response['error'] !== '' ? $response['error'] : 'no answer.'));
    }

    /** Flatten a DNS response's records into the row shape the UI renders. */
    protected function recordRows(array $response, array $extra = array())
    {
        $rows = array();
        foreach ((array) $response['records'] as $record) {
            $rows[] = array_merge(array(
                'name' => $record['name'],
                'type' => $record['type'],
                'ttl' => isset($record['ttl']) ? (int) $record['ttl'] : null,
                'value' => isset($record['value']) ? $record['value'] : '',
                'priority' => isset($record['priority']) ? $record['priority'] : null,
            ), array_intersect_key($record, array_flip(array('target', 'key_tag', 'algorithm', 'digest_type', 'digest', 'flags', 'protocol', 'public_key', 'tag', 'caa_tag', 'caa_value', 'serial', 'primary', 'responsible', 'weight', 'port'))), $extra);
        }
        return $rows;
    }

    protected function meta(array $response, array $extra = array())
    {
        return array_merge(array(
            'resolver' => isset($response['resolver']) && $response['resolver'] !== '' ? $response['resolver'] : 'system resolver',
            'protocol' => isset($response['protocol']) ? $response['protocol'] : 'udp',
            'latency_ms' => isset($response['latency_ms']) ? (int) $response['latency_ms'] : null,
            'authenticated' => !empty($response['authenticated']),
        ), $extra);
    }
}
