<?php
namespace CloudHost247\Broker\Domain;

/**
 * Bridges to the existing CloudHost247 Domain Lookup addon
 * (modules/addons/cloudhost247_domain_lookup) instead of duplicating WHOIS /
 * availability logic. That module is only ever required defensively and its
 * classes are used read-only; nothing here writes to its tables.
 */
final class LegacyLookupBridge implements LookupBridgeInterface
{
    private $loaded = false;

    private function load()
    {
        if ($this->loaded) { return; }
        $entry = __DIR__ . '/../../../cloudhost247_domain_lookup/cloudhost247_domain_lookup.php';
        if (is_file($entry)) {
            require_once $entry;
        }
        $this->loaded = true;
    }

    public function checkAvailability($domain)
    {
        $this->load();
        if (!class_exists('\\WHMCS\\Module\\Addon\\CloudHost247Tools\\DomainAvailability')) { return null; }
        try {
            $tool = new \WHMCS\Module\Addon\CloudHost247Tools\DomainAvailability();
            $tld = $this->extractTld($domain);
            $result = $tool->check($domain, $tld ? array($tld) : array());
            if (empty($result['success']) || empty($result['results'][0])) { return null; }
            $row = $result['results'][0];
            return array(
                'success' => !empty($row['success']),
                'available' => array_key_exists('available', $row) ? $row['available'] : null,
                'registrar' => isset($row['registrar']) ? $row['registrar'] : null,
            );
        } catch (\Throwable $error) {
            return null;
        }
    }

    public function whois($domain)
    {
        $this->load();
        if (!class_exists('\\WHMCS\\Module\\Addon\\CloudHost247Tools\\WhoisTool')) { return null; }
        try {
            $tool = new \WHMCS\Module\Addon\CloudHost247Tools\WhoisTool();
            $result = $tool->lookup($domain);
            if (empty($result['success'])) { return null; }
            return array(
                'success' => true,
                'registrar' => isset($result['registrar']) ? $result['registrar'] : null,
                'raw_whois' => isset($result['raw_whois']) ? (string) $result['raw_whois'] : '',
                'status' => isset($result['domain_status']) ? (array) $result['domain_status'] : array(),
            );
        } catch (\Throwable $error) {
            return null;
        }
    }

    private function extractTld($domain)
    {
        $domain = strtolower(trim((string) $domain));
        $parts = explode('.', $domain);
        return count($parts) > 1 ? end($parts) : '';
    }
}
