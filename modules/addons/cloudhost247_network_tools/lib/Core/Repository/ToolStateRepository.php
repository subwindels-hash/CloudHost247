<?php
namespace CloudHost247\NetworkTools\Core\Repository;

/**
 * Administrator-controlled state for every registered tool
 * (mod_cloudhost247_nt_tools = tool_definitions).
 *
 * The registry in code is the catalogue (slug, category, description, handler,
 * inputs); this table stores only what an administrator may change: status,
 * visibility, rate tier/overrides, timeout, cache duration, provider binding
 * and a redacted configuration blob. Tools are seeded on activation and on
 * upgrade so the registry can grow without a data migration.
 */
final class ToolStateRepository extends Repository
{
    const TABLE = 'tools';

    /** @var array|null */
    private $cache;

    public function seed(array $definitions, $adminId = null)
    {
        $created = 0;
        foreach ($definitions as $slug => $definition) {
            if ($this->table(self::TABLE)->where('slug', $slug)->exists()) {
                continue;
            }
            $this->table(self::TABLE)->insert(array(
                'slug' => $slug,
                'name' => substr((string) $definition['name'], 0, 191),
                'category' => substr((string) $definition['category'], 0, 32),
                'description' => substr((string) $definition['description'], 0, 500),
                'status' => 'ACTIVE',
                'visibility' => (string) $definition['visibility'],
                'rate_tier' => (string) $definition['rate_tier'],
                'rate_limits_json' => null,
                'timeout_seconds' => (int) $definition['timeout_seconds'],
                'cache_seconds' => (int) $definition['cache_seconds'],
                'provider_keys' => implode(',', (array) $definition['providers']),
                'configuration_json' => null,
                'created_at' => $this->now(),
                'updated_at' => $this->now(),
            ));
            $created++;
        }
        return $created;
    }

    public function states()
    {
        if ($this->cache !== null) {
            return $this->cache;
        }
        $states = array();
        if ($this->has(self::TABLE)) {
            try {
                foreach ($this->table(self::TABLE)->get() as $row) {
                    $states[$row->slug] = $row;
                }
            } catch (\Throwable $unavailable) {
                $states = array();
            }
        }
        $this->cache = $states;
        return $states;
    }

    public function find($slug)
    {
        $states = $this->states();
        return isset($states[$slug]) ? $states[$slug] : null;
    }

    public function update($slug, array $changes, $adminId = null)
    {
        $allowed = array('status', 'visibility', 'rate_tier', 'rate_limits_json', 'timeout_seconds', 'cache_seconds', 'provider_keys', 'configuration_json');
        $update = array();
        $before = $this->find($slug);
        foreach ($changes as $key => $value) {
            if (in_array($key, $allowed, true)) {
                $update[$key] = $value;
            }
        }
        if (!$update) {
            return false;
        }
        $update['updated_at'] = $this->now();
        $this->cache = null;
        $this->table(self::TABLE)->where('slug', $slug)->update($update);
        $after = $this->find($slug);
        $beforeArray = $before ? (array) $before : array();
        $afterArray = $after ? (array) $after : array();
        if (class_exists('CloudHost247\\Foundation\\Support\\AuditLogger')) {
            \CloudHost247\Foundation\Support\AuditLogger::record(
                'cloudhost247_network_tools', 'tool.updated', 'tool', (string) $slug,
                $this->redact($beforeArray), $this->redact($afterArray), 'success', null, $adminId
            );
        }
        return true;
    }

    public function setStatus($slug, $status, $adminId = null)
    {
        return $this->update($slug, array('status' => (string) $status), $adminId);
    }

    public function overrides($slug)
    {
        $row = $this->find($slug);
        if (!$row) {
            return array();
        }
        $limits = $this->decode($row->rate_limits_json, array());
        return array(
            'rate_limits' => $limits,
            'timeout_seconds' => $row->timeout_seconds !== null ? (int) $row->timeout_seconds : null,
            'cache_seconds' => $row->cache_seconds !== null ? (int) $row->cache_seconds : null,
            'configuration' => $this->decode($row->configuration_json, array()),
        );
    }

    public function countsByStatus()
    {
        $counts = array();
        foreach ($this->states() as $row) {
            $counts[$row->status] = isset($counts[$row->status]) ? $counts[$row->status] + 1 : 1;
        }
        return $counts;
    }
}
