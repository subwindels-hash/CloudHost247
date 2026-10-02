<?php
namespace CloudHost247\NetworkTools\Core\Repository;

/**
 * Controlled response cache (docs section 67).
 *
 * Only public diagnostic answers are cached (DNS lookups, WHOIS, ASN,
 * geolocation, SSL, HTTP headers) — never a credential, never a per-user
 * payload, and never a signed URL. TTLs come from the tool definition and can
 * be overridden per tool by an administrator.
 */
final class CacheRepository extends Repository
{
    const TABLE = 'cache';

    public function get($key)
    {
        if (!$this->has(self::TABLE)) {
            return null;
        }
        try {
            $row = $this->table(self::TABLE)->where('cache_key', $this->key($key))->first();
            if (!$row) {
                return null;
            }
            if (strtotime((string) $row->expires_at) < time()) {
                $this->forget($key);
                return null;
            }
            $decoded = json_decode((string) $row->payload_json, true);
            return is_array($decoded) ? $decoded : null;
        } catch (\Throwable $unavailable) {
            return null;
        }
    }

    public function put($key, array $payload, $ttlSeconds)
    {
        $ttlSeconds = (int) $ttlSeconds;
        if ($ttlSeconds <= 0 || !$this->has(self::TABLE)) {
            return false;
        }
        try {
            $this->table(self::TABLE)->updateOrInsert(
                array('cache_key' => $this->key($key)),
                array(
                    'payload_json' => $this->encode($payload),
                    'expires_at' => date('Y-m-d H:i:s', time() + $ttlSeconds),
                    'created_at' => $this->now(),
                )
            );
            if (random_int(1, 40) === 1) {
                $this->table(self::TABLE)->where('expires_at', '<', $this->now())->delete();
            }
            return true;
        } catch (\Throwable $unavailable) {
            return false;
        }
    }

    public function forget($key)
    {
        if (!$this->has(self::TABLE)) {
            return false;
        }
        return (bool) $this->table(self::TABLE)->where('cache_key', $this->key($key))->delete();
    }

    public function flush()
    {
        if (!$this->has(self::TABLE)) {
            return 0;
        }
        return (int) $this->table(self::TABLE)->delete();
    }

    public function size()
    {
        if (!$this->has(self::TABLE)) {
            return 0;
        }
        try {
            return (int) $this->table(self::TABLE)->count();
        } catch (\Throwable $unavailable) {
            return 0;
        }
    }

    public function key($key)
    {
        return substr(hash('sha256', 'cloudhost247-nt|' . (string) $key), 0, 64);
    }
}
