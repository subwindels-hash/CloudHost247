<?php
namespace CloudHost247\Ovh\Catalog;

use CloudHost247\Ovh\Normalization\OptionValueExtractor;
use WHMCS\Database\Capsule;
use InvalidArgumentException;

/**
 * Automatic discovery of the configurable options a mapped OVH plan exposes, and
 * their explicitly confirmed mapping onto existing WHMCS options.
 *
 * The stored option row keeps the raw API value; this class reads it through
 * `OptionValueExtractor`, so a payload shape the module does not recognise is
 * reported as `unverified` and the operator maps it by hand instead of the
 * matcher guessing a value list.
 */
final class ConfigurableOptionMapper
{
    private $matcher;

    public function __construct(?DiscoveredOptionMatcher $matcher = null)
    {
        $this->matcher = $matcher ?: new DiscoveredOptionMatcher();
    }

    /**
     * @return array<int,array> discovered options with exact WHMCS matches
     *                          (shape documented on DiscoveredOptionMatcher::match)
     */
    public function suggestions($mappingId)
    {
        $mapping = Capsule::table('mod_cloudhost247_ovh_product_mappings')->where('id', (int) $mappingId)->first();
        if (!$mapping) { throw new InvalidArgumentException('Product mapping does not exist.'); }
        $catalog = Capsule::table('mod_cloudhost247_ovh_catalog')->where('endpoint_id', $mapping->endpoint_id)->where('family', $mapping->family)->where('plan_code', $mapping->plan_code)->first();
        if (!$catalog) { return array(); }

        $extractor = new OptionValueExtractor();
        $discovered = array();
        foreach (Capsule::table('mod_cloudhost247_ovh_options')->where('catalog_id', $catalog->id)->get() as $remote) {
            $value = json_decode((string) $remote->value_json, true);
            if (!is_array($value)) { $value = $remote->value_json; }
            $extracted = $extractor->values($value);
            $discovered[] = array(
                'id' => (int) $remote->id,
                'label' => (string) $remote->label,
                'option_type' => (string) $remote->option_type,
                'status' => $extracted['status'],
                'reason' => $extracted['reason'],
                'values' => $extracted['values'],
            );
        }

        $whmcsOptions = array();
        foreach (Capsule::table('tblproductconfigoptions as o')->join('tblproductconfiglinks as l', 'l.gid', '=', 'o.gid')->where('l.pid', $mapping->whmcs_product_id)->select('o.id', 'o.optionname')->get() as $local) {
            $whmcsOptions[] = array('id' => (int) $local->id, 'name' => (string) explode('|', $local->optionname)[0]);
        }
        $whmcsSuboptions = Capsule::table('tblproductconfigoptionssub as s')->whereIn('configid', array_map(function ($option) { return (int) $option['id']; }, $whmcsOptions) ?: array(0))->select('s.id', 's.configid', 's.optionname')->get()->all();
        $suboptions = array();
        foreach ($whmcsSuboptions as $suboption) {
            $suboptions[] = array('id' => (int) $suboption->id, 'option_id' => (int) $suboption->configid, 'name' => (string) $suboption->optionname);
        }

        $suggestions = $this->matcher->match($discovered, $whmcsOptions, $suboptions);
        foreach ($suggestions as $index => $suggestion) {
            $suggestions[$index]['mapping_id'] = (int) $mappingId;
        }
        return $suggestions;
    }

    /** The stored mappings for one product mapping, joined to their local names. */
    public function confirmed($mappingId)
    {
        $rows = Capsule::table('mod_cloudhost247_ovh_option_mappings as m')
            ->leftJoin('tblproductconfigoptions as o', 'o.id', '=', 'm.whmcs_option_id')
            ->leftJoin('tblproductconfigoptionssub as s', 's.id', '=', 'm.whmcs_suboption_id')
            ->where('m.mapping_id', (int) $mappingId)
            ->select('m.*', 'o.optionname', 's.optionname as suboption_name')
            ->get()->all();
        $out = array();
        foreach ($rows as $row) {
            $out[] = array(
                'id' => (int) $row->id,
                'ovh_option_id' => (int) $row->ovh_option_id,
                'whmcs_option_id' => (int) $row->whmcs_option_id,
                'whmcs_option_name' => (string) explode('|', (string) $row->optionname)[0],
                'whmcs_suboption_id' => $row->whmcs_suboption_id === null ? null : (int) $row->whmcs_suboption_id,
                'whmcs_suboption_name' => (string) $row->suboption_name,
                'verified' => !empty($row->verified),
                'created_at' => (string) $row->created_at,
            );
        }
        return $out;
    }

    /**
     * Confirms one option (and optionally one value) onto a WHMCS option.
     *
     * $verified is derived here, never trusted from the request: it is true only
     * when the discovered value list proved the exact suboption.
     */
    public function confirm($mappingId, $ovhOptionId, $whmcsOptionId, $whmcsSuboptionId, $adminId, $confirmed)
    {
        if (!$confirmed) { throw new InvalidArgumentException('Explicit configurable-option mapping confirmation is required.'); }
        $suggestions = $this->suggestions($mappingId);
        if (!$this->matcher->admits($suggestions, $ovhOptionId, $whmcsOptionId, $whmcsSuboptionId)) {
            throw new InvalidArgumentException('The selected option is not an exact discovered match.');
        }
        if ($whmcsSuboptionId && !Capsule::table('tblproductconfigoptionssub')->where('id', (int) $whmcsSuboptionId)->where('configid', (int) $whmcsOptionId)->exists()) {
            throw new InvalidArgumentException('WHMCS suboption does not belong to the selected option.');
        }
        $verified = $whmcsSuboptionId
            ? $this->matcher->valueWasProven($suggestions, $ovhOptionId, $whmcsSuboptionId)
            : $this->valueListProven($suggestions, $ovhOptionId);
        $row = array(
            'whmcs_option_id' => (int) $whmcsOptionId,
            'whmcs_suboption_id' => $whmcsSuboptionId ? (int) $whmcsSuboptionId : null,
            'admin_id' => (int) $adminId,
            'created_at' => date('Y-m-d H:i:s'),
        );
        if (Capsule::schema()->hasColumn('mod_cloudhost247_ovh_option_mappings', 'verified')) {
            $row['verified'] = $verified ? 1 : 0;
        }
        Capsule::table('mod_cloudhost247_ovh_option_mappings')->updateOrInsert(
            array('mapping_id' => (int) $mappingId, 'ovh_option_id' => (int) $ovhOptionId),
            $row
        );
        return array('verified' => $verified);
    }

    /** True when the option's own value list was read from the catalog. */
    private function valueListProven(array $suggestions, $ovhOptionId)
    {
        foreach ($suggestions as $suggestion) {
            if ((int) $suggestion['ovh_option_id'] === (int) $ovhOptionId) {
                return (string) $suggestion['value_status'] === 'resolved';
            }
        }
        return false;
    }
}
