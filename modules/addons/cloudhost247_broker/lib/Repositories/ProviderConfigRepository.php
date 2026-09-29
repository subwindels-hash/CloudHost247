<?php
namespace CloudHost247\Broker\Repositories;

use WHMCS\Database\Capsule;

/**
 * Broker-owned policy for each acquisition provider: whether the broker
 * engine may route a case to it, its priority, and whether an administrator
 * has confirmed the commercial/partner agreement its aftermarket
 * capabilities require. Real connection state itself is never duplicated
 * here — it always comes from CloudHost247\Integrations (see
 * Providers\AbstractIntegrationAdapter).
 */
final class ProviderConfigRepository
{
    const TABLE = 'mod_cloudhost247_broker_providers';

    public function find($providerKey)
    {
        return Capsule::table(self::TABLE)->where('provider_key', (string) $providerKey)->first();
    }

    public function all()
    {
        return Capsule::table(self::TABLE)->orderBy('priority')->get();
    }

    /** Ensures a policy row exists for a provider key so the admin screen always has something to edit. */
    public function ensure($providerKey, array $defaults = array())
    {
        $existing = $this->find($providerKey);
        if ($existing) { return $existing; }
        $data = array_merge(array(
            'provider_key' => (string) $providerKey,
            'priority' => 100,
            'enabled' => false,
            'partner_agreement_confirmed' => false,
            'agreement_reference' => '',
            'notes' => '',
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ), $defaults);
        Capsule::table(self::TABLE)->insert($data);
        return $this->find($providerKey);
    }

    public function save($providerKey, array $data)
    {
        $this->ensure($providerKey);
        $data['updated_at'] = date('Y-m-d H:i:s');
        return Capsule::table(self::TABLE)->where('provider_key', (string) $providerKey)->update($data);
    }
}
