<?php
namespace CloudHost247\Ovh\Normalization;

/**
 * Extracts the *selectable values* of a discovered OVH catalog option.
 *
 * OVH catalog payloads describe options in several shapes and the shapes differ
 * per family and region, so this class recognises a small, explicit set of them
 * and refuses everything else. A refusal is the honest answer: the admin screen
 * then shows "value list not verified" and the operator enters the API-supported
 * label by hand instead of the module inventing a value that OVH would reject.
 *
 * Recognised shapes:
 *   - a flat list of scalars                 ["linux","windows"]
 *   - a list of objects with a name/label    [{name:"Debian 12", planCode:"debian12"}]
 *   - a key => label map                     {"linux":"Linux","windows":"Windows"}
 *
 * Anything else — nested objects, mixed scalars and objects, an empty list — is
 * reported as unverified rather than flattened.
 */
final class OptionValueExtractor
{
    const MAX_VALUES = 64;
    const MAX_LABEL = 255;

    /**
     * @return array{status:string,values:array<int,array{key:string,label:string}>,reason:string}
     *         status is `resolved`, `unverified` or `empty`.
     */
    public function values($value)
    {
        if (is_string($value) || is_numeric($value)) {
            $scalar = $this->scalarize($value);
            return $scalar === ''
                ? $this->result('empty', array(), 'The stored option has no value.')
                : $this->result('resolved', array(array('key' => $scalar, 'label' => $scalar)), '');
        }
        if (!is_array($value)) {
            return $this->result('unverified', array(), 'The stored option value is not a list or a map.');
        }
        if ($value === array()) {
            return $this->result('empty', array(), 'The stored option has no values.');
        }

        $associative = $this->isAssociative($value);
        $values = array();
        $recognised = 0;
        foreach ($value as $key => $entry) {
            if (is_array($entry)) {
                $label = $this->labelFromObject($entry);
                if ($label === '') { continue; }
                $identity = $this->identityFromObject($entry, $label);
                $values[] = array('key' => $identity, 'label' => $label);
                $recognised++;
                continue;
            }
            if (is_string($entry) || is_numeric($entry)) {
                $label = $this->scalarize($entry);
                if ($label === '') { continue; }
                $values[] = array('key' => $associative && is_string($key) ? $key : $label, 'label' => $label);
                $recognised++;
                continue;
            }
            // Objects of any other type make the whole shape untrustworthy.
            return $this->result('unverified', array(), 'The stored option mixes value shapes.');
        }

        if ($recognised === 0) {
            return $this->result('unverified', array(), 'No value in the stored option carries a usable label.');
        }
        if ($recognised !== $this->countable($value)) {
            return $this->result('unverified', array(), 'The stored option lists entries without a usable label.');
        }

        return $this->result('resolved', array_slice($this->dedupe($values), 0, self::MAX_VALUES), '');
    }

    /**
     * A batch convenience for the catalog sync: one call per stored option.
     *
     * @param array<int,array{id:mixed,label:string,value:mixed}> $options
     */
    public function forOptions(array $options)
    {
        $out = array();
        foreach ($options as $option) {
            $extracted = $this->values(isset($option['value']) ? $option['value'] : null);
            $out[] = array(
                'option_id' => isset($option['id']) ? (int) $option['id'] : 0,
                'option_label' => (string) (isset($option['label']) ? $option['label'] : ''),
                'status' => $extracted['status'],
                'reason' => $extracted['reason'],
                'values' => $extracted['values'],
            );
        }
        return $out;
    }

    /** Only a scalar with a `name`, `label`, `planCode`, `code` or `value` field is a value. */
    private function labelFromObject(array $entry)
    {
        foreach (array('label', 'name', 'planCode', 'code', 'value') as $key) {
            if (!array_key_exists($key, $entry)) { continue; }
            if (is_string($entry[$key]) || is_numeric($entry[$key])) {
                $label = $this->scalarize($entry[$key]);
                if ($label !== '') { return $label; }
            }
        }
        return '';
    }

    /** The stable half of an object value: a code when there is one, else the label. */
    private function identityFromObject(array $entry, $label)
    {
        foreach (array('planCode', 'code', 'value', 'id') as $key) {
            if (array_key_exists($key, $entry) && (is_string($entry[$key]) || is_numeric($entry[$key]))) {
                $identity = $this->scalarize($entry[$key]);
                if ($identity !== '') { return $identity; }
            }
        }
        return $label;
    }

    private function isAssociative(array $value)
    {
        $expected = 0;
        foreach (array_keys($value) as $key) {
            if ($key !== $expected) { return true; }
            $expected++;
        }
        return false;
    }

    /** Entries this class is willing to look at at all. */
    private function countable(array $value)
    {
        $count = 0;
        foreach ($value as $entry) {
            if (is_array($entry) || is_string($entry) || is_numeric($entry)) { $count++; }
        }
        return $count;
    }

    private function dedupe(array $values)
    {
        $seen = array();
        $out = array();
        foreach ($values as $value) {
            $key = preg_replace('/[^a-z0-9]/', '', strtolower($value['key']));
            if ($key === '' || isset($seen[$key])) { continue; }
            $seen[$key] = true;
            $out[] = $value;
        }
        return $out;
    }

    private function scalarize($value)
    {
        return substr(trim(strip_tags((string) $value)), 0, self::MAX_LABEL);
    }

    private function result($status, array $values, $reason)
    {
        return array('status' => $status, 'values' => $values, 'reason' => $reason);
    }
}
