<?php
namespace CloudHost247\NetworkTools\Core\Repository;

/**
 * Managed DNS resolver registry (docs section 66, table dns_resolvers).
 *
 * Resolvers are data, not code: an administrator adds, enables, orders and
 * health-checks them. Each row declares exactly which protocols it is known to
 * answer on, so the propagation checker never claims a protocol a resolver does
 * not support.
 */
final class ResolverRepository extends Repository
{
    const TABLE = 'resolvers';
    const PROTOCOLS = array('udp', 'tcp', 'dot', 'doh');

    /**
     * Shipped defaults: real, public resolvers with their real anycast
     * addresses and documented protocol support. Geo metadata is approximate
     * (anycast networks answer from the nearest point of presence) and is
     * labelled as such in the UI.
     */
    public static function defaults()
    {
        return array(
            array('name' => 'Google Public DNS', 'provider' => 'Google', 'ip_address' => '8.8.8.8', 'protocol' => 'udp', 'version' => 'v4', 'country_code' => 'US', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 37.7510, 'longitude' => -97.8220, 'priority' => 10, 'endpoint' => ''),
            array('name' => 'Google Public DNS (secondary)', 'provider' => 'Google', 'ip_address' => '8.8.4.4', 'protocol' => 'udp', 'version' => 'v4', 'country_code' => 'US', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 37.7510, 'longitude' => -97.8220, 'priority' => 20, 'endpoint' => ''),
            array('name' => 'Cloudflare 1.1.1.1', 'provider' => 'Cloudflare', 'ip_address' => '1.1.1.1', 'protocol' => 'udp', 'version' => 'v4', 'country_code' => 'US', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 37.7510, 'longitude' => -97.8220, 'priority' => 30, 'endpoint' => ''),
            array('name' => 'Cloudflare 1.0.0.1', 'provider' => 'Cloudflare', 'ip_address' => '1.0.0.1', 'protocol' => 'udp', 'version' => 'v4', 'country_code' => 'US', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 37.7510, 'longitude' => -97.8220, 'priority' => 40, 'endpoint' => ''),
            array('name' => 'Quad9', 'provider' => 'Quad9', 'ip_address' => '9.9.9.9', 'protocol' => 'udp', 'version' => 'v4', 'country_code' => 'CH', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 46.8182, 'longitude' => 8.2275, 'priority' => 50, 'endpoint' => ''),
            array('name' => 'OpenDNS', 'provider' => 'Cisco OpenDNS', 'ip_address' => '208.67.222.222', 'protocol' => 'udp', 'version' => 'v4', 'country_code' => 'US', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 37.7510, 'longitude' => -97.8220, 'priority' => 60, 'endpoint' => ''),
            array('name' => 'AdGuard DNS', 'provider' => 'AdGuard', 'ip_address' => '94.140.14.14', 'protocol' => 'udp', 'version' => 'v4', 'country_code' => 'CY', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 35.1264, 'longitude' => 33.4299, 'priority' => 70, 'endpoint' => ''),
            array('name' => 'DNS0.eu', 'provider' => 'DNS0.eu', 'ip_address' => '193.110.81.0', 'protocol' => 'udp', 'version' => 'v4', 'country_code' => 'EU', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 50.8503, 'longitude' => 4.3517, 'priority' => 80, 'endpoint' => ''),
            array('name' => 'Comodo Secure DNS', 'provider' => 'Comodo', 'ip_address' => '8.26.56.26', 'protocol' => 'udp', 'version' => 'v4', 'country_code' => 'US', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 37.7510, 'longitude' => -97.8220, 'priority' => 90, 'endpoint' => ''),
            array('name' => 'Yandex DNS', 'provider' => 'Yandex', 'ip_address' => '77.88.8.8', 'protocol' => 'udp', 'version' => 'v4', 'country_code' => 'RU', 'region' => 'Moscow', 'city' => 'Moscow', 'latitude' => 55.7558, 'longitude' => 37.6173, 'priority' => 100, 'endpoint' => ''),
            array('name' => 'Cloudflare DNS over TLS', 'provider' => 'Cloudflare', 'ip_address' => '1.1.1.1', 'protocol' => 'dot', 'version' => 'v4', 'country_code' => 'US', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 37.7510, 'longitude' => -97.8220, 'priority' => 110, 'endpoint' => 'cloudflare-dns.com'),
            array('name' => 'Google DNS over TLS', 'provider' => 'Google', 'ip_address' => '8.8.8.8', 'protocol' => 'dot', 'version' => 'v4', 'country_code' => 'US', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 37.7510, 'longitude' => -97.8220, 'priority' => 120, 'endpoint' => 'dns.google'),
            array('name' => 'Cloudflare DNS over HTTPS', 'provider' => 'Cloudflare', 'ip_address' => '1.1.1.1', 'protocol' => 'doh', 'version' => 'v4', 'country_code' => 'US', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 37.7510, 'longitude' => -97.8220, 'priority' => 130, 'endpoint' => 'https://cloudflare-dns.com/dns-query'),
            array('name' => 'Google DNS over HTTPS', 'provider' => 'Google', 'ip_address' => '8.8.8.8', 'protocol' => 'doh', 'version' => 'v4', 'country_code' => 'US', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 37.7510, 'longitude' => -97.8220, 'priority' => 140, 'endpoint' => 'https://dns.google/dns-query'),
            array('name' => 'Cloudflare IPv6', 'provider' => 'Cloudflare', 'ip_address' => '2606:4700:4700::1111', 'protocol' => 'udp', 'version' => 'v6', 'country_code' => 'US', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 37.7510, 'longitude' => -97.8220, 'priority' => 150, 'endpoint' => ''),
            array('name' => 'Google IPv6', 'provider' => 'Google', 'ip_address' => '2001:4860:4860::8888', 'protocol' => 'udp', 'version' => 'v6', 'country_code' => 'US', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 37.7510, 'longitude' => -97.8220, 'priority' => 160, 'endpoint' => ''),
            array('name' => 'Quad9 IPv6', 'provider' => 'Quad9', 'ip_address' => '2620:fe::fe', 'protocol' => 'udp', 'version' => 'v6', 'country_code' => 'CH', 'region' => 'Anycast', 'city' => 'Global anycast', 'latitude' => 46.8182, 'longitude' => 8.2275, 'priority' => 170, 'endpoint' => ''),
        );
    }

