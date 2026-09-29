<?php
namespace CloudHost247\Builder\Catalog;

use CloudHost247\Builder\Contracts\LiveDataSource;
use CloudHost247\Builder\Support\HtmlSanitizer;
use WHMCS\Database\Capsule;

/**
 * Live WHMCS catalogue, cart and status data.
 *
 * Read-only, query-builder only, and honest about failure: if a table is
 * missing or a query throws, the method returns null and the widget says so
 * instead of showing an invented price. Prices come from tblpricing in the
 * default currency; WHMCS stores -1 for "not offered", which is treated as no
 * price rather than as a zero.
 *
 * Domain pricing uses the WHMCS year mapping (msetupfee = 1 year, qsetupfee =
 * 2 years, ... biennially = 10 years) and skips client-group override rows.
 */
final class WhmcsDataSource implements LiveDataSource
{
    /** tblpricing columns for product billing cycles. */
    const PRODUCT_CYCLES = array(
        'monthly' => 'monthly', 'quarterly' => 'quarterly', 'semiannually' => 'semiannually',
        'annually' => 'annually', 'biennially' => 'biennially', 'triennially' => 'triennially',
    );
    const PRODUCT_SETUP = array(
        'monthly' => 'msetupfee', 'quarterly' => 'qsetupfee', 'semiannually' => 'ssetupfee',
        'annually' => 'asetupfee', 'biennially' => 'bsetupfee', 'triennially' => 'tsetupfee',
    );
    /** Domain prices: year number => tblpricing column. */
    const DOMAIN_YEAR_COLUMN = 'msetupfee';

    private $reason = '';
    private $currency = null;
    private $sanitizer;

    public function __construct(HtmlSanitizer $sanitizer = null)
    {
        $this->sanitizer = $sanitizer ? $sanitizer : new HtmlSanitizer();
    }

    public function available()
    {
        if (!class_exists('WHMCS\\Database\\Capsule')) {
            $this->reason = 'WHMCS is not loaded in this process.';
            return false;
        }
        try {
            if (!Capsule::schema()->hasTable('tblproducts')) {
                $this->reason = 'The WHMCS product catalogue table is not present.';
                return false;
            }
        } catch (\Throwable $unavailable) {
            $this->reason = 'The WHMCS database could not be reached.';
            return false;
        }
        return true;
    }

    public function unavailableReason()
    {
        return $this->reason !== '' ? $this->reason : 'Live catalogue data is unavailable.';
    }

    public function productGroups()
    {
        if (!$this->available()) { return null; }
        try {
            $rows = Capsule::table('tblproductgroups')->where('hidden', 0)->orderBy('order')->orderBy('id')->get();
        } catch (\Throwable $unavailable) {
            $this->reason = 'The product group table could not be read.';
            return null;
        }
        $groups = array();
        foreach ($rows as $row) {
            $groups[] = array('id' => (int) $row->id, 'name' => $this->sanitizer->text(isset($row->name) ? $row->name : '', 120));
        }
        return $groups;
    }

    public function products($groupId = 0, $limit = 12, $cycle = 'monthly')
    {
        if (!$this->available()) { return null; }
        $limit = max(1, min(48, (int) $limit));
        try {
            $query = Capsule::table('tblproducts')->where('hidden', 0);
            if ((int) $groupId > 0) { $query->where('gid', (int) $groupId); }
            $rows = $query->orderBy('order')->orderBy('id')->limit($limit)->get();
        } catch (\Throwable $unavailable) {
            $this->reason = 'The product catalogue could not be read.';
            return null;
        }
        $groups = array();
        try {
            foreach (Capsule::table('tblproductgroups')->get() as $group) {
                $groups[(int) $group->id] = isset($group->name) ? (string) $group->name : '';
            }
        } catch (\Throwable $ignored) {
            $groups = array();
        }
        $products = array();
        foreach ($rows as $row) {
            $products[] = $this->hydrateProduct($row, $groups, $cycle);
        }
        return $products;
    }

