<?php
namespace CloudHost247\Marketing\Repositories;

use CloudHost247\Marketing\Security\InputValidator;
use WHMCS\Database\Capsule;

/**
 * Mailing lists (requirement #4).
 *
 * A list is a named membership set. Lists are archived, never deleted, because
 * a campaign's recipient rows and analytics refer to the membership that
 * existed when it was sent — deleting the list would silently rewrite history.
 */
final class ListRepository
{
    const TABLE = 'mod_cloudhost247_marketing_lists';
    const MEMBERS_TABLE = 'mod_cloudhost247_marketing_list_members';

    public function all($status = null)
    {
        $query = Capsule::table(self::TABLE);
        if ($status !== null) { $query->where('status', (string) $status); }
        return $query->orderBy('name', 'asc')->get()->all();
    }

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->first();
    }

    public function findByKey($key)
    {
        return Capsule::table(self::TABLE)->where('list_key', InputValidator::key($key, 'List key'))->first();
    }

    public function create($key, $name, $description = '')
    {
        $key = InputValidator::key($key, 'List key');
        if ($this->findByKey($key)) { throw new \InvalidArgumentException('A list with that key already exists.'); }
        $now = date('Y-m-d H:i:s');
        $id = Capsule::table(self::TABLE)->insertGetId(array(
            'list_key' => $key,
            'name' => InputValidator::shortText($name, 128, 'List name'),
            'description' => InputValidator::shortText($description, 255, 'Description'),
            'status' => 'active',
            'created_at' => $now,
            'updated_at' => $now,
        ));
        return $this->find($id);
    }

    public function update($id, array $data)
    {
        $list = $this->find($id);
        if (!$list) { throw new \InvalidArgumentException('Unknown list.'); }
        $updates = array('updated_at' => date('Y-m-d H:i:s'));
        if (isset($data['name'])) { $updates['name'] = InputValidator::shortText($data['name'], 128, 'List name'); }
        if (isset($data['description'])) { $updates['description'] = InputValidator::shortText($data['description'], 255, 'Description'); }
        if (isset($data['status'])) {
            $status = (string) $data['status'];
            if (!in_array($status, array('active', 'archived'), true)) { throw new \InvalidArgumentException('Unknown list status.'); }
            $updates['status'] = $status;
        }
        Capsule::table(self::TABLE)->where('id', (int) $list->id)->update($updates);
        return $this->find((int) $list->id);
    }

    public function archive($id) { return $this->update($id, array('status' => 'archived')); }

    /** Adds subscribers to a list. Returns how many memberships were created. */
    public function addMembers($listId, array $subscriberIds)
    {
        $list = $this->find($listId);
        if (!$list) { throw new \InvalidArgumentException('Unknown list.'); }
        $added = 0;
        $now = date('Y-m-d H:i:s');
        foreach (array_unique(array_map('intval', $subscriberIds)) as $subscriberId) {
            if ($subscriberId <= 0) { continue; }
            $exists = Capsule::table(self::MEMBERS_TABLE)->where('list_id', (int) $list->id)->where('subscriber_id', $subscriberId)->exists();
            if ($exists) { continue; }
            Capsule::table(self::MEMBERS_TABLE)->insert(array(
                'list_id' => (int) $list->id,
                'subscriber_id' => $subscriberId,
                'added_at' => $now,
            ));
            $added++;
        }
        return $added;
    }

    public function removeMember($listId, $subscriberId)
    {
        return (int) Capsule::table(self::MEMBERS_TABLE)
            ->where('list_id', (int) $listId)
            ->where('subscriber_id', (int) $subscriberId)
            ->delete();
    }

    public function memberCount($listId)
    {
        $row = Capsule::table(self::MEMBERS_TABLE)->where('list_id', (int) $listId)->selectRaw('COUNT(*) AS aggregate')->first();
        return $row ? (int) $row->aggregate : 0;
    }

    /** List ids one subscriber belongs to. */
    public function idsForSubscriber($subscriberId)
    {
        $rows = Capsule::table(self::MEMBERS_TABLE)->where('subscriber_id', (int) $subscriberId)->get();
        $ids = array();
        foreach ($rows ? $rows->all() : array() as $row) { $ids[] = (int) $row->list_id; }
        return $ids;
    }

    public function forSubscriber($subscriberId)
    {
        $ids = $this->idsForSubscriber($subscriberId);
        if (!$ids) { return array(); }
        return Capsule::table(self::TABLE)->whereIn('id', $ids)->orderBy('name', 'asc')->get()->all();
    }

    /** Every active list, keyed by id — used by the subscriber admin screen. */
    public function activeKeyedById()
    {
        $out = array();
        foreach ($this->all('active') as $list) { $out[(int) $list->id] = $list; }
        return $out;
    }
}