    public function seed($adminId = null)
    {
        $created = 0;
        foreach (self::defaults() as $resolver) {
            if ($this->table(self::TABLE)->where('ip_address', $resolver['ip_address'])->where('protocol', $resolver['protocol'])->exists()) {
                continue;
            }
            $this->insert($resolver, $adminId);
            $created++;
        }
        return $created;
    }

    public function insert(array $data, $adminId = null)
    {
        $this->table(self::TABLE)->insert(array(
            'name' => substr((string) $data['name'], 0, 128),
            'provider' => substr((string) $data['provider'], 0, 96),
            'ip_address' => substr((string) $data['ip_address'], 0, 45),
            'protocol' => in_array($data['protocol'], self::PROTOCOLS, true) ? $data['protocol'] : 'udp',
            'version' => $data['version'] === 'v6' ? 'v6' : 'v4',
            'country_code' => substr((string) (isset($data['country_code']) ? $data['country_code'] : ''), 0, 8),
            'region' => substr((string) (isset($data['region']) ? $data['region'] : ''), 0, 96),
            'city' => substr((string) (isset($data['city']) ? $data['city'] : ''), 0, 96),
            'latitude' => isset($data['latitude']) ? (float) $data['latitude'] : null,
            'longitude' => isset($data['longitude']) ? (float) $data['longitude'] : null,
            'endpoint' => substr((string) (isset($data['endpoint']) ? $data['endpoint'] : ''), 0, 255),
            'enabled' => isset($data['enabled']) ? (int) $data['enabled'] : 1,
            'priority' => isset($data['priority']) ? (int) $data['priority'] : 100,
            'health_status' => 'UNKNOWN',
            'last_checked_at' => null,
            'created_at' => $this->now(),
            'updated_at' => $this->now(),
        ));
        $id = (int) $this->table(self::TABLE)->max('id');
        if (class_exists('CloudHost247\\Foundation\\Support\\AuditLogger')) {
            \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_network_tools', 'resolver.added', 'resolver', (string) $id, array(), array(
                'name' => $data['name'], 'ip_address' => $data['ip_address'], 'protocol' => $data['protocol'],
            ), 'success', null, $adminId);
        }
        return $id;
    }

    public function all($onlyEnabled = false, $protocols = null)
    {
        if (!$this->has(self::TABLE)) {
            return array();
        }
        $query = $this->table(self::TABLE);
        if ($onlyEnabled) {
            $query = $query->where('enabled', 1);
        }
        if (is_array($protocols) && $protocols) {
            $query = $query->whereIn('protocol', $protocols);
        }
        try {
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

    public function update($id, array $changes, $adminId = null)
    {
        $allowed = array('name', 'provider', 'ip_address', 'protocol', 'version', 'country_code', 'region', 'city', 'latitude', 'longitude', 'endpoint', 'enabled', 'priority', 'health_status');
        $update = array();
        foreach ($changes as $key => $value) {
            if (in_array($key, $allowed, true)) {
                $update[$key] = $value;
            }
        }
        if (!$update) {
            return false;
        }
        $update['updated_at'] = $this->now();
        $before = $this->find($id);
        $this->table(self::TABLE)->where('id', (int) $id)->update($update);
        if (class_exists('CloudHost247\\Foundation\\Support\\AuditLogger')) {
            \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_network_tools', 'resolver.updated', 'resolver', (string) $id,
                $before ? (array) $before : array(), $update, 'success', null, $adminId);
        }
        return true;
    }

    public function delete($id, $adminId = null)
    {
        $before = $this->find($id);
        $deleted = (bool) $this->table(self::TABLE)->where('id', (int) $id)->delete();
        if ($deleted && class_exists('CloudHost247\\Foundation\\Support\\AuditLogger')) {
            \CloudHost247\Foundation\Support\AuditLogger::record('cloudhost247_network_tools', 'resolver.removed', 'resolver', (string) $id,
                $before ? (array) $before : array(), array(), 'success', null, $adminId);
        }
        return $deleted;
    }

    public function recordHealth($id, $status, $latencyMs, $error = '')
    {
        $this->table(self::TABLE)->where('id', (int) $id)->update(array(
            'health_status' => substr((string) $status, 0, 32),
            'last_checked_at' => $this->now(),
            'last_latency_ms' => $latencyMs === null ? null : (int) $latencyMs,
            'last_error' => substr((string) $error, 0, 255),
        ));
    }
}