    public function product($id, $cycle = 'monthly')
    {
        if (!$this->available() || (int) $id <= 0) { return null; }
        try {
            $row = Capsule::table('tblproducts')->where('id', (int) $id)->first();
        } catch (\Throwable $unavailable) {
            $this->reason = 'The product could not be read.';
            return null;
        }
        if (!$row) { return null; }
        $groups = array();
        try {
            $group = Capsule::table('tblproductgroups')->where('id', (int) $row->gid)->first();
            if ($group) { $groups[(int) $group->id] = (string) $group->name; }
        } catch (\Throwable $ignored) {
            $groups = array();
        }
        return $this->hydrateProduct($row, $groups, $cycle);
    }

    public function price($productId, $cycle = 'monthly')
    {
        if (!$this->available() || (int) $productId <= 0) { return null; }
        if (!isset(self::PRODUCT_CYCLES[$cycle])) { $cycle = 'monthly'; }
        $currency = $this->currency();
        if ($currency === null) { return null; }
        try {
            $row = Capsule::table('tblpricing')
                ->where('type', 'product')
                ->where('relid', (int) $productId)
                ->where('currency', (int) $currency['id'])
                ->first();
        } catch (\Throwable $unavailable) {
            $this->reason = 'Product pricing could not be read.';
            return null;
        }
        if (!$row) { return null; }
        $column = self::PRODUCT_CYCLES[$cycle];
        if (!isset($row->$column)) { return null; }
        $amount = (float) $row->$column;
        // WHMCS stores -1 when a cycle is not offered.
        if ($amount < 0) { return null; }
        $setupColumn = self::PRODUCT_SETUP[$cycle];
        $setup = isset($row->$setupColumn) ? (float) $row->$setupColumn : 0.0;
        return array(
            'amount' => $amount,
            'formatted' => Money::format($amount, $currency),
            'currency' => $currency['code'],
            'setup' => $setup > 0 ? Money::format($setup, $currency) : '',
            'cycle' => $cycle,
        );
    }

    public function domainPricing(array $tlds = array(), $limit = 8)
    {
        if (!class_exists('WHMCS\\Database\\Capsule')) { return null; }
        $currency = $this->currency();
        if ($currency === null) { return null; }
        $limit = max(1, min(60, (int) $limit));
        try {
            if (!Capsule::schema()->hasTable('tbldomainpricing')) {
                $this->reason = 'The domain pricing table is not present.';
                return null;
            }
            $query = Capsule::table('tbldomainpricing');
            $wanted = array();
            foreach ($tlds as $tld) {
                $tld = strtolower(trim((string) $tld));
                if ($tld === '') { continue; }
                if (strncmp($tld, '.', 1) !== 0) { $tld = '.' . $tld; }
                if (preg_match('/^\.[a-z0-9.-]{2,32}$/', $tld) === 1) { $wanted[] = $tld; }
            }
            if ($wanted) { $query->whereIn('extension', $wanted); }
            $rows = $query->orderBy('order')->orderBy('id')->limit($limit)->get();

            $ids = array();
            foreach ($rows as $row) { $ids[] = (int) $row->id; }
            $prices = array();
            if ($ids) {
                $priceRows = Capsule::table('tblpricing')
                    ->whereIn('type', array('domainregister', 'domaintransfer', 'domainrenew'))
                    ->whereIn('relid', $ids)
                    ->where('currency', (int) $currency['id'])
                    // Client-group overrides store the group id in tsetupfee; base rows use 0.
                    ->where('tsetupfee', 0)
                    ->get();
                foreach ($priceRows as $price) {
                    $prices[(int) $price->relid][(string) $price->type] = $price;
                }
            }
        } catch (\Throwable $unavailable) {
            $this->reason = 'Domain pricing could not be read.';
            return null;
        }

        $column = self::DOMAIN_YEAR_COLUMN;
        $out = array();
        foreach ($rows as $row) {
            $id = (int) $row->id;
            $entry = array(
                'tld' => $this->sanitizer->text(isset($row->extension) ? $row->extension : '', 32),
                'register' => null, 'transfer' => null, 'renew' => null,
                'currency' => $currency['code'],
            );
            foreach (array('domainregister' => 'register', 'domaintransfer' => 'transfer', 'domainrenew' => 'renew') as $type => $key) {
                if (!isset($prices[$id][$type]) || !isset($prices[$id][$type]->$column)) { continue; }
                $amount = (float) $prices[$id][$type]->$column;
                if ($amount < 0) { continue; }
                $entry[$key] = Money::format($amount, $currency);
            }
            $out[] = $entry;
        }
        return $out;
    }

