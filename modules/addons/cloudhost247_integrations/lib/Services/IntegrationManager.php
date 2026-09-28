<?php
namespace CloudHost247\Integrations\Services;

use CloudHost247\Foundation\Support\Logger;
use CloudHost247\Integrations\Api\IntegrationClient;
use CloudHost247\Integrations\Api\Transport;
use CloudHost247\Integrations\Registry\ProviderRegistry;
use CloudHost247\Integrations\Security\MasterKey;
use CloudHost247\Integrations\Security\SecretVault;
use CloudHost247\Integrations\Support\Environment;
use CloudHost247\Integrations\Support\IntegrationException;
use CloudHost247\Integrations\Support\Redactor;
use CloudHost247\Integrations\Support\ResultCode;
use WHMCS\Database\Capsule;

/**
 * Runtime entry point for the rest of the platform.
 *
 * Application code never reads credentials itself: it asks the manager for a
 * client, and the manager resolves the active configuration for the current
 * deployment environment, decrypts the credentials server-side and returns a
 * ready-to-use client. If the integration is missing, disabled or unreadable a
 * controlled IntegrationException is raised — never a fake success.
 */
final class IntegrationManager
{
    /** @var IntegrationRepository|null */
    private static $repository = null;

    public static function repository()
    {
        if (self::$repository === null) { self::$repository = new IntegrationRepository(); }
        return self::$repository;
    }

    public static function installed()
    {
        try {
            return class_exists('WHMCS\\Database\\Capsule') && Capsule::schema()->hasTable(IntegrationRepository::TABLE);
        } catch (\Throwable $error) {
            return false;
        }
    }

    /**
     * Non-secret configuration of the active integration for a provider, or
     * null when nothing is configured and enabled for this environment.
     */
    public static function configuration($providerKey, $environment = null)
    {
        $row = self::activeRow($providerKey, $environment);
        return $row ? self::repository()->configuration($row) : null;
    }

    public static function isAvailable($providerKey, $environment = null)
    {
        return self::activeRow($providerKey, $environment) !== null;
    }

    /**
     * Build an authenticated client for a provider.
     *
     * @throws IntegrationException when the integration cannot be used
     */
    public static function client($providerKey, $environment = null, Transport $transport = null)
    {
        $environment = $environment === null ? Environment::active() : Environment::assert($environment);
        if (!ProviderRegistry::has($providerKey)) {
            throw new IntegrationException(ResultCode::INVALID_CONFIGURATION, '', '', 'This integration is not registered.');
        }
        $row = self::activeRow($providerKey, $environment);
        if (!$row) {
            throw self::failure($providerKey, $environment, ResultCode::NOT_CONFIGURED, 'No enabled ' . $environment . ' configuration exists for this integration.');
        }
        if (!SecretVault::available() && ProviderRegistry::get($providerKey)->secretFields()) {
            throw self::failure($providerKey, $environment, ResultCode::INVALID_CONFIGURATION, 'Credential decryption is not available on this deployment.');
        }
        try {
            $secrets = self::repository()->secrets((int) $row->id);
        } catch (\Throwable $error) {
            throw self::failure($providerKey, $environment, ResultCode::INVALID_CONFIGURATION, 'Stored credentials could not be decrypted with the configured key.');
        }
        return new IntegrationClient(
            ProviderRegistry::get($providerKey),
            self::repository()->configuration($row),
            $secrets,
            $transport
        );
    }

    /**
     * Resolve configuration and decrypted credentials for a provider so a
     * module that owns a hardened, provider-specific client (for example the
     * secure RDP module or the signed OVH client) can keep using it while the
     * credentials themselves live in the central encrypted vault.
     *
     * Server-side only. The return value must never reach a template, a log
     * entry, an API response or a browser.
     *
     * @throws IntegrationException when the integration cannot be used
     * @return array config, secrets, definition
     */
    public static function credentials($providerKey, $environment = null)
    {
        $environment = $environment === null ? Environment::active() : Environment::assert($environment);
        if (!ProviderRegistry::has($providerKey)) {
            throw new IntegrationException(ResultCode::INVALID_CONFIGURATION, '', '', 'This integration is not registered.');
        }
        $row = self::activeRow($providerKey, $environment);
        if (!$row) {
            throw self::failure($providerKey, $environment, ResultCode::NOT_CONFIGURED, 'No enabled ' . $environment . ' configuration exists for this integration.');
        }
        try {
            $secrets = self::repository()->secrets((int) $row->id);
        } catch (\Throwable $error) {
            throw self::failure($providerKey, $environment, ResultCode::INVALID_CONFIGURATION, 'Stored credentials could not be decrypted with the configured key.');
        }
        return array(
            'config' => self::repository()->configuration($row),
            'secrets' => $secrets,
            'definition' => ProviderRegistry::get($providerKey),
        );
    }

    /**
     * Resolve credentials without raising when the centre is not installed or
     * the provider is not configured. Callers use this while migrating from a
     * legacy per-module configuration to the central vault.
     *
     * @return array|null
     */
    public static function optionalCredentials($providerKey, $environment = null)
    {
        if (!self::installed() || !ProviderRegistry::has($providerKey)) { return null; }
        try {
            // Nothing configured centrally yet is the expected state during a
            // migration and is not an incident, so it is not recorded.
            if (self::activeRow($providerKey, $environment) === null) { return null; }
            return self::credentials($providerKey, $environment);
        } catch (\Throwable $error) {
            // A configured-but-unusable integration is a real failure: it was
            // already recorded by credentials() before the exception.
            return null;
        }
    }

