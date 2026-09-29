<?php
namespace CloudHost247\Broker\Providers;

/**
 * The guaranteed fallback route (requirement #16): CloudHost247's own broker
 * team, using legitimate manual contact channels (public RDAP/WHOIS contact
 * where available, registrar forwarding mechanisms, public business contact
 * information, the domain's own public website, or an approved marketplace
 * channel a broker operates by hand). No external API is called, so this
 * adapter is always available — it never depends on API credentials, a
 * connection test, or a commercial agreement.
 */
final class ManualBrokerAdapter implements ProviderAdapter
{
    const KEY = 'manual';

    public function key() { return self::KEY; }

    public function label() { return 'Manual CloudHost247 Broker'; }

    public function isManual() { return true; }

    public function declaredCapabilities()
    {
        return array(
            Capability::BROKERAGE_REQUEST,
            Capability::OWNER_CONTACT,
            Capability::NEGOTIATION,
            Capability::OFFER_SUBMISSION,
            Capability::COUNTEROFFER,
            Capability::TRANSFER,
            Capability::TRANSFER_STATUS,
            Capability::DOMAIN_DELIVERY,
        );
    }

    /** Always active: a human broker never needs a connection test to exist. */
    public function activeCapabilities() { return $this->declaredCapabilities(); }

    public function supports($capability) { return in_array($capability, $this->declaredCapabilities(), true); }

    public function connectionState() { return ConnectionState::MANUAL; }

    public function connectionDetail() { return 'CloudHost247 broker team. No external API dependency; outreach and negotiation are recorded manually inside this case.'; }

    /** The manual route has no external integration row; its state is always "available, no check needed". */
    public function integrationSummary()
    {
        return array('environment' => 'n/a', 'last_checked_at' => '', 'configured' => true);
    }

    public function accessRequirements()
    {
        return 'No third-party access is required. A CloudHost247 broker must use only legitimate contact channels (public RDAP/WHOIS contact where available, registrar forwarding, public business contact information, the domain\'s own public website, or an approved marketplace channel) and must never scrape, purchase, or bypass privacy-protected registrant data.';
    }
}
