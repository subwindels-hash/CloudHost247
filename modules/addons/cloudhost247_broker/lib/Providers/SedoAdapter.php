<?php
namespace CloudHost247\Broker\Providers;

/**
 * Sedo Marketplace Partner Program (requirement #13).
 *
 * Sedo's aftermarket capabilities require a commercial Marketplace Partner
 * Program agreement. Until an administrator both (a) records that agreement
 * and (b) the underlying integration tests as Connected, none of these
 * capabilities are reported active — the broker engine falls back to the
 * manual broker instead of pretending Sedo is available.
 */
final class SedoAdapter extends AbstractIntegrationAdapter
{
    const KEY = 'sedo';

    public function key() { return self::KEY; }

    public function label() { return 'Sedo'; }

    public function declaredCapabilities()
    {
        return array(Capability::DOMAIN_SEARCH, Capability::FOR_SALE_LOOKUP, Capability::BROKERAGE_REQUEST, Capability::NEGOTIATION);
    }

    protected function agreementGatedCapabilities()
    {
        return array(Capability::FOR_SALE_LOOKUP, Capability::BROKERAGE_REQUEST, Capability::NEGOTIATION);
    }

    public function accessRequirements()
    {
        return 'Requires an approved Sedo Marketplace Partner Program (MPP) agreement. Configure the partner ID and sign key from Super Admin -> API & Integrations, test the connection, then confirm the partner agreement from Super Admin -> Domain Brokerage -> Providers before this route is offered to customers.';
    }
}
