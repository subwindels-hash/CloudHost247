<?php
namespace CloudHost247\Ovh\Catalog;

/**
 * Pure matching between discovered OVH catalog options and existing WHMCS
 * configurable options.
 *
 * Deliberately DB-free and decision-free: it reports what matched exactly, what
 * is ambiguous, and what could not be verified. The caller decides what to write,
 * and nothing here ever proposes a "close enough" pairing — a fuzzy match in a
 * configurable option becomes a wrong price on a live order.
 *
 * Matching is by normalization (case, spaces, punctuation removed), because OVH
 * writes `Windows Server 2022` where WHMCS operators write `windows_server_2022`.
 */
final class DiscoveredOptionMatcher
{
    /**
     * @param array $discovered     array<int,array{id:mixed,label:string,option_type:string,status:string,values:array}>
     *                              where `status` is the OptionValueExtractor verdict
     *                              for the option's value list.
     * @param array $whmcsOptions   array<int,array{id:mixed,name:string}>
     * @param array $whmcsSuboptions array<int,array{id:mixed,configid:mixed,name:string}>
     * @return array<int,array>
     */
    public function match(array $discovered, array $whmcsOptions, array $whmcsSuboptions)
    {
        $options = array();
        foreach ($whmcsOptions as $option) {
            $options[] = array('id' => (int) $option['id'], 'name' => (string) $option['name']);
        }
        $suboptions = array();
        foreach ($whmcsSuboptions as $suboption) {
            // Callers pass either a raw WHMCS row (`configid`) or an already
            // normalized entry (`option_id`); accept both rather than guess wrong.
            $suboptions[] = array(
                'id' => (int) $suboption['id'],
                'option_id' => (int) (isset($suboption['option_id']) ? $suboption['option_id'] : (isset($suboption['configid']) ? $suboption['configid'] : 0)),
                'name' => (string) $suboption['name'],
            );
        }

        $out = array();
        foreach ($discovered as $option) {
            $label = (string) (isset($option['label']) ? $option['label'] : '');
            $normalized = $this->normalize($label);
            $matches = array();
            if ($normalized !== '') {
                foreach ($options as $candidate) {
                    if ($this->normalize($candidate['name']) === $normalized) { $matches[] = $candidate; }
                }
            }

            $values = $this->valueMatches($option, $matches, $suboptions);
            $out[] = array(
                'ovh_option_id' => (int) (isset($option['id']) ? $option['id'] : 0),
                'ovh_label' => $label,
                'ovh_option_type' => (string) (isset($option['option_type']) ? $option['option_type'] : ''),
                'value_status' => (string) (isset($option['status']) ? $option['status'] : 'unverified'),
                'value_reason' => (string) (isset($option['reason']) ? $option['reason'] : ''),
                'matches' => $matches,
                'unambiguous' => count($matches) === 1,
                'values' => $values,
                // A discovered option with more than one value needs a value-level
                // mapping as well; without one the WHMCS option cannot represent it.
                'suboption_required' => count($values) > 1,
                'value_mapping_possible' => (string) (isset($option['status']) ? $option['status'] : 'unverified') === 'resolved'
                    && count($matches) === 1,
            );
        }
        return $out;
    }

    /**
     * Exact value -> suboption matches, per discovered value.
     *
     * @return array<int,array{ovh_value_key:string,ovh_value_label:string,matches:array,unambiguous:bool}>
     */
    public function valueMatches(array $option, array $optionMatches, array $suboptions)
    {
        $values = isset($option['values']) && is_array($option['values']) ? $option['values'] : array();
        $out = array();
        foreach ($values as $value) {
            if (!is_array($value) || !isset($value['label'])) { continue; }
            $label = (string) $value['label'];
            $normalized = $this->normalize($label);
            $matches = array();
            if ($normalized !== '') {
                foreach ($optionMatches as $optionMatch) {
                    foreach ($suboptions as $suboption) {
                        if ($suboption['option_id'] !== $optionMatch['id']) { continue; }
                        if ($this->normalize($suboption['name']) === $normalized) { $matches[] = $suboption; }
                    }
                }
            }
            $out[] = array(
                'ovh_value_key' => (string) (isset($value['key']) ? $value['key'] : $label),
                'ovh_value_label' => $label,
                'matches' => $matches,
                'unambiguous' => count($matches) === 1,
            );
        }
        return $out;
    }

    /**
     * The exactness rule, in one place so confirmation and suggestions cannot
     * drift apart: an option id + suboption id pair is only acceptable when the
     * suggestion set contains that value with exactly one match.
     */
    public function admits(array $suggestions, $ovhOptionId, $whmcsOptionId, $whmcsSuboptionId)
    {
        foreach ($suggestions as $suggestion) {
            if ((int) $suggestion['ovh_option_id'] !== (int) $ovhOptionId) { continue; }
            $optionAllowed = false;
            foreach ($suggestion['matches'] as $match) {
                if ((int) $match['id'] === (int) $whmcsOptionId) { $optionAllowed = true; }
            }
            if (!$optionAllowed) { continue; }
            if ((int) $whmcsSuboptionId === 0) { return true; }
            if ($suggestion['value_status'] !== 'resolved') {
                // The value list could not be read from the catalog; the admin is
                // explicitly confirming a label the API accepts. Recorded as such.
                return true;
            }
            foreach ($suggestion['values'] as $value) {
                if (empty($value['unambiguous'])) { continue; }
                foreach ($value['matches'] as $match) {
                    if ((int) $match['id'] === (int) $whmcsSuboptionId) { return true; }
                }
            }
        }
        return false;
    }

    /** True when the chosen value pair was proved by a discovered value list. */
    public function valueWasProven(array $suggestions, $ovhOptionId, $whmcsSuboptionId)
    {
        foreach ($suggestions as $suggestion) {
            if ((int) $suggestion['ovh_option_id'] !== (int) $ovhOptionId) { continue; }
            if ($suggestion['value_status'] !== 'resolved') { return false; }
            foreach ($suggestion['values'] as $value) {
                if (empty($value['unambiguous'])) { continue; }
                foreach ($value['matches'] as $match) {
                    if ((int) $match['id'] === (int) $whmcsSuboptionId) { return true; }
                }
            }
        }
        return false;
    }

    public function normalize($value)
    {
        return preg_replace('/[^a-z0-9]/', '', strtolower(trim((string) $value)));
    }
}
