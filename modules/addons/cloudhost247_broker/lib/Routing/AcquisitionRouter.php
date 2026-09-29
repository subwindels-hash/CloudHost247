<?php
namespace CloudHost247\Broker\Routing;

use CloudHost247\Broker\Providers\AdapterRegistry;
use CloudHost247\Broker\Providers\Capability;
use CloudHost247\Broker\Providers\ManualBrokerAdapter;
use CloudHost247\Broker\Repositories\ProviderConfigRepository;

/**
 * Decides the acquisition route for a brokerage case (requirement #11).
 *
 * Route A — a connected marketplace/for-sale-lookup provider confirms the
 *           domain is actually listed for sale.
 * Route B — a connected, agreement-confirmed brokerage provider exists, even
 *           without a confirmed live listing.
 * Route C — a registrar was identified (via RDAP/WHOIS) but no automated
 *           brokerage route is available.
 * Route D — CloudHost247's own manual broker team (the guaranteed fallback).
 *
 * The customer always sees one consistent CloudHost247 experience; only the
 * stored route/provider_key on the case records which path was actually used.
 */
final class AcquisitionRouter
{
    const ROUTE_A = 'route_a';
    const ROUTE_B = 'route_b';
    const ROUTE_C = 'route_c';
    const ROUTE_D = 'route_d';

    private $registry;
    private $configRepository;

    public function __construct(AdapterRegistry $registry = null, ProviderConfigRepository $configRepository = null)
    {
        $this->registry = $registry ?: new AdapterRegistry();
        $this->configRepository = $configRepository ?: new ProviderConfigRepository();
    }

    /**
     * @param string      $registrar registrar identified via WHOIS/RDAP, or ''
     * @return array route (ROUTE_*), provider_key, adapter (ProviderAdapter|null)
     */
    public function select($registrar = '')
    {
        $adapters = $this->registry->all($this->configRepository);
        $ordered = $this->orderedProviders($adapters);

        foreach ($ordered as $adapter) {
            if ($adapter->isManual()) { continue; }
            if ($adapter->supports(Capability::FOR_SALE_LOOKUP)) {
                return array('route' => self::ROUTE_A, 'provider_key' => $adapter->key(), 'adapter' => $adapter);
            }
        }
        foreach ($ordered as $adapter) {
            if ($adapter->isManual()) { continue; }
            if ($adapter->supports(Capability::BROKERAGE_REQUEST)) {
                return array('route' => self::ROUTE_B, 'provider_key' => $adapter->key(), 'adapter' => $adapter);
            }
        }
        if ($registrar !== '') {
            return array('route' => self::ROUTE_C, 'provider_key' => '', 'adapter' => null, 'registrar' => $registrar);
        }
        return array('route' => self::ROUTE_D, 'provider_key' => ManualBrokerAdapter::KEY, 'adapter' => $this->registry->get(ManualBrokerAdapter::KEY));
    }

    /** Manual broker is always the ultimate fallback; every case ends up assignable to it. */
    public function manualAdapter()
    {
        return $this->registry->get(ManualBrokerAdapter::KEY);
    }

    private function orderedProviders(array $adapters)
    {
        $rows = array();
        foreach ($adapters as $key => $adapter) {
            $config = $this->configRepository->find($key);
            $rows[] = array('priority' => $config ? (int) $config->priority : 100, 'adapter' => $adapter);
        }
        usort($rows, function ($a, $b) { return $a['priority'] - $b['priority']; });
        $out = array();
        foreach ($rows as $row) { $out[] = $row['adapter']; }
        return $out;
    }
}
