<?php
namespace CloudHost247\Smm\Services;

/**
 * Pure catalog merge: decides adds/updates/deactivations by diffing the
 * provider's fetched service list against the stored catalog. No database
 * access, which makes the diff rules directly testable.
 *
 * Policy: rows missing from the provider response are NEVER deleted — they
 * are marked unavailable so order history keeps its references.
 */
final class CatalogSync
{
    const COMPARE_FIELDS = array('name', 'category', 'description', 'type', 'min_quantity', 'max_quantity', 'rate', 'currency', 'refill', 'cancel', 'provider_status');

    /**
     * @param array $fetched  normalized rows from the adapter (provider_service_id keys)
     * @param array $existing stored rows (objects/arrays with provider_service_id, available)
     * @return array array('add' => rows, 'update' => array(id => changed fields),
     *                     'deactivate' => local ids, 'unchanged' => int)
     */
    public static function merge(array $fetched, array $existing)
    {
        $existingById = array();
        foreach ($existing as $row) {
            $existingById[(string) (is_array($row) ? $row['provider_service_id'] : $row->provider_service_id)] = $row;
        }
        $add = array();
        $update = array();
        $deactivate = array();
        $unchanged = 0;
        foreach ($fetched as $row) {
            $pid = (string) $row['provider_service_id'];
            if (!isset($existingById[$pid])) {
                $add[] = $row;
                continue;
            }
            $current = $existingById[$pid];
            $changed = array();
            foreach (self::COMPARE_FIELDS as $field) {
                $old = is_array($current) ? (isset($current[$field]) ? $current[$field] : null) : (isset($current->$field) ? $current->$field : null);
                $new = array_key_exists($field, $row) ? $row[$field] : null;
                if (!self::same($old, $new)) {
                    $changed[$field] = $new;
                }
            }
            $wasAvailable = (int) (is_array($current) ? $current['available'] : $current->available);
            if ($changed !== array() || $wasAvailable !== 1) {
                $localId = (int) (is_array($current) ? $current['id'] : $current->id);
                $changed['available'] = 1;
                $changed['last_seen_at'] = date('Y-m-d H:i:s');
                $update[$localId] = $changed;
            } else {
                $unchanged++;
            }
            unset($existingById[$pid]);
        }
        foreach ($existingById as $row) {
            $available = (int) (is_array($row) ? $row['available'] : $row->available);
            if ($available === 1) {
                $deactivate[] = (int) (is_array($row) ? $row['id'] : $row->id);
            }
        }
        return array('add' => $add, 'update' => $update, 'deactivate' => $deactivate, 'unchanged' => $unchanged);
    }

    private static function same($a, $b)
    {
        if ($a === null || $b === null) {
            return $a === $b || ($a === '' && $b === null) || ($a === null && $b === '');
        }
        if (is_bool($a) || is_bool($b)) {
            return (bool) $a === (bool) $b;
        }
        if (is_numeric($a) && is_numeric($b)) {
            return (float) $a === (float) $b;
        }
        return (string) $a === (string) $b;
    }
}
