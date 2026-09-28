<?php
namespace CloudHost247\Smm\Services;

use CloudHost247\Smm\Adapters\AdapterFactory;
use CloudHost247\Smm\Contracts\ApiRecorder;
use CloudHost247\Smm\Repositories\ProviderRepository;
use CloudHost247\Smm\Support\Crypto;
use CloudHost247\Smm\Support\UrlPolicy;
use CloudHost247\Smm\Support\Validator;
use RuntimeException;

/**
 * Provider lifecycle management. Security invariants:
 *  - API keys arrive once (over POST), are encrypted immediately and only a
 *    masked hint is ever stored in the clear or displayed again;
 *  - deletion is blocked while any order history exists — providers with
 *    history must be disabled (history keeps its snapshot columns anyway);
 *  - every consequential change is audited with before/after values.
 */
final class ProviderService
{
    private $providers;
    private $recorder;
    private $factory;

    public function __construct(ProviderRepository $providers, ApiRecorder $recorder, AdapterFactory $factory)
    {
        $this->providers = $providers;
        $this->recorder = $recorder;
        $this->factory = $factory;
    }

    /**
     * Create or update a provider. When $input['api_key'] is empty on update,
     * the stored encrypted key is kept (keys are never echoed back to forms).
     * @return array array('ok' => bool, 'message' => string, 'id' => int|null)
     */
    public function save(array $input, $adminId)
    {
        $id = (int) (isset($input['id']) ? $input['id'] : 0);
        $name = trim((string) (isset($input['name']) ? $input['name'] : ''));
        $apiUrl = trim((string) (isset($input['api_url']) ? $input['api_url'] : ''));
        $adapter = (string) (isset($input['adapter']) ? $input['adapter'] : 'generic');
        $apiKey = (string) (isset($input['api_key']) ? $input['api_key'] : '');
        $priority = (int) (isset($input['priority']) ? $input['priority'] : 100);
        $requestTimeout = (int) (isset($input['request_timeout']) ? $input['request_timeout'] : 20);
        $currency = mb_substr(trim((string) (isset($input['currency']) ? $input['currency'] : '')), 0, 8);

        if ($name === '' || mb_strlen($name) > 120) {
            return array('ok' => false, 'message' => 'A provider name (max 120 characters) is required.');
        }
        if (!array_key_exists($adapter, AdapterFactory::availableAdapters())) {
            return array('ok' => false, 'message' => 'Unknown adapter type.');
        }
        try {
            $apiUrl = UrlPolicy::assertProviderEndpoint($apiUrl);
        } catch (RuntimeException $e) {
            return array('ok' => false, 'message' => $e->getMessage());
        }
        $priority = max(0, min(1000, $priority));
        $requestTimeout = max(5, min(60, $requestTimeout));

        $existing = $id > 0 ? $this->providers->find($id) : null;
        if ($id > 0 && $existing === null) {
            return array('ok' => false, 'message' => 'Provider not found.');
        }

        $data = array(
            'name' => $name,
            'adapter' => $adapter,
            'api_url' => $apiUrl,
            'priority' => $priority,
            'request_timeout' => $requestTimeout,
            'currency' => $currency,
        );

        try {
            if ($apiKey !== '') {
                if (strlen($apiKey) < 8 || strlen($apiKey) > 512) {
                    return array('ok' => false, 'message' => 'The API key must be between 8 and 512 characters.');
                }
                $data['api_key_encrypted'] = Crypto::encrypt($apiKey);
                $data['api_key_hint'] = Crypto::displayHint($apiKey);
            } elseif ($existing === null) {
                return array('ok' => false, 'message' => 'An API key is required for a new provider.');
            }
        } catch (RuntimeException $e) {
            return array('ok' => false, 'message' => 'API key could not be encrypted: ' . $e->getMessage());
        }

        if ($existing === null) {
            $data['enabled'] = 0; // new providers start disabled until tested
            $newId = $this->providers->create($data);
            \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_smm', 'provider.create', 'provider', $newId, array(), $this->auditable($data), 'success', null, $adminId);
            return array('ok' => true, 'message' => 'Provider created. Test the connection, then enable it.', 'id' => $newId);
        }

        $before = array('name' => (string) $existing->name, 'api_url' => (string) $existing->api_url,
            'priority' => (int) $existing->priority, 'request_timeout' => (int) $existing->request_timeout,
            'key_changed' => false);
        $this->providers->update($id, $data);
        \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_smm', 'provider.update', 'provider', $id, $before, $this->auditable($data), 'success', null, $adminId);
        return array('ok' => true, 'message' => 'Provider updated.' . ($apiKey !== '' ? ' New API key stored (encrypted).' : ''), 'id' => $id);
    }

