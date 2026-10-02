<?php
namespace CloudHost247\NetworkTools\Core\Repository;

/**
 * Tool provider registry (mod_cloudhost247_nt_providers = tool_provider_configs).
 *
 * Two kinds of provider are deliberately separated:
 *
 *  - "integration" providers (geo-IP, WHOIS, AI, OCR, registrar, monitoring)
 *    hold their credentials in the existing CloudHost247 API & Integrations
 *    centre. This table keeps only the non-secret selection: which provider key
 *    a tool should use, endpoint overrides an administrator approved, timeout,
 *    priority and whether it is enabled.
 *  - "dnsbl" providers are DNS-based blocklists. They need no credential at
 *    all: an entry is a zone name plus the listing/reply semantics that zone
 *    documents. They ship removed from service, because querying a public
 *    blocklist through a public resolver is against several operators' policy
 *    and would produce misleading answers; an administrator enables the ones
 *    whose query policy the platform's resolver IP complies with.
 */
final class ProviderRepository extends Repository
{
    const TABLE = 'providers';

    public static function types()
    {
        return array('integration', 'dnsbl', 'http');
    }

    /** Real DNSBL zones, shipped disabled with their documented reply meaning. */
    public static function dnsblDefaults()
    {
        return array(
            array('provider_key' => 'dnsbl.spamhaus_zen', 'label' => 'Spamhaus ZEN', 'zone' => 'zen.spamhaus.org', 'configuration' => array('listed_reply' => '127.0.0.2', 'official_url' => 'https://www.spamhaus.org/zen/', 'policy' => 'Open resolvers are refused; the querying resolver IP must be a registered/allow-listed one.', 'delist_url' => 'https://check.spamhaus.org/')),
            array('provider_key' => 'dnsbl.spamcop', 'label' => 'SpamCop', 'zone' => 'bl.spamcop.net', 'configuration' => array('listed_reply' => '127.0.0.2', 'official_url' => 'https://www.spamcop.net/bl.shtml', 'policy' => 'Queries are rate limited per resolver.', 'delist_url' => 'https://www.spamcop.net/bl.shtml#removal')),
            array('provider_key' => 'dnsbl.barracuda', 'label' => 'Barracuda BRBL', 'zone' => 'b.barracudacentral.org', 'configuration' => array('listed_reply' => '127.0.0.2', 'official_url' => 'https://www.barracudacentral.org/rbl', 'policy' => 'Registration of the querying resolver IP is required.', 'delist_url' => 'https://www.barracudacentral.org/rbl/removal-request')),
            array('provider_key' => 'dnsbl.dronebl', 'label' => 'DroneBL', 'zone' => 'dnsbl.dronebl.org', 'configuration' => array('listed_reply' => '127.0.0.2', 'official_url' => 'https://dronebl.org/', 'policy' => 'Individual listings may be published as a specific 127.0.0.x code; the code is shown when present.', 'delist_url' => 'https://dronebl.org/lookup')),
            array('provider_key' => 'dnsbl.sorbs', 'label' => 'SORBS', 'zone' => 'dnsbl.sorbs.net', 'configuration' => array('listed_reply' => '127.0.0.2', 'official_url' => 'https://www.sorbs.net/', 'policy' => 'Some sub-zones are retired; enable only the zones that still respond.', 'delist_url' => 'https://www.sorbs.net/')),
            array('provider_key' => 'dnsbl.uceprotect', 'label' => 'UCEPROTECT Level 1', 'zone' => 'dnsbl-1.uceprotect.net', 'configuration' => array('listed_reply' => '127.0.0.2', 'official_url' => 'https://www.uceprotect.net/', 'policy' => 'Level 2/3 list whole ranges; only level 1 is offered here.', 'delist_url' => 'https://www.uceprotect.net/en/rblcheck.php')),
            array('provider_key' => 'dnsbl.abuseat', 'label' => 'Abuseat CBL', 'zone' => 'cbl.abuseat.org', 'configuration' => array('listed_reply' => '127.0.0.2', 'official_url' => 'https://www.abuseat.org/', 'policy' => 'Requires a resolver that is not rate limited by the operator.', 'delist_url' => 'https://www.abuseat.org/lookup.cgi')),
            array('provider_key' => 'dnsbl.spfbl', 'label' => 'SPFBL', 'zone' => 'dnsbl.spfbl.net', 'configuration' => array('listed_reply' => '127.0.0.2', 'official_url' => 'https://spfbl.net/', 'policy' => 'Public queries are limited; enable only with a dedicated resolver.', 'delist_url' => 'https://spfbl.net/en/')), 
        );
    }

