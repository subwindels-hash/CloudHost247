<?php
namespace CloudHost247\Marketing\Repositories;

use CloudHost247\Marketing\Security\InputValidator;
use WHMCS\Database\Capsule;

/**
 * Segment store (requirement #8).
 *
 * A segment row holds a name plus the canonical rule definition. It stores no
 * membership rows at all: membership is recomputed on every evaluation, so a
 * customer who buys hosting today is in "active customers" tomorrow without a
 * sync job. The only cached value is a count, clearly timestamped, used for the
 * admin list — never for sending.
 */
final class SegmentRepository
{
    const TABLE = 'mod_cloudhost247_marketing_segments';
    const STATUSES = array('active', 'archived');

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->first();
    }

    public function findByKey($key)
    {
        return Capsule::table(self::TABLE)->where('segment_key', InputValidator::key($key, 'Segment key'))->first();
    }

    public function all($status = null)
    {
        $query = Capsule::table(self::TABLE);
        if ($status !== null) { $query->where('status', (string) $status); }
        return $query->orderBy('name', 'asc')->get()->all();
    }

    public function count($status = null)
    {
        $query = Capsule::table(self::TABLE);
        if ($status !== null) { $query->where('status', (string) $status); }
        $row = $query->selectRaw('COUNT(*) AS aggregate')->first();
        return $row ? (int) $row->aggregate : 0;
    }

    /**
     * @param array $input keys: segment_key, name, description, definition (array), status
     */
    public function create(array $input)
    {
        $key = InputValidator::key(isset($input['segment_key']) ? $input['segment_key'] : '', 'Segment key');
        if ($this->findByKey($key)) { throw new \InvalidArgumentException('A segment with that key already exists.'); }
        $now = date('Y-m-d H:i:s');
        $id = Capsule::table(self::TABLE)->insertGetId(array(
            'segment_key' => $key,
            'name' => InputValidator::shortText(isset($input['name']) ? $input['name'] : '', 128, 'Segment name'),
            'description' => InputValidator::shortText(isset($input['description']) ? $input['description'] : '', 255, 'Description'),
            'definition_json' => json_encode($input['definition']),
            'status' => 'active',
            'cached_count' => null,
            'cached_at' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ));
        return $this->find($id);
    }

    public function update($id, array $input)
    {
        $segment = $this->find($id);
        if (!$segment) { throw new \InvalidArgumentException('Unknown segment.'); }
        $updates = array('updated_at' => date('Y-m-d H:i:s'));
        if (isset($input['name'])) { $updates['name'] = InputValidator::shortText($input['name'], 128, 'Segment name'); }
        if (isset($input['description'])) { $updates['description'] = InputValidator::shortText($input['description'], 255, 'Description'); }
        if (isset($input['definition'])) {
            $updates['definition_json'] = json_encode($input['definition']);
            // A changed definition invalidates the cached count immediately; a
            // stale number next to a new rule set would be a lie.
            $updates['cached_count'] = null;
            $updates['cached_at'] = null;
        }
        if (isset($input['status'])) {
            $status = (string) $input['status'];
            if (!in_array($status, self::STATUSES, true)) { throw new \InvalidArgumentException('Unknown segment status.'); }
            $updates['status'] = $status;
        }
        Capsule::table(self::TABLE)->where('id', (int) $segment->id)->update($updates);
        return $this->find((int) $segment->id);
    }

    public function archive($id) { return $this->update($id, array('status' => 'archived')); }

    public function activate($id) { return $this->update($id, array('status' => 'active')); }

    /** Records a freshly evaluated count. Only ever called with a real evaluation. */
    public function cacheCount($id, $count)
    {
        $segment = $this->find($id);
        if (!$segment) { throw new \InvalidArgumentException('Unknown segment.'); }
        Capsule::table(self::TABLE)->where('id', (int) $segment->id)->update(array(
            'cached_count' => max(0, (int) $count),
            'cached_at' => date('Y-m-d H:i:s'),
        ));
        return $this->find((int) $segment->id);
    }

    /** @return array rule definition, or an empty definition when unreadable */
    public static function definitionOf($segment)
    {
        if (!$segment || !isset($segment->definition_json)) { return array('match' => 'all', 'rules' => array()); }
        $decoded = json_decode((string) $segment->definition_json, true);
        return is_array($decoded) ? $decoded : array('match' => 'all', 'rules' => array());
    }
}
