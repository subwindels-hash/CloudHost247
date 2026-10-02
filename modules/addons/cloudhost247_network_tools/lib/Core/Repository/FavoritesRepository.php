<?php
namespace CloudHost247\NetworkTools\Core\Repository;

/**
 * Customer favourites (mod_cloudhost247_nt_favorites = tool_favorites).
 */
final class FavoritesRepository extends Repository
{
    const TABLE = 'favorites';

    public function all($clientId)
    {
        if (!$this->has(self::TABLE)) {
            return array();
        }
        try {
            $rows = $this->table(self::TABLE)->where('client_id', (int) $clientId)->orderBy('tool_slug')->get();
            $slugs = array();
            foreach ($rows as $row) {
                $slugs[] = (string) $row->tool_slug;
            }
            return $slugs;
        } catch (\Throwable $unavailable) {
            return array();
        }
    }

    public function add($clientId, $slug)
    {
        if (!$this->has(self::TABLE)) {
            return false;
        }
        try {
            $this->table(self::TABLE)->updateOrInsert(
                array('client_id' => (int) $clientId, 'tool_slug' => (string) $slug),
                array('updated_at' => $this->now(), 'created_at' => $this->now())
            );
            return true;
        } catch (\Throwable $unavailable) {
            return false;
        }
    }

    public function remove($clientId, $slug)
    {
        if (!$this->has(self::TABLE)) {
            return false;
        }
        return (bool) $this->table(self::TABLE)->where('client_id', (int) $clientId)->where('tool_slug', (string) $slug)->delete();
    }

    public function has($clientId, $slug)
    {
        if (!$this->has(self::TABLE)) {
            return false;
        }
        try {
            return (bool) $this->table(self::TABLE)->where('client_id', (int) $clientId)->where('tool_slug', (string) $slug)->exists();
        } catch (\Throwable $unavailable) {
            return false;
        }
    }
}
