<?php
namespace CloudHost247\Marketing\Repositories;

use CloudHost247\Marketing\Security\InputValidator;
use WHMCS\Database\Capsule;

/**
 * Subscriber tags (SESSION 2).
 *
 * Tags are operator-owned labels: an import can create them, a segment can
 * filter on them, and nothing else may invent one. Keys are normalised through
 * InputValidator::key() so a tag is always safe to render and to match on.
 */
final class TagRepository
{
    const TABLE = 'mod_cloudhost247_marketing_tags';
    const JOIN_TABLE = 'mod_cloudhost247_marketing_subscriber_tags';

    public function all()
    {
        return Capsule::table(self::TABLE)->orderBy('name', 'asc')->get()->all();
    }

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->first();
    }

    public function findByKey($key)
    {
        return Capsule::table(self::TABLE)->where('tag_key', InputValidator::key($key, 'Tag'))->first();
    }

    /** Idempotent: returns the existing tag when the key is already in use. */
    public function ensure($key, $name = '')
    {
        $key = InputValidator::key($key, 'Tag');
        $existing = $this->findByKey($key);
        if ($existing) { return $existing; }
        $now = date('Y-m-d H:i:s');
        $id = Capsule::table(self::TABLE)->insertGetId(array(
            'tag_key' => $key,
            'name' => InputValidator::shortText($name !== '' ? $name : $key, 128, 'Tag name'),
            'created_at' => $now,
            'updated_at' => $now,
        ));
        return $this->find($id);
    }

    /** Ensures every tag in the list exists, returning their ids. */
    public function ensureMany(array $keys, $max = 25)
    {
        $ids = array();
        $seen = 0;
        foreach ($keys as $key) {
            if ($seen++ >= (int) $max) { break; }
            $key = trim((string) $key);
            if ($key === '') { continue; }
            if (!preg_match('/^[a-z0-9][a-z0-9_-]{0,63}$/i', $key)) { continue; } // skip, never throw on import data
            $tag = $this->ensure($key);
            $ids[] = (int) $tag->id;
        }
        return array_values(array_unique($ids));
    }

    public function assign($subscriberId, $tagId)
    {
        $exists = Capsule::table(self::JOIN_TABLE)
            ->where('subscriber_id', (int) $subscriberId)
            ->where('tag_id', (int) $tagId)
            ->exists();
        if ($exists) { return false; }
        Capsule::table(self::JOIN_TABLE)->insert(array(
            'subscriber_id' => (int) $subscriberId,
            'tag_id' => (int) $tagId,
            'assigned_at' => date('Y-m-d H:i:s'),
        ));
        return true;
    }

    public function assignMany($subscriberId, array $tagIds)
    {
        $assigned = 0;
        foreach (array_unique(array_map('intval', $tagIds)) as $tagId) {
            if ($tagId > 0 && $this->assign($subscriberId, $tagId)) { $assigned++; }
        }
        return $assigned;
    }

    public function remove($subscriberId, $tagId)
    {
        return (int) Capsule::table(self::JOIN_TABLE)
            ->where('subscriber_id', (int) $subscriberId)
            ->where('tag_id', (int) $tagId)
            ->delete();
    }

    /** Subscriber ids that carry a tag. */
    public function subscriberIds($tagId)
    {
        $ids = array();
        foreach (Capsule::table(self::JOIN_TABLE)->where('tag_id', (int) $tagId)->get()->all() as $row) {
            $ids[] = (int) $row->subscriber_id;
        }
        return $ids;
    }

    /** Tags carried by one subscriber, with their ids. */
    public function forSubscriber($subscriberId)
    {
        $tagIds = array();
        foreach (Capsule::table(self::JOIN_TABLE)->where('subscriber_id', (int) $subscriberId)->get()->all() as $row) {
            $tagIds[] = (int) $row->tag_id;
        }
        if (!$tagIds) { return array(); }
        return Capsule::table(self::TABLE)->whereIn('id', $tagIds)->orderBy('name', 'asc')->get()->all();
    }

    public function allKeyedById()
    {
        $out = array();
        foreach ($this->all() as $tag) { $out[(int) $tag->id] = $tag; }
        return $out;
    }
}
