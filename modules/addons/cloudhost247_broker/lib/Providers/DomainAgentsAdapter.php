<?php
namespace CloudHost247\Broker\Providers;

/**
 * DomainAgents brokerage API (requirement #15).
 *
 * Declares the full acquisition/negotiation/transfer surface DomainAgents
 * could support once a partner agreement exists. None of it is reported
 * active until the integration is configured, tested Connected, and the
 * commercial agreement is confirmed by an administrator.
 */
final class DomainAgentsAdapter extends AbstractIntegrationAdapter
{
    const KEY = 'domainagents';

    public function key() { return self::KEY; }

    public function label() { return 'DomainAgents'; }

    public function declaredCapabilities()
    {
        return array(
            Capability::BROKERAGE_REQUEST, Capability::OWNER_CONTACT, Capability::NEGOTIATION,
            Capability::OFFER_SUBMISSION, Capability::COUNTEROFFER, Capability::TRANSFER, Capability::TRANSFER_STATUS,
        );
    }

    protected function agreementGatedCapabilities()
    {
        return $this->declaredCapabilities();
    }

    public function accessRequirements()
    {
        return 'Requires an approved DomainAgents partner/API agreement. Configure the issued base URL and API key from Super Admin -> API & Integrations, test the connection, then confirm the partner agreement from Super Admin -> Domain Brokerage -> Providers before this route is offered to customers.';
    }
}