    public function cart()
    {
        // The cart lives in the visitor's WHMCS session. No session, no cart:
        // that is a real state, not an error, so it is reported as an empty cart.
        $items = 0;
        if (isset($_SESSION['cart']['products']) && is_array($_SESSION['cart']['products'])) {
            $items += count($_SESSION['cart']['products']);
        }
        if (isset($_SESSION['cart']['domains']) && is_array($_SESSION['cart']['domains'])) {
            $items += count($_SESSION['cart']['domains']);
        }
        if (isset($_SESSION['cart']['addons']) && is_array($_SESSION['cart']['addons'])) {
            $items += count($_SESSION['cart']['addons']);
        }
        return array(
            'items' => $items,
            'url' => CartLinks::cart(),
            'checkout_url' => CartLinks::checkout(),
        );
    }

    public function reviews($limit = 3)
    {
        if (!class_exists('WHMCS\\Database\\Capsule')) { return null; }
        $limit = max(1, min(24, (int) $limit));
        try {
            if (!Capsule::schema()->hasTable('mod_cloudhost247_theme_content')) {
                $this->reason = 'Testimonials are stored by the CloudHost247 theme module, which is not installed.';
                return null;
            }
            $rows = Capsule::table('mod_cloudhost247_theme_content')
                ->where('content_type', 'testimonial')
                ->where('published', 1)
                ->orderBy('sort_order')->orderBy('id')
                ->limit($limit)->get();
        } catch (\Throwable $unavailable) {
            $this->reason = 'Testimonials could not be read.';
            return null;
        }
        $reviews = array();
        foreach ($rows as $row) {
            $payload = json_decode(isset($row->payload_json) ? (string) $row->payload_json : '', true);
            if (!is_array($payload)) { $payload = array(); }
            $reviews[] = array(
                'author' => $this->sanitizer->text(isset($row->title) ? $row->title : '', 120),
                'quote' => $this->sanitizer->text(isset($payload['summary']) ? $payload['summary'] : strip_tags(isset($payload['body']) ? $payload['body'] : ''), 600),
                'role' => $this->sanitizer->text(isset($payload['url']) ? '' : '', 120),
            );
        }
        return $reviews;
    }

