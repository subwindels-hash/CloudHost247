<?php
namespace CloudHost247\Broker\Domain;

/**
 * Fallback domain-intelligence source used when no registrar integration
 * (e.g. GoDaddy) is connected. The real implementation
 * (LegacyLookupBridge) delegates to the existing CloudHost247 Domain Lookup
 * addon (WHOIS + availability) that already ships in this repository, so the
 * broker service reuses it instead of building a second one.
 */
interface LookupBridgeInterface
{
    /** @return array|null success(bool), available(bool|null), registrar(string|null) */
    public function checkAvailability($domain);

    /** @return array|null success(bool), registrar, raw_whois, status(array) */
    public function whois($domain);
}