    /**
     * Run the provider's connection test for a stored integration and persist
     * the real result.
     *
     * @return array code, detail, latency_ms, correlation_id
     */
    public static function test($integrationId, $adminId = null, Transport $transport = null)
    {
        $repository = self::repository();
        $row = $repository->find($integrationId);
        $correlation = Logger::correlationId();
        if (!$row) {
            return array('code' => ResultCode::NOT_CONFIGURED, 'detail' => 'The integration no longer exists.', 'latency_ms' => 0, 'correlation_id' => $correlation);
        }
        $definition = ProviderRegistry::get($row->provider_key);
        if (!MasterKey::available() && $definition->secretFields()) {
            $result = array('code' => ResultCode::INVALID_CONFIGURATION, 'detail' => 'Credential encryption is not configured on this deployment.', 'latency_ms' => 0, 'correlation_id' => $correlation);
            $repository->recordHealth((int) $row->id, $result, 'health_check', $adminId);
            return $result;
        }
        try {
            $secrets = $repository->secrets((int) $row->id);
        } catch (\Throwable $error) {
            $result = array('code' => ResultCode::INVALID_CONFIGURATION, 'detail' => 'Stored credentials could not be decrypted with the configured key.', 'latency_ms' => 0, 'correlation_id' => $correlation);
            $repository->recordHealth((int) $row->id, $result, 'health_check', $adminId);
            return $result;
        }
        $tester = new ConnectionTester($transport);
        $result = $tester->check($definition, $repository->configuration($row), $secrets);
        $result['correlation_id'] = $correlation;
        $repository->recordHealth((int) $row->id, $result, 'health_check', $adminId);
        return $result;
    }

    /**
     * Record a sanitized runtime failure so an administrator can troubleshoot
     * without any provider payload or credential being written anywhere.
     */
    public static function recordRuntimeFailure($providerKey, $environment, $resultCode, $detail, $correlationId = null)
    {
        $environment = $environment === null ? Environment::active() : $environment;
        $correlationId = $correlationId ? $correlationId : Logger::correlationId();
        try {
            $row = self::repository()->findFor($providerKey, $environment);
            self::repository()->recordHealth($row ? (int) $row->id : 0, array(
                'code' => ResultCode::isValid($resultCode) ? $resultCode : ResultCode::PROVIDER_UNAVAILABLE,
                'detail' => Redactor::text($detail, 255),
                'correlation_id' => $correlationId,
                'provider_key' => $providerKey,
                'environment' => $environment,
            ), 'runtime_failure');
        } catch (\Throwable $error) {
            // Recording must never mask the original failure.
        }
        Logger::write('cloudhost247_integrations', 'error', 'integration.failure', array(
            'provider' => (string) $providerKey,
            'environment' => (string) $environment,
            'result_code' => (string) $resultCode,
        ), $correlationId);
        return $correlationId;
    }

    /**
     * Health overview rows for the dashboard: every registered provider joined
     * with its real, stored connection state for one environment.
     */
    public static function overview($environment)
    {
        $environment = Environment::assert($environment);
        $stored = array();
        if (self::installed()) {
            foreach (self::repository()->all($environment) as $row) { $stored[$row->provider_key] = $row; }
        }
        $rows = array();
        foreach (ProviderRegistry::all() as $key => $definition) {
            $row = isset($stored[$key]) ? $stored[$key] : null;
            $rows[] = array(
                'provider_key' => $key,
                'definition' => $definition,
                'configured' => $row !== null,
                'integration_id' => $row ? (int) $row->id : 0,
                'display_name' => $row ? (string) $row->display_name : $definition->label(),
                'enabled' => $row ? (bool) $row->enabled : false,
                'environment' => $environment,
                'status' => $row ? (string) $row->status : ResultCode::NOT_CONFIGURED,
                'status_label' => $row ? ResultCode::label($row->status) : ResultCode::label(ResultCode::NOT_CONFIGURED),
                'last_checked_at' => $row && $row->last_checked_at ? (string) $row->last_checked_at : '',
                'last_success_at' => $row && $row->last_success_at ? (string) $row->last_success_at : '',
                'last_failure_at' => $row && $row->last_failure_at ? (string) $row->last_failure_at : '',
                'last_failure_reason' => $row && $row->last_failure_reason ? (string) $row->last_failure_reason : '',
                'updated_at' => $row ? (string) $row->updated_at : '',
                'created_at' => $row ? (string) $row->created_at : '',
            );
        }
        return $rows;
    }

    private static function activeRow($providerKey, $environment = null)
    {
        if (!self::installed()) { return null; }
        $environment = $environment === null ? Environment::active() : Environment::assert($environment);
        $row = self::repository()->findFor($providerKey, $environment);
        return $row && (int) $row->enabled === 1 ? $row : null;
    }

    private static function failure($providerKey, $environment, $code, $detail)
    {
        $correlation = self::recordRuntimeFailure($providerKey, $environment, $code, $detail);
        return new IntegrationException($code, $providerKey, $correlation, $detail);
    }
}
