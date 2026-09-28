<?php
namespace CloudHost247\Integrations\Services;

use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Foundation\Support\SafeError;
use CloudHost247\Integrations\Registry\ProviderRegistry;
use CloudHost247\Integrations\Security\MasterKey;
use CloudHost247\Integrations\Security\SecretVault;
use CloudHost247\Integrations\Support\Environment;
use CloudHost247\Integrations\Support\Redactor;
use CloudHost247\Integrations\Support\ResultCode;
use InvalidArgumentException;

/**
 * Super Admin controller for the API & Integrations centre.
 *
 * Every entry point requires an authenticated WHMCS administrator; every state
 * change requires a valid CSRF token, an optional per-operation role capability
 * and, for production configurations, an explicit confirmation. Every
 * administrative action is written to the shared CloudHost247 audit log.
 */
final class AdminController
{
    const MODULE = 'cloudhost247_integrations';

    private $repository;

    public function __construct(IntegrationRepository $repository = null)
    {
        $this->repository = $repository ? $repository : new IntegrationRepository();
    }

    public function handle()
    {
        $adminId = AdminGuard::requireAdmin();
        AdminGuard::requireCapability(self::MODULE, 'integrations.view');

        $notice = '';
        $error = '';
        $testResult = null;

        if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET') === 'POST') {
            try {
                AdminGuard::requirePostToken();
                $operation = isset($_POST['operation']) ? (string) $_POST['operation'] : '';
                $outcome = $this->dispatch($operation, $adminId);
                $notice = isset($outcome['notice']) ? $outcome['notice'] : '';
                $testResult = isset($outcome['test']) ? $outcome['test'] : null;
            } catch (InvalidArgumentException $invalid) {
                $error = Redactor::text($invalid->getMessage(), 240);
            } catch (\Throwable $failure) {
                $safe = SafeError::from($failure, self::MODULE, 'admin.operation', 'The requested integration operation could not be completed.');
                $error = $safe['display'];
            }
        }

        $environment = $this->selectedEnvironment();
        $view = $this->selectedView();
        $selected = $this->selectedProvider();

        $data = array(
            'view' => $view,
            'environment' => $environment,
            'active_environment' => Environment::active(),
            'environment_explicit' => Environment::isExplicit(),
            'environment_source' => Environment::source(),
            'environments' => Environment::supported(),
            'vault_ready' => SecretVault::available(),
            'vault_source' => MasterKey::describeSource(),
            'key_variable' => MasterKey::ENV_VARIABLE,
            'overview' => IntegrationManager::overview($environment),
            'categories' => ProviderRegistry::categories(),
            'notice' => $notice,
            'error' => $error,
            'test' => $testResult,
            'token' => function_exists('generate_token') ? generate_token('plain') : '',
            'result_codes' => ResultCode::all(),
        );