    public function serviceStatus($limit = 6)
    {
        if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) {
            $this->reason = 'The API & Integrations centre is not installed, so no measured status is available.';
            return null;
        }
        $limit = max(1, min(24, (int) $limit));
        try {
            $installed = \CloudHost247\Integrations\Services\IntegrationManager::installed();
        } catch (\Throwable $unavailable) {
            $this->reason = 'Integration status could not be read.';
            return null;
        }
        if (!is_array($installed)) { return null; }
        $rows = array();
        foreach ($installed as $integration) {
            if (count($rows) >= $limit) { break; }
            $label = isset($integration['label']) ? $integration['label'] : (isset($integration['provider']) ? $integration['provider'] : '');
            $state = isset($integration['health_state']) ? $integration['health_state'] : (isset($integration['status']) ? $integration['status'] : 'unknown');
            $rows[] = array(
                'label' => $this->sanitizer->text($label, 80),
                'state' => $this->sanitizer->text($state, 40),
                'checked_at' => isset($integration['health_checked_at']) ? $this->sanitizer->text($integration['health_checked_at'], 40) : '',
            );
        }
        return $rows;
    }

    public function currency()
    {
        if ($this->currency !== null) { return $this->currency ? $this->currency : null; }
        if (!class_exists('WHMCS\\Database\\Capsule')) { $this->currency = false; return null; }
        try {
            $row = Capsule::table('tblcurrencies')->where('default', 1)->first();
            if (!$row) { $row = Capsule::table('tblcurrencies')->orderBy('id')->first(); }
        } catch (\Throwable $unavailable) {
            $this->currency = false;
            $this->reason = 'The currency table could not be read.';
            return null;
        }
        if (!$row) { $this->currency = false; return null; }
        $this->currency = array(
            'id' => (int) $row->id,
            'code' => $this->sanitizer->text(isset($row->code) ? $row->code : '', 8),
            'prefix' => $this->sanitizer->text(isset($row->prefix) ? $row->prefix : '', 8),
            'suffix' => $this->sanitizer->text(isset($row->suffix) ? $row->suffix : '', 8),
        );
        return $this->currency;
    }

    public function brokerageAvailability()
    {
        if (!class_exists('CloudHost247\\Broker\\Repositories\\SettingsRepository')) {
            $this->reason = 'The Domain Brokerage module is not installed.';
            return null;
        }
        try {
            $settings = new \CloudHost247\Broker\Repositories\SettingsRepository();
            $enabled = $settings->isBrokerageEnabled();
        } catch (\Throwable $unavailable) {
            $this->reason = 'Domain Brokerage settings could not be read.';
            return null;
        }
        return array(
            'enabled' => (bool) $enabled,
            'new_case_url' => CartLinks::brokerNewCase(),
            'list_url' => CartLinks::brokerCaseList(),
        );
    }

    public function brokerageFees()
    {
        if (!class_exists('CloudHost247\\Broker\\Repositories\\FeeRepository')) {
            $this->reason = 'The Domain Brokerage module is not installed.';
            return null;
        }
        try {
            $rows = (new \CloudHost247\Broker\Repositories\FeeRepository())->enabled();
        } catch (\Throwable $unavailable) {
            $this->reason = 'Brokerage fee rules could not be read.';
            return null;
        }
        $fees = array();
        foreach ($rows as $row) {
            $fees[] = array(
                'name' => $this->sanitizer->text(isset($row->name) ? $row->name : '', 120),
                'fee_type' => $this->sanitizer->text(isset($row->fee_type) ? $row->fee_type : '', 16),
                'applies_to' => $this->sanitizer->text(isset($row->applies_to) ? $row->applies_to : '', 24),
                'amount' => (float) (isset($row->amount) ? $row->amount : 0),
                'currency' => $this->sanitizer->text(isset($row->currency) ? $row->currency : '', 8),
            );
        }
        return $fees;
    }

    public function brokerageCases($clientId, $limit = 5)
    {
        if (!class_exists('CloudHost247\\Broker\\Repositories\\CaseRepository')) {
            $this->reason = 'The Domain Brokerage module is not installed.';
            return null;
        }
        $clientId = (int) $clientId;
        $limit = max(1, min(25, (int) $limit));
        $base = array(
            'rows' => array(),
            'total' => 0,
            'list_url' => CartLinks::brokerCaseList(),
            'new_case_url' => CartLinks::brokerNewCase(),
        );
        if ($clientId <= 0) { return $base; }
        try {
            $result = (new \CloudHost247\Broker\Repositories\CaseRepository())->forClient($clientId, 1, $limit);
        } catch (\Throwable $unavailable) {
            $this->reason = 'Brokerage cases could not be read.';
            return null;
        }
        if (!is_array($result) || !isset($result['rows'])) { return $base; }
        foreach ($result['rows'] as $row) {
            $status = isset($row->status) ? (string) $row->status : '';
            $label = class_exists('CloudHost247\\Broker\\Domain\\CaseStatus')
                ? \CloudHost247\Broker\Domain\CaseStatus::label($status)
                : $status;
            $base['rows'][] = array(
                'case_number' => $this->sanitizer->text(isset($row->case_number) ? $row->case_number : '', 40),
                'domain' => $this->sanitizer->text(isset($row->domain) ? $row->domain : '', 255),
                'status' => $this->sanitizer->text($status, 40),
                'status_label' => $this->sanitizer->text($label, 60),
                'updated_at' => $this->sanitizer->text(isset($row->updated_at) ? $row->updated_at : '', 40),
                'detail_url' => CartLinks::brokerCaseDetail(isset($row->id) ? $row->id : 0),
            );
        }
        $base['total'] = (int) $result['total'];
        return $base;
    }

    private function hydrateProduct($row, array $groups, $cycle)
    {
        $id = (int) $row->id;
        $groupId = (int) (isset($row->gid) ? $row->gid : 0);
        return array(
            'id' => $id,
            'name' => $this->sanitizer->text(isset($row->name) ? $row->name : '', 150),
            'description' => $this->sanitizer->text(isset($row->description) ? $row->description : '', 600, true),
            'group_id' => $groupId,
            'group' => isset($groups[$groupId]) ? $this->sanitizer->text($groups[$groupId], 120) : '',
            'order_url' => CartLinks::product($id),
            'price' => $this->price($id, $cycle),
        );
    }
}
