<?php
namespace CloudHost247\Builder\Repositories;

use WHMCS\Database\Capsule;

/**
 * The builder activity log.
 *
 * Who changed what, when, from which network, and whether it worked. This sits
 * alongside the foundation audit trail: the audit log is the tamper-evident
 * record, this is the operational history an administrator reads on the page.
 *
 * Metadata is filtered before it is written. Any key that looks like a secret
 * is dropped rather than redacted, so a credential cannot reach this table
 * even by accident, and IP addresses are stored only as a salted hash.
 */
class EventRepository
{
    const TABLE = 'mod_cloudhost247_builder_events';

    const EVENT_TYPES = array(
        'page.create', 'page.update', 'page.draft_saved', 'page.publish', 'page.unpublish',
        'page.schedule', 'page.archive', 'page.delete', 'page.restore', 'page.preview',
        'template.save', 'template.delete', 'template.import', 'template.export',
        'part.create', 'part.update', 'part.publish', 'part.delete',
        'menu.save', 'menu.delete', 'media.upload', 'media.update', 'media.delete',
        'form.save', 'form.delete', 'form.submission', 'settings.update', 'css.update',
    );

    /** Dropped from metadata regardless of value. */
    const SECRET_HINTS = array('password', 'secret', 'token', 'apikey', 'api_key', 'key', 'credential', 'authorization', 'signature');

    public function record($eventType, array $data = array())
    {
        $record = array(
            'event_type' => in_array($eventType, self::EVENT_TYPES, true) ? $eventType : 'settings.update',
            'entity_type' => substr((string) (isset($data['entity_type']) ? $data['entity_type'] : ''), 0, 24),
            'entity_id' => substr((string) (isset($data['entity_id']) ? $data['entity_id'] : ''), 0, 64),
            'summary' => substr((string) (isset($data['summary']) ? $data['summary'] : ''), 0, 300),
            'metadata_json' => json_encode(self::scrub(isset($data['metadata']) && is_array($data['metadata']) ? $data['metadata'] : array())),
            'result' => isset($data['result']) && in_array($data['result'], array('success', 'failure'), true) ? $data['result'] : 'success',
            'admin_id' => isset($data['admin_id']) ? (int) $data['admin_id'] : 0,
            'ip_hash' => self::ipHash(),
            'correlation_id' => substr((string) (isset($data['correlation_id']) ? $data['correlation_id'] : ''), 0, 64),
            'created_at' => date('Y-m-d H:i:s'),
        );
        try {
            return (int) Capsule::table(self::TABLE)->insertGetId($record);
        } catch (\Throwable $unavailable) {
            // Logging must never break a page save.
            return 0;
        }
    }

    public function recent(array $filters = array(), $page = 1, $perPage = 30)
    {
        $query = Capsule::table(self::TABLE);
        if (!empty($filters['event_type'])) { $query->where('event_type', (string) $filters['event_type']); }
        if (!empty($filters['entity_type'])) { $query->where('entity_type', (string) $filters['entity_type']); }
        if (!empty($filters['entity_id'])) { $query->where('entity_id', (string) $filters['entity_id']); }
        $total = (int) $query->count();
        $perPage = max(1, min(200, (int) $perPage));
        $page = max(1, (int) $page);
        $rows = $query->orderBy('id', 'desc')->limit($perPage)->offset(($page - 1) * $perPage)->get();
        $events = array();
        foreach ($rows as $row) {
            $metadata = json_decode(isset($row->metadata_json) ? (string) $row->metadata_json : '', true);
            $events[] = array(
                'id' => (int) $row->id,
                'event_type' => (string) $row->event_type,
                'entity_type' => (string) $row->entity_type,
                'entity_id' => (string) $row->entity_id,
                'summary' => (string) $row->summary,
                'metadata' => is_array($metadata) ? $metadata : array(),
                'result' => (string) $row->result,
                'admin_id' => (int) $row->admin_id,
                'correlation_id' => (string) $row->correlation_id,
                'created_at' => $row->created_at ? (string) $row->created_at : '',
            );
        }
        return array('rows' => $events, 'total' => $total, 'page' => $page, 'per_page' => $perPage);
    }

    /** Remove any value whose key hints at a credential, at any depth. */
    public static function scrub(array $metadata, $depth = 0)
    {
        if ($depth > 4) { return array(); }
        $clean = array();
        foreach ($metadata as $key => $value) {
            $name = strtolower((string) $key);
            $sensitive = false;
            foreach (self::SECRET_HINTS as $hint) {
                if (strpos($name, $hint) !== false) { $sensitive = true; break; }
            }
            if ($sensitive) { continue; }
            if (is_array($value)) { $clean[$key] = self::scrub($value, $depth + 1); continue; }
            if (is_bool($value) || is_int($value) || is_float($value)) { $clean[$key] = $value; continue; }
            if ($value === null) { $clean[$key] = null; continue; }
            $clean[$key] = substr((string) $value, 0, 300);
        }
        return $clean;
    }

    /** Salted hash of the caller's address: enough to correlate, not to identify. */
    public static function ipHash()
    {
        $address = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
        if ($address === '') { return ''; }
        $salt = defined('CH247_BUILDER_IP_SALT') ? (string) constant('CH247_BUILDER_IP_SALT') : 'cloudhost247-builder';
        return hash('sha256', $salt . '|' . $address);
    }
}
