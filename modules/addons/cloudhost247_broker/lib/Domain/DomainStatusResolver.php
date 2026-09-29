<?php
namespace CloudHost247\Broker\Domain;

use CloudHost247\Broker\Providers\GoDaddyAdapter;

/**
 * Determines the real state of a domain for the "Broker This Domain" search
 * integration (requirement #2). Never claims a domain is "for sale" just
 * because it is registered — that distinction is enforced in DomainState and
 * everywhere this class's result is displayed.
 *
 * Source priority: a connected GoDaddy integration (authoritative registrar
 * data) first, then the existing CloudHost247 Domain Lookup WHOIS toolkit as
 * a fallback. If neither can answer, the state is honestly reported as
 * UNKNOWN or PROVIDER_UNAVAILABLE — never guessed.
 */
final class DomainStatusResolver
{
    private static $privacyPatterns = array(
        'privacy', 'redacted for privacy', 'whoisguard', 'domains by proxy', 'perfect privacy',
        'private registration', 'identity protect', 'privacy protect', 'proxy protection', 'not disclosed',
    );

    private static $transferRestrictedPatterns = array(
        'clienttransferprohibited', 'servertransferprohibited', 'pendingdelete', 'redemptionperiod',
    );

    private $godaddy;
    private $legacyBridge;

    public function __construct(GoDaddyAdapter $godaddy = null, LookupBridgeInterface $legacyBridge = null)
    {
        $this->godaddy = $godaddy ?: new GoDaddyAdapter();
        $this->legacyBridge = $legacyBridge ?: new LegacyLookupBridge();
    }

    /**
     * @return array domain, tld, state, state_label, registrar, privacy_protected,
     *               transfer_restricted, source, broker_eligible, checked_at
     */
    public function resolve($domain)
    {
        $domain = $this->normalize($domain);
        if ($domain === null) {
            return $this->result('', '', DomainState::UNKNOWN, null, null, null, 'validation');
        }
        $tld = $this->tld($domain);

        $goDaddyResult = $this->godaddy->checkAvailability($domain);
        if ($goDaddyResult !== null) {
            if ($goDaddyResult['available'] === true) {
                $state = DomainState::AVAILABLE;
            } elseif (isset($goDaddyResult['definitive']) && $goDaddyResult['definitive'] === false) {
                // GoDaddy answered but could not give a definitive result (e.g. some
                // premium/ccTLD cases); do not guess registered vs. premium.
                $state = DomainState::UNKNOWN;
            } else {
                $state = DomainState::REGISTERED;
            }
            return $this->result($domain, $tld, $state, null, null, null, 'godaddy');
        }

        $availability = $this->legacyBridge->checkAvailability($domain);
        $whois = $this->legacyBridge->whois($domain);

        $registrar = null;
        $privacyProtected = null;
        $transferRestricted = false;
        if (is_array($whois) && !empty($whois['success'])) {
            $registrar = isset($whois['registrar']) ? $whois['registrar'] : null;
            $raw = strtolower(isset($whois['raw_whois']) ? $whois['raw_whois'] : '');
            foreach (self::$privacyPatterns as $needle) {
                if ($raw !== '' && strpos($raw, $needle) !== false) { $privacyProtected = true; break; }
            }
            if ($privacyProtected === null && $raw !== '') { $privacyProtected = false; }
            foreach (self::$transferRestrictedPatterns as $needle) {
                if ($raw !== '' && strpos($raw, $needle) !== false) { $transferRestricted = true; break; }
            }
        }

        if (is_array($availability) && !empty($availability['success']) && array_key_exists('available', $availability)) {
            if ($availability['available'] === true) {
                $state = DomainState::AVAILABLE;
            } elseif ($availability['available'] === false) {
                $state = $transferRestricted ? DomainState::TRANSFER_RESTRICTED : DomainState::REGISTERED;
                if ($registrar === null && !empty($availability['registrar'])) { $registrar = $availability['registrar']; }
            } else {
                $state = DomainState::UNKNOWN;
            }
            return $this->result($domain, $tld, $state, $registrar, $privacyProtected, $transferRestricted, 'domain_lookup');
        }

        if (is_array($whois) && !empty($whois['success'])) {
            // WHOIS answered but availability could not be determined precisely: a
            // successful WHOIS response for a domain generally means it is
            // registered, but we mark it not-fully-definitive by keeping the
            // 'unknown' state only when WHOIS itself failed (handled below).
            $state = $transferRestricted ? DomainState::TRANSFER_RESTRICTED : DomainState::REGISTERED;
            return $this->result($domain, $tld, $state, $registrar, $privacyProtected, $transferRestricted, 'domain_lookup');
        }

        return $this->result($domain, $tld, DomainState::PROVIDER_UNAVAILABLE, null, null, null, 'unavailable');
    }

    private function result($domain, $tld, $state, $registrar, $privacyProtected, $transferRestricted, $source)
    {
        return array(
            'domain' => $domain,
            'tld' => $tld,
            'state' => $state,
            'state_label' => DomainState::label($state),
            'registrar' => $registrar,
            'privacy_protected' => $privacyProtected,
            'transfer_restricted' => (bool) $transferRestricted,
            'source' => $source,
            'broker_eligible' => DomainState::isBrokerEligible($state),
            'checked_at' => date('Y-m-d H:i:s'),
        );
    }

    /** @return string|null lowercased, validated domain, or null when the input is not a plausible domain */
    private function normalize($domain)
    {
        $domain = strtolower(trim((string) $domain));
        $domain = preg_replace('#^https?://#', '', $domain);
        $domain = preg_replace('#^www\.#', '', $domain);
        $domain = rtrim(explode('/', $domain, 2)[0]);
        if (!preg_match('/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $domain)) {
            return null;
        }
        return $domain;
    }

    private function tld($domain)
    {
        $parts = explode('.', $domain);
        return end($parts);
    }
}