    /** Enable/disable. Disabling pauses all automation for this provider. */
    public function toggle($id, $enabled, $adminId)
    {
        $provider = $this->providers->find((int) $id);
        if ($provider === null) {
            return array('ok' => false, 'message' => 'Provider not found.');
        }
        $enabled = $enabled ? 1 : 0;
        if ($enabled === 1 && ((string) $provider->api_key_encrypted === '')) {
            return array('ok' => false, 'message' => 'Provider has no stored API key and cannot be enabled.');
        }
        $this->providers->update((int) $id, array('enabled' => $enabled));
        \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_smm', 'provider.toggle', 'provider', (int) $id,
            array('enabled' => (int) $provider->enabled), array('enabled' => $enabled), 'success', null, $adminId);
        return array('ok' => true, 'message' => $enabled ? 'Provider enabled.' : 'Provider disabled. Existing orders keep their history; status sync is paused.');
    }

    /**
     * Live connectivity + credential test. Never trusts a stored plaintext —
     * it decrypts in memory, calls balance, and records a redacted log row.
     */
    public function test($id)
    {
        $provider = $this->providers->find((int) $id);
        if ($provider === null) {
            return array('ok' => false, 'message' => 'Provider not found.');
        }
        $correlationId = OrderService::newCorrelationId();
        try {
            $adapter = $this->factory->forProvider($provider);
            $started = microtime(true);
            $result = $adapter->testConnection();
            $durationMs = (int) round((microtime(true) - $started) * 1000);
            $this->recorder->record((int) $id, 'balance', array('action' => 'balance'),
                $result, 200, $durationMs, $result['ok'] ? 'success' : 'rejected', $correlationId);
        } catch (RuntimeException $e) {
            $this->recorder->record((int) $id, 'balance', array('action' => 'balance'),
                array('error' => $e->getMessage()), 0, 0, 'error', $correlationId);
            $this->providers->markProviderError((int) $id, $e->getMessage());
            return array('ok' => false, 'message' => 'Connection test failed: ' . $e->getMessage(), 'correlation_id' => $correlationId);
        }
        if ($result['ok']) {
            $this->providers->markProviderSuccess((int) $id, $result['balance'], $result['currency']);
            return array('ok' => true,
                'message' => 'Connection verified. Balance: ' . ($result['balance'] !== null ? $result['balance'] . ' ' . $result['currency'] : 'n/a'),
                'correlation_id' => $correlationId);
        }
        $this->providers->markProviderError((int) $id, $result['detail']);
        return array('ok' => false, 'message' => 'Provider refused the key: ' . $result['detail'], 'correlation_id' => $correlationId);
    }

    /**
     * Delete a provider. Blocked while any order exists for it — providers
     * with history must be disabled instead, so nothing is ever orphaned.
     */
    public function delete($id, $confirm, $adminId)
    {
        $id = (int) $id;
        $provider = $this->providers->find($id);
        if ($provider === null) {
            return array('ok' => false, 'message' => 'Provider not found.');
        }
        if (!$confirm) {
            return array('ok' => false, 'message' => 'Deletion requires the confirmation checkbox.');
        }
        $orderCount = $this->providers->countOrders($id);
        if ($orderCount > 0) {
            return array('ok' => false,
                'message' => 'Deletion blocked: ' . $orderCount . ' order(s) reference this provider. '
                    . 'Disable the provider instead (order history is preserved), or migrate the mappings to another provider first.');
        }
        // No history: safe to remove the catalog + mappings + provider row.
        $this->providers->disableMappingsForProvider($id);
        $this->providers->deleteServicesForProvider($id);
        // remove now-empty mapping rows
        \WHMCS\Database\Capsule::table('mod_cloudhost247_smm_mappings')->where('provider_id', $id)->delete();
        $this->providers->remove($id);
        \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_smm', 'provider.delete', 'provider', $id,
            array('name' => (string) $provider->name), array(), 'success', null, $adminId);
        return array('ok' => true, 'message' => 'Provider deleted (no order history existed).');
    }

    private function auditable(array $data)
    {
        unset($data['api_key_encrypted']);
        return $data + array('api_key_encrypted' => '[encrypted]');
    }
}
