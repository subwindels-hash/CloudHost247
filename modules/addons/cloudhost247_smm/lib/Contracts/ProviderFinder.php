<?php
namespace CloudHost247\Smm\Contracts;

/** Read-side provider/mapping/service access used by the order services. Implemented by the Capsule repositories; faked in tests. */
interface ProviderFinder
{
    /** @return object|null provider row */
    public function findProvider($providerId);

    /** @return object|null active mapping row for a WHMCS product id */
    public function activeMappingByProduct($productId);

    /** @return object|null mapping row by primary key (any enabled state) */
    public function mappingById($mappingId);

    /** @return object|null local catalog service row */
    public function findService($serviceId);

    /** Record a provider-level failure (isolation/cooldown marker). */
    public function markProviderError($providerId, $message);

    /** Record a provider-level success. */
    public function markProviderSuccess($providerId, $balance = null, $currency = null);
}
