<?php
namespace CloudHost247\Ovh\Normalization;

/**
 * Turns a normalized catalog plan into the eight specification fields the
 * hosting-product editor stores — and says which of them the catalog actually
 * proved.
 *
 * The rule is the module's usual one: a field is only filled from evidence that
 * exists in the payload. A plan without a disk field produces an empty storage
 * value and is listed under `unverified`; nothing is inferred from a plan code,
 * a product name or a neighbouring field.
 */
final class ProductSpecifications
{
    /** The exact keys `HostingProductManager::save()` accepts. */
    const FIELDS = array('cpu', 'ram', 'storage', 'network', 'ipv4', 'ipv6', 'datacenter', 'operating_system');

    const MAX_FIELD = 191;

    /**
     * @param array $normalized Output of `CatalogNormalizer::plan()` (or a saved
     *                          `normalized` block with the same keys).
     * @return array{specifications:array<string,string>,verified:array<string,bool>,unverified:array<int,string>,sources:array<string,string>}
     */
    public function fromPlan(array $normalized)
    {
        $plan = isset($normalized['plan']) && is_array($normalized['plan']) ? $normalized['plan'] : $normalized;

        $fields = array(
            'cpu' => $this->text($this->first($plan, array('cpu'))),
            'ram' => $this->text($this->first($plan, array('ram'))),
            'storage' => $this->text($this->first($plan, array('storage'))),
            'network' => $this->text($this->first($plan, array('network'))),
            'ipv4' => '',
            'ipv6' => '',
            'datacenter' => $this->listText($this->listOf($plan, array('datacenters'))),
            'operating_system' => $this->listText($this->listOf($plan, array('operating_systems'))),
        );

        // IPs are proven by the plan's own address evidence, version by version.
        foreach ($this->addresses($plan) as $address) {
            if ($address['version'] === 4 && $fields['ipv4'] === '') { $fields['ipv4'] = $address['address']; }
            if ($address['version'] === 6 && $fields['ipv6'] === '') { $fields['ipv6'] = $address['address']; }
        }

        $verified = array();
        $unverified = array();
        $sources = array();
        foreach (self::FIELDS as $field) {
            $present = isset($fields[$field]) && trim((string) $fields[$field]) !== '';
            $verified[$field] = $present;
            if (!$present) { $unverified[] = $field; }
            $sources[$field] = $present ? 'catalog' : 'not_verified';
        }

        return array(
            'specifications' => $fields,
            'verified' => $verified,
            'unverified' => $unverified,
            'sources' => $sources,
        );
    }

    private function addresses(array $plan)
    {
        $input = array();
        foreach (array('ipv4', 'ipv6', 'ips', 'addresses') as $key) {
            if (array_key_exists($key, $plan)) { $input[] = $plan[$key]; }
        }
        return $input === array() ? array() : (new IpNormalizer())->normalize($input);
    }

    private function first(array $plan, array $keys)
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $plan) && $plan[$key] !== '' && $plan[$key] !== null) { return $plan[$key]; }
        }
        return null;
    }

    private function listOf(array $plan, array $keys)
    {
        $value = $this->first($plan, $keys);
        if ($value === null) { return array(); }
        if (!is_array($value)) { return array($value); }
        $out = array();
        foreach ($value as $item) {
            if (is_string($item) || is_numeric($item)) { $out[] = (string) $item; }
        }
        return $out;
    }

    private function text($value)
    {
        if ($value === null || is_array($value)) { return ''; }
        return substr(trim(strip_tags((string) $value)), 0, self::MAX_FIELD);
    }

    /**
     * A bounded, human-readable summary; the field is a display string, not a
     * data store, so the list is cut between whole entries and never mid-value.
     */
    private function listText(array $values)
    {
        $clean = array();
        foreach ($values as $value) {
            $value = $this->text($value);
            if ($value !== '' && !in_array($value, $clean, true)) { $clean[] = $value; }
        }
        $out = '';
        foreach ($clean as $value) {
            $candidate = $out === '' ? $value : $out . ', ' . $value;
            if (strlen($candidate) > self::MAX_FIELD) { break; }
            $out = $candidate;
        }
        return $out;
    }
}
