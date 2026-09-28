<?php
namespace CloudHost247\Smm\Services;

use CloudHost247\Smm\Repositories\LogRepository;
use CloudHost247\Smm\Repositories\ProviderRepository;
use CloudHost247\Smm\Support\AdapterException;
use CloudHost247\Smm\Support\TransportException;

/**
 * Catalog synchronization: pull the provider's service list, diff it against
 * the stored catalog and apply adds/updates/deactivations. Rows the provider
 * no longer lists are marked unavailable — never deleted — so order history
 * keeps valid references.
 */
final class SyncService
{
    private $providers;
    private $recorder;
    private $factory;

    public function __construct(ProviderRepository $providers, LogRepository $recorder, AdapterFactory $factory)
    {
        $this->providers = $providers;
        $this->recorder = $recorder;
        $this->factory = $factory;
    }

    /**
     * @param int    $providerId
     * @param string $trigger cron|admin
     * @return array array('ok' => bool, 'message' => string, 'counts' => array)
     */
    public function syncProvider($providerId, $trigger = 'cron')
    {
        $providerId = (int) $providerId;
        $provider = $this->providers->find($providerId);
        if ($provider === null) {
            return array('ok' => false, 'message' => 'Provider not found.', 'counts' => array());
        }
        $correlationId = OrderService::newCorrelationId();
        $startedAt = date('Y-m-d H:i:s');
        try {
            $adapter = $this->factory->forProvider($provider);
            $started = microtime(true);
            $fetched = $adapter->fetchServices();
            $durationMs = (int) round((microtime(true) - $started) * 1000);
            $this->recorder->record($providerId, 'services', array('action' => 'services'),
                array('services_returned' => count($fetched)), 200, $durationMs, 'success', $correlationId);
        } catch (AdapterException $e) {
            $this->recorder->record($providerId, 'services', array('action' => 'services'),
                array('error' => $e->rawDetail() !== null ? $e->rawDetail() : $e->getMessage()), 200, 0, 'rejected', $correlationId);
            $this->providers->markProviderError($providerId, $e->getMessage());
            $this->history($providerId, $trigger, 'rejected', 0, 0, 0, 0, 0, $e->getMessage(), $startedAt);
            return array('ok' => false, 'message' => 'Provider refused the catalog request: ' . $e->getMessage(), 'counts' => array());
        } catch (TransportException $e) {
            $this->recorder->record($providerId, 'services', array('action' => 'services'),
                array('transport_error' => $e->getMessage()), 0, 0, 'error', $correlationId);
            $this->providers->markProviderError($providerId, $e->getMessage());
            $this->history($providerId, $trigger, 'error', 0, 0, 0, 0, 0, $e->getMessage(), $startedAt);
            return array('ok' => false, 'message' => 'Catalog sync failed: ' . $e->getMessage(), 'counts' => array());
        }

        $existing = $this->providers->servicesForProvider($providerId);
        $plan = CatalogSync::merge($fetched, is_array($existing) ? $existing : $existing->toArray());

        foreach ($plan['add'] as $row) {
            $this->providers->insertService(array(
                'provider_id' => $providerId,
                'provider_service_id' => $row['provider_service_id'],
                'name' => $row['name'],
                'category' => $row['category'],
                'description' => $row['description'],
                'type' => $row['type'],
                'min_quantity' => $row['min_quantity'],
                'max_quantity' => $row['max_quantity'],
                'rate' => $row['rate'],
                'currency' => $row['currency'],
                'refill' => $row['refill'] ? 1 : 0,
                'cancel' => $row['cancel'] ? 1 : 0,
                'provider_status' => $row['provider_status'],
                'available' => 1,
                'last_seen_at' => date('Y-m-d H:i:s'),
            ));
        }
        foreach ($plan['update'] as $localId => $changed) {
            $this->providers->updateService($localId, $changed);
        }
        foreach ($plan['deactivate'] as $localId) {
            $this->providers->updateService($localId, array('available' => 0));
        }

        $counts = array(
            'seen' => count($fetched),
            'added' => count($plan['add']),
            'updated' => count($plan['update']),
            'deactivated' => count($plan['deactivate']),
            'unchanged' => $plan['unchanged'],
        );
        $this->history($providerId, $trigger, 'success', $counts['seen'], $counts['added'], $counts['updated'], $counts['deactivated'], $counts['unchanged'], '', $startedAt);
        $this->providers->update($providerId, array('last_sync_at' => date('Y-m-d H:i:s')));
        return array('ok' => true,
            'message' => sprintf('Synced %d services: %d added, %d updated, %d deactivated.',
                $counts['seen'], $counts['added'], $counts['updated'], $counts['deactivated']),
            'counts' => $counts);
    }

    /** Sync every enabled provider (bounded, isolated per provider). */
    public function syncAllEnabled($trigger = 'cron')
    {
        $results = array();
        foreach ($this->providers->enabled() as $provider) {
            $results[(int) $provider->id] = $this->syncProvider((int) $provider->id, $trigger);
        }
        return $results;
    }

    private function history($providerId, $trigger, $result, $seen, $added, $updated, $deactivated, $unchanged, $error, $startedAt)
    {
        $this->recorder->recordSyncHistory(array(
            'provider_id' => $providerId,
            'trigger' => $trigger === 'admin' ? 'admin' : 'cron',
            'result' => $result,
            'services_seen' => (int) $seen,
            'services_added' => (int) $added,
            'services_updated' => (int) $updated,
            'services_deactivated' => (int) $deactivated,
            'services_unchanged' => (int) $unchanged,
            'error_message' => mb_substr((string) $error, 0, 500),
            'started_at' => $startedAt,
            'finished_at' => date('Y-m-d H:i:s'),
        ));
    }
}
