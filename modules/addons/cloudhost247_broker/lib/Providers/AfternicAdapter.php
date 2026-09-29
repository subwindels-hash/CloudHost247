<?php
namespace CloudHost247\Broker\Providers;

/**
 * Afternic aftermarket / Fast Transfer API (requirement #14).
 *
 * CloudHost247 never displays "Afternic Connected" unless this integration is
 * both configured and tested successfully, and the partner agreement its
 * marketplace capabilities require has been confirmed by an administrator.
 */
final class AfternicAdapter extends AbstractIntegrationAdapter
{
    const KEY = 'afternic';

    public function key() { return self::KEY; }

    public function label() { return 'Afternic'; }

    public function declaredCapabilities()
    {
        return array(Capability::FOR_SALE_LOOKUP, Capability::BROKERAGE_REQUEST);
    }

    protected function agreementGatedCapabilities()
    {
        return array(Capability::FOR_SALE_LOOKUP, Capability::BROKERAGE_REQUEST);
    }

    public function accessRequirements()
    {
        return 'Requires an approved Afternic reseller/API partner agreement. There is no public self-serve specification; the base URL and credentials are supplied directly by Afternic at onboarding. Confirm the partner agreement from Super Admin -> Domain Brokerage -> Providers once the integration tests Connected.';
    }
}