        if ($view === 'configure' && $selected !== '') {
            $data['provider'] = ProviderRegistry::get($selected);
            $row = $this->repository->findFor($selected, $environment);
            $data['row'] = $row;
            $data['configuration'] = $row ? $this->repository->configuration($row) : null;
            $data['secret_metadata'] = $row ? $this->repository->secretMetadata((int) $row->id) : array();
        }
        if ($view === 'events') {
            $filters = array();
            foreach (array('provider_key', 'environment', 'event_type', 'result_code', 'outcome') as $filter) {
                if (!empty($_GET[$filter])) { $filters[$filter] = (string) $_GET[$filter]; }
            }
            if (!isset($filters['environment'])) { $filters['environment'] = $environment; }
            $data['events'] = $this->repository->events($filters, isset($_GET['event_page']) ? $_GET['event_page'] : 1);
            $data['event_filters'] = $filters;
        }
        return $data;
    }

    /* ---------------------------------------------------------- operations */

    private function dispatch($operation, $adminId)
    {
        switch ($operation) {
            case 'save':
                return $this->save($adminId);
            case 'test':
                return $this->test($adminId);
            case 'toggle':
                return $this->toggle($adminId);
            case 'rotate':
                return $this->rotate($adminId);
            case 'delete':
                return $this->delete($adminId);
            default:
                throw new InvalidArgumentException('Unknown integration operation.');
        }
    }

    private function save($adminId)
    {
        $providerKey = $this->postProvider();
        $environment = Environment::assert(isset($_POST['environment']) ? $_POST['environment'] : '');
        $existing = $this->repository->findFor($providerKey, $environment);
        AdminGuard::requireCapability(self::MODULE, $existing ? 'integrations.edit' : 'integrations.create');
        $this->assertProductionConfirmation($environment);
        if ($this->changesEndpoint($providerKey, $existing)) {
            AdminGuard::requireCapability(self::MODULE, 'integrations.endpoint');
        }

        $before = $existing ? $this->auditSnapshot($existing) : array();
        try {
            $saved = $this->repository->save($providerKey, $environment, $this->input(), $adminId);
        } catch (\Throwable $failure) {
            AuditLogger::record(self::MODULE, 'integration.save', 'integration', $providerKey . ':' . $environment, $before, array(), 'failed', Redactor::text($failure->getMessage(), 240), $adminId);
            throw $failure;
        }
        $after = array_merge($saved['changes'], array(
            'enabled' => !empty($_POST['enabled']),
            'rotated_credential_fields' => $saved['rotated'],
        ));
        AuditLogger::record(self::MODULE, $saved['created'] ? 'integration.create' : 'integration.update', 'integration', $providerKey . ':' . $environment, $before, $after, 'success', null, $adminId);
        $message = $saved['created'] ? 'Integration created.' : 'Integration updated.';
        if ($saved['rotated']) { $message .= ' Replaced credentials: ' . implode(', ', $saved['rotated']) . '. Run a connection test to confirm the new values.'; }
        return array('notice' => $message);
    }

    private function test($adminId)
    {
        AdminGuard::requireCapability(self::MODULE, 'integrations.test');
        $id = (int) (isset($_POST['integration_id']) ? $_POST['integration_id'] : 0);
        $row = $this->repository->find($id);
        if (!$row) { throw new InvalidArgumentException('Select a configured integration before testing.'); }
        $this->assertProductionConfirmation((string) $row->environment);
        $result = IntegrationManager::test($id, $adminId);
        AuditLogger::record(self::MODULE, 'integration.test', 'integration', $row->provider_key . ':' . $row->environment, array(), array(
            'result_code' => $result['code'],
            'latency_ms' => isset($result['latency_ms']) ? (int) $result['latency_ms'] : 0,
        ), ResultCode::isSuccess($result['code']) ? 'success' : 'failed', ResultCode::isSuccess($result['code']) ? null : $result['detail'], $adminId);
        return array('notice' => 'Connection test completed: ' . ResultCode::label($result['code']) . '.', 'test' => $result);
    }

    private function toggle($adminId)
    {
        AdminGuard::requireCapability(self::MODULE, 'integrations.toggle');
        $id = (int) (isset($_POST['integration_id']) ? $_POST['integration_id'] : 0);
        $row = $this->repository->find($id);
        if (!$row) { throw new InvalidArgumentException('The integration no longer exists.'); }
        $enabled = !empty($_POST['enabled']);
        if ($enabled) { $this->assertProductionConfirmation((string) $row->environment); }
        $this->repository->setEnabled($id, $enabled, $adminId);
        AuditLogger::record(self::MODULE, $enabled ? 'integration.enable' : 'integration.disable', 'integration', $row->provider_key . ':' . $row->environment, array('enabled' => (bool) $row->enabled), array('enabled' => $enabled), 'success', null, $adminId);
        return array('notice' => $enabled ? 'Integration enabled.' : 'Integration disabled.');
    }

    private function rotate($adminId)
    {
        AdminGuard::requireCapability(self::MODULE, 'integrations.rotate');
        $id = (int) (isset($_POST['integration_id']) ? $_POST['integration_id'] : 0);
        $row = $this->repository->find($id);
        if (!$row) { throw new InvalidArgumentException('The integration no longer exists.'); }
        $this->assertProductionConfirmation((string) $row->environment);
        $field = isset($_POST['field_key']) ? (string) $_POST['field_key'] : '';
        $value = isset($_POST['field_value']) ? (string) $_POST['field_value'] : '';
        $this->repository->rotate($id, $field, $value, $adminId);
        AuditLogger::record(self::MODULE, 'integration.rotate', 'integration', $row->provider_key . ':' . $row->environment, array(), array('rotated_credential_field' => $field), 'success', null, $adminId);
        return array('notice' => 'Credential replaced. The integration status was reset until the next successful connection test.');
    }

    private function delete($adminId)
    {
        AdminGuard::requireCapability(self::MODULE, 'integrations.delete');
        $id = (int) (isset($_POST['integration_id']) ? $_POST['integration_id'] : 0);
        $row = $this->repository->find($id);
        if (!$row) { throw new InvalidArgumentException('The integration no longer exists.'); }
        if (empty($_POST['confirm_delete'])) { throw new InvalidArgumentException('Confirm the removal before deleting an integration.'); }
        $this->repository->delete($id);
        AuditLogger::record(self::MODULE, 'integration.delete', 'integration', $row->provider_key . ':' . $row->environment, $this->auditSnapshot($row), array(), 'success', null, $adminId);
        return array('notice' => 'Integration and its encrypted credentials were removed.');
    }

    /* ------------------------------------------------------------ helpers */

    /**
     * Collect only the fields this provider declares. Unknown POST keys are
     * ignored so no undeclared value can reach storage.
     */
    private function input()
    {
        $definition = ProviderRegistry::get($this->postProvider());
        $input = array();
        foreach ($definition->fields() as $field) {
            $key = $field->key();
            if (array_key_exists($key, $_POST)) { $input[$key] = is_scalar($_POST[$key]) ? (string) $_POST[$key] : ''; }
        }
        foreach (array('timeout_seconds', 'connect_timeout_seconds', 'retry_attempts', 'retry_backoff_ms', 'display_name') as $key) {
            if (array_key_exists($key, $_POST)) { $input[$key] = is_scalar($_POST[$key]) ? (string) $_POST[$key] : ''; }
        }
        $input['enabled'] = !empty($_POST['enabled']);
        return $input;
    }

    private function changesEndpoint($providerKey, $existing)
    {
        $definition = ProviderRegistry::get($providerKey);
        if (!$definition->requiresAdministratorEndpoint() && $definition->baseUrlMode() !== 'region') { return false; }
        if (!$existing) { return true; }
        $submittedUrl = isset($_POST['base_url']) ? trim((string) $_POST['base_url']) : null;
        $submittedRegion = isset($_POST['region']) ? trim((string) $_POST['region']) : null;
        if ($submittedUrl !== null && $submittedUrl !== '' && rtrim($submittedUrl, '/') !== rtrim((string) $existing->base_url, '/')) { return true; }
        return $submittedRegion !== null && $submittedRegion !== '' && $submittedRegion !== (string) $existing->region;
    }

    private function assertProductionConfirmation($environment)
    {
        if (!Environment::isProduction($environment)) { return; }
        if (empty($_POST['confirm_production'])) {
            throw new InvalidArgumentException('This is a PRODUCTION configuration. Confirm the production environment before saving or testing it.');
        }
    }

    private function auditSnapshot($row)
    {
        return array(
            'enabled' => (bool) $row->enabled,
            'base_url' => (string) $row->base_url,
            'region' => (string) $row->region,
            'api_version' => (string) $row->api_version,
            'account_id' => (string) $row->account_id,
            'username' => (string) $row->username,
            'timeout_seconds' => (int) $row->timeout_seconds,
            'retry_attempts' => (int) $row->retry_attempts,
            'status' => (string) $row->status,
        );
    }

    private function postProvider()
    {
        $providerKey = isset($_POST['provider_key']) ? (string) $_POST['provider_key'] : '';
        if (!ProviderRegistry::has($providerKey)) { throw new InvalidArgumentException('Unknown integration provider.'); }
        return $providerKey;
    }

    private function selectedProvider()
    {
        $providerKey = isset($_GET['integration']) ? (string) $_GET['integration'] : '';
        return ProviderRegistry::has($providerKey) ? $providerKey : '';
    }

    private function selectedEnvironment()
    {
        $requested = isset($_GET['environment']) ? (string) $_GET['environment'] : '';
        if ($requested === '' && isset($_POST['environment'])) { $requested = (string) $_POST['environment']; }
        return in_array($requested, Environment::supported(), true) ? $requested : Environment::active();
    }

    private function selectedView()
    {
        $view = isset($_GET['view']) ? (string) $_GET['view'] : 'dashboard';
        return in_array($view, array('dashboard', 'configure', 'catalog', 'events'), true) ? $view : 'dashboard';
    }
}