    public function seed($createdBy = null)
    {
        $created = 0;
        foreach (self::dnsblDefaults() as $entry) {
            if ($this->table(self::TABLE)->where('provider_key', $entry['provider_key'])->exists()) {
                continue;
            }
            $this->table(self::TABLE)->insert(array(
                'provider_key' => $entry['provider_key'],
                'label' => $entry['label'],
                'type' => 'dnsbl',
                'endpoint' => $entry['zone'],
                'configuration_json' => $this->encode($entry['configuration']),
                'enabled' => 0,
                'priority' => 100,
                'timeout_seconds' => 5,
                'rate_limit_per_minute' => 30,
                'health_status' => 'UNKNOWN',
                'created_at' => $this->now(),
                'updated_at' => $this->now(),
            ));
            $created++;
        }
        return $created;
    }

    public function all($onlyEnabled = false, $type = null)
    {
        if (!$this->has(self::TABLE)) {
            return array();
        }
        try {
            $query = $this->table(self::TABLE);
            if ($onlyEnabled) {
                $query = $query->where('enabled', 1);
            }
            if ($type !== null) {
                $query = $query->where('type', (string) $type);
            }
            return $query->orderBy('priority')->orderBy('id')->get()->all();
        } catch (\Throwable $unavailable) {
            return array();
        }
    }

    public function find($id)
    {
        if (!$this->has(self::TABLE)) {
            return null;
        }
        return $this->table(self::TABLE)->where('id', (int) $id)->first();
    }

    public function findByKey($providerKey)
    {
        if (!$this->has(self::TABLE)) {
            return null;
        }
        return $this->table(self::TABLE)->where('provider_key', (string) $providerKey)->first();
    }

    public function configuration($row)
    {
        return $this->decode($row ? $row->configuration_json : null, array());
    }

    public function insert(array $data, $adminId = null)
    {
        $this->table(self::TABLE)->insert(array(
            'provider_key' => substr((string) $data['provider_key'], 0, 96),
            'label' => substr((string) $data['label'], 0, 191),
            'type' => in_array($data['type'], self::types(), true) ? $data['type'] : 'integration',
            'endpoint' => substr((string) (isset($data['endpoint']) ? $data['endpoint'] : ''), 0, 255),
            'configuration_json' => $this->encode($this->configOnly(isset($data['configuration']) ? $data['configuration'] : array())),
            'enabled' => isset($data['enabled']) ? (int) $data['enabled'] : 0,
            'priority' => isset($data['priority']) ? (int) $data['priority'] : 100,
            'timeout_seconds' => isset($data['timeout_seconds']) ? max(1, min(30, (int) $data['timeout_seconds'])) : 5,
            'rate_limit_per_minute' => isset($data['rate_limit_per_minute']) ? max(0, (int) $data['rate_limit_per_minute']) : 30,
            'health_status' => 'UNKNOWN',
            'created_at' => $this->now(),
            'updated_at' => $this->now(),
        ));
        $id = (int) $this->table(self::TABLE)->max('id');
        $this->audit('provider.added', $id, array(), $data, $adminId);
        return $id;
    }

    public function update($id, array $changes, $adminId = null)
    {
        $allowed = array('label', 'type', 'endpoint', 'configuration_json', 'enabled', 'priority', 'timeout_seconds', 'rate_limit_per_minute', 'health_status');
        $update = array();
        foreach ($changes as $key => $value) {
            if (in_array($key, $allowed, true)) {
                $update[$key] = $value;
            }
        }
        if (isset($changes['configuration'])) {
            $update['configuration_json'] = $this->encode($this->configOnly((array) $changes['configuration']));
        }
        if (!$update) {
            return false;
        }
        $update['updated_at'] = $this->now();
        $before = $this->find($id);
        $this->table(self::TABLE)->where('id', (int) $id)->update($update);
        $this->audit('provider.updated', $id, $before ? (array) $before : array(), $update, $adminId);
        return true;
    }

    public function delete($id, $adminId = null)
    {
        $before = $this->find($id);
        $deleted = (bool) $this->table(self::TABLE)->where('id', (int) $id)->delete();
        if ($deleted) {
            $this->audit('provider.removed', $id, $before ? (array) $before : array(), array(), $adminId);
        }
        return $deleted;
    }

    public function recordHealth($id, $status, $detail = '')
    {
        $this->table(self::TABLE)->where('id', (int) $id)->update(array(
            'health_status' => substr((string) $status, 0, 32),
            'last_checked_at' => $this->now(),
            'last_error' => substr((string) $detail, 0, 255),
        ));
    }

    /** Defence in depth: a secret can never be persisted in this table. */
    private function configOnly(array $configuration)
    {
        $blocked = array('password', 'secret', 'token', 'api_key', 'apikey', 'private_key', 'credential', 'passphrase');
        foreach ($configuration as $key => $value) {
            foreach ($blocked as $needle) {
                if (strpos(strtolower((string) $key), $needle) !== false) {
                    unset($configuration[$key]);
                    break;
                }
            }
        }
        return $configuration;
    }

    protected function audit($action, $resourceId, array $before, array $after, $adminId = null)
    {
        if (class_exists('CloudHost247\\Foundation\\Support\\AuditLogger')) {
            \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_network_tools', $action, 'provider', (string) $resourceId,
                $this->redact($before), $this->redact($after), 'success', null, $adminId);
        }
    }
}
