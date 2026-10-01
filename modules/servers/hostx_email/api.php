<?php
/**
 * CloudHost247 Email Hosting - provider API surface.
 *
 * Thin, dependency-free helpers that expose the provider adapters to the rest
 * of the module (connection testing, plan discovery, DNS retrieval, capability
 * reporting). All real HTTP work lives in lib/Providers/*.
 *
 * This file contains no endpoint of its own: it is included by the WHMCS module
 * and by the CLI tools. The public HTTP surface is webhook.php only.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/bootstrap.php';

use CloudHost247\Email\Providers\ProviderFactory;
use CloudHost247\Email\Providers\ProviderInterface;
use CloudHost247\Email\Service\DnsService;
use CloudHost247\Email\Support\Config;
use CloudHost247\Email\Support\HttpClient;
use CloudHost247\Email\Support\Logger;
use CloudHost247\Email\Support\Result;

/**
 * Build the provider adapter for a set of WHMCS params.
 *
 * @param array<string,mixed> $params
 */
function hostx_email_provider(array $params, ?HttpClient $http = null): ProviderInterface
{
    return ProviderFactory::make(new Config($params), $http);
}

/**
 * WHMCS "Test connection" implementation.
 *
 * Returns the WHMCS-expected shape: ['success' => bool, 'error' => string].
 *
 * @param  array<string,mixed> $params
 * @return array<string,mixed>
 */
function hostx_email_test_connection(array $params, ?HttpClient $http = null)
{
    $config = new Config($params);

    try {
        $provider = ProviderFactory::make($config, $http);

        $configured = $provider->validateConfiguration();

        if (!Result::isOk($configured)) {
            return ['success' => false, 'error' => (string) $configured['message']];
        }

        $result = $provider->testConnection();

        Logger::info('test_connection', [
            'provider' => $provider->key(),
            'success'  => Result::isOk($result),
            'code'     => (string) ($result['code'] ?? ''),
        ]);

        if (!Result::isOk($result)) {
            return ['success' => false, 'error' => (string) $result['message']];
        }

        return ['success' => true, 'error' => ''];
    } catch (\Throwable $e) {
        Logger::error('test_connection.exception', ['error' => $e->getMessage()]);

        return [
            'success' => false,
            'error'   => 'The connection test failed unexpectedly. Reference: ' . Logger::correlationId(),
        ];
    }
}

/**
 * Plans/SKUs the configured tenant actually exposes - used when mapping a WHMCS
 * product to a provider SKU.
 *
 * @param  array<string,mixed> $params
 * @return array<string,mixed> Result envelope
 */
function hostx_email_list_plans(array $params, ?HttpClient $http = null)
{
    try {
        $provider = hostx_email_provider($params, $http);

        if (empty($provider->capabilities()['plans'])) {
            return Result::fail(
                Result::CODE_NOT_SUPPORTED,
                sprintf('%s does not expose a plan catalogue through its API.', $provider->label())
            );
        }

        return $provider->listPlans();
    } catch (\Throwable $e) {
        Logger::error('list_plans.exception', ['error' => $e->getMessage()]);

        return Result::fail(Result::CODE_REMOTE, 'Could not read the provider plan list.');
    }
}

/**
 * Confirm a SKU exists and has a free seat.
 *
 * @param  array<string,mixed> $params
 * @return array<string,mixed>
 */
function hostx_email_check_availability(array $params, string $sku = '', ?HttpClient $http = null)
{
    try {
        $config = new Config($params);
        $provider = ProviderFactory::make($config, $http);

        return $provider->checkAvailability($sku !== '' ? $sku : $config->planSku());
    } catch (\Throwable $e) {
        Logger::error('check_availability.exception', ['error' => $e->getMessage()]);

        return Result::fail(Result::CODE_REMOTE, 'Could not check licence availability.');
    }
}

/**
 * Refresh and return the DNS records a provider requires for a domain.
 *
 * @param  array<string,mixed> $params
 * @return array<string,mixed>
 */
function hostx_email_dns_records(array $params, ?HttpClient $http = null)
{
    try {
        $config = new Config($params);
        $provider = ProviderFactory::make($config, $http);
        $service = new DnsService($config, $provider);

        return $service->refresh($config->serviceId(), $config->domain());
    } catch (\Throwable $e) {
        Logger::error('dns_records.exception', ['error' => $e->getMessage()]);

        return Result::fail(Result::CODE_REMOTE, 'Could not read the provider DNS records.');
    }
}

/**
 * Capability matrix for every provider - drives the public comparison table and
 * the admin documentation. No credentials required.
 *
 * @return array<string,array<string,bool>>
 */
function hostx_email_capability_matrix()
{
    $matrix = [];

    foreach (array_keys(ProviderFactory::PROVIDERS) as $key) {
        $matrix[$key] = ProviderFactory::makeFor($key, new Config(['configoption1' => $key]))->capabilities();
    }

    return $matrix;
}
