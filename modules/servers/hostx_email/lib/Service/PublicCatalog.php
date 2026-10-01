<?php
/**
 * Public catalogue for the email-hosting landing page.
 *
 * Everything shown on the page comes from real WHMCS records:
 *   - products whose provisioning module is hostx_email (tblproducts.servertype)
 *   - pricing from tblpricing for the visitor's active currency
 *   - the provider/plan/storage facts configured on each product
 *
 * Nothing is invented. A product with no price in the active currency is
 * reported with price_verified = false and the page says "pricing not
 * published" instead of showing a number. Hidden or retired products are not
 * advertised as available.
 *
 * This class performs no provider API calls - page rendering never touches a
 * remote API.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Service;

use CloudHost247\Email\Providers\ProviderFactory;
use CloudHost247\Email\Support\Config;
use CloudHost247\Email\Support\Logger;
use WHMCS\Database\Capsule;

final class PublicCatalog
{
    const MODULE = 'hostx_email';

    /**
     * Billing cycles in the order they are preferred for the headline price.
     *
     * @var array<int,string>
     */
    const CYCLES = ['monthly', 'annually', 'quarterly', 'semiannually', 'biennially', 'triennially'];

    /**
     * Products grouped by provider.
     *
     * @return array<string,array<string,mixed>>
     */
    public function byProvider(int $currencyId = 0): array
    {
        $currency = $this->currency($currencyId);
        $grouped = [];

        foreach (array_keys(ProviderFactory::PROVIDERS) as $provider) {
            $grouped[$provider] = [
                'key'      => $provider,
                'label'    => ProviderFactory::label($provider),
                'plans'    => [],
                'has_plans' => false,
            ];
        }

        foreach ($this->products($currency) as $product) {
            $provider = $product['provider'];

            if (!isset($grouped[$provider])) {
                continue;
            }

            $grouped[$provider]['plans'][] = $product;
            $grouped[$provider]['has_plans'] = true;
        }

        // Basic -> Standard -> Premium, then by price.
        $order = ['basic' => 1, 'standard' => 2, 'premium' => 3];

        foreach ($grouped as $key => $group) {
            usort($grouped[$key]['plans'], static function ($a, $b) use ($order) {
                $left = $order[$a['tier']] ?? 9;
                $right = $order[$b['tier']] ?? 9;

                if ($left !== $right) {
                    return $left <=> $right;
                }

                return ((float) ($a['price_value'] ?? 0)) <=> ((float) ($b['price_value'] ?? 0));
            });
        }

        return $grouped;
    }

    /**
     * Flat list of verified, orderable email products.
     *
     * @param  array<string,mixed>|null $currency
     * @return array<int,array<string,mixed>>
     */
    public function products(?array $currency = null): array
    {
        $currency = $currency ?: $this->currency(0);
        $rows = [];

        try {
            $rows = Capsule::table('tblproducts as p')
                ->leftJoin('tblproductgroups as g', 'g.id', '=', 'p.gid')
                ->where('p.servertype', self::MODULE)
                ->select(
                    'p.id', 'p.gid', 'p.name', 'p.description', 'p.hidden', 'p.retired', 'p.paytype',
                    'p.configoption1', 'p.configoption2', 'p.configoption3', 'p.configoption4',
                    'p.configoption5', 'p.configoption6', 'p.configoption7', 'p.configoption8',
                    'g.name as group_name', 'g.hidden as group_hidden'
                )
                ->orderBy('p.order')
                ->orderBy('p.id')
                ->get()
                ->all();
        } catch (\Throwable $e) {
            Logger::error('catalog.query_failed', ['error' => $e->getMessage()]);

            return [];
        }

        $products = [];

        foreach ($rows as $row) {
            $available = empty($row->hidden) && empty($row->retired) && empty($row->group_hidden);
            $pricing = $this->pricing((int) $row->id, (int) $currency['id']);

            $storage = (int) ($row->configoption5 ?? 0);
            $quantity = (int) ($row->configoption4 ?? 1);

            $products[] = [
                'pid'             => (int) $row->id,
                'name'            => (string) $row->name,
                'description'     => trim(strip_tags((string) $row->description)),
                'group'           => (string) ($row->group_name ?? ''),
                'provider'        => $this->providerKey((string) ($row->configoption1 ?? '')),
                'provider_label'  => ProviderFactory::label($this->providerKey((string) ($row->configoption1 ?? ''))),
                'tier'            => strtolower((string) ($row->configoption2 ?? '')) ?: 'standard',
                'plan_sku'        => (string) ($row->configoption3 ?? ''),
                'mailboxes'       => $quantity > 0 ? $quantity : 1,
                'storage_gb'      => $storage,
                'storage_verified' => $storage > 0,
                'custom_domain'   => true,
                'available'       => $available,
                'availability'    => $available ? 'available' : 'unavailable',
                'price_verified'  => $pricing['verified'],
                'price'           => $pricing['formatted'],
                'price_value'     => $pricing['value'],
                'cycle'           => $pricing['cycle'],
                'cycle_label'     => $pricing['cycle_label'],
                'setup_fee'       => $pricing['setup'],
                'currency_code'   => $currency['code'],
                'cart_url'        => 'cart.php?a=add&pid=' . (int) $row->id,
            ];
        }

        return $products;
    }

    /**
     * Comparison rows built from the configured products only.
     *
     * @return array<int,array<string,mixed>>
     */
    public function comparison(int $currencyId = 0): array
    {
        $grouped = $this->byProvider($currencyId);
        $rows = [];

        foreach ($grouped as $provider => $group) {
            $plans = $group['plans'];
            $capabilities = $this->capabilitiesFor($provider);

            $storage = [];
            $prices = [];

            foreach ($plans as $plan) {
                if ($plan['storage_verified']) {
                    $storage[] = $plan['storage_gb'];
                }

                if ($plan['price_verified']) {
                    $prices[] = $plan['price_value'];
                }
            }

            $rows[] = [
                'provider'        => $provider,
                'label'           => $group['label'],
                'plan_count'      => count($plans),
                'from_price'      => $prices ? min($prices) : null,
                'storage_range'   => $storage
                    ? (min($storage) === max($storage) ? min($storage) . ' GB' : min($storage) . '-' . max($storage) . ' GB')
                    : 'Not published',
                'custom_domain'   => 'Yes',
                'webmail'         => $this->webmailLabel($provider),
                'mailbox_api'     => !empty($capabilities['create']) ? 'Automated' : 'Manual',
                'password_change' => !empty($capabilities['change_password']) ? 'Self-service' : 'Provider console',
                'suspend'         => !empty($capabilities['suspend']) ? 'Automated' : 'Manual',
                'licence'         => !empty($capabilities['assign_license']) ? 'Managed by CloudHost247' : 'Not applicable',
                'dns_records'     => !empty($capabilities['dns']) ? 'Shown in the client area' : 'Provider console',
                'usage_reporting' => !empty($capabilities['usage']) ? 'Storage usage shown' : 'Not reported by provider',
            ];
        }

        return $rows;
    }

    /**
     * Capability matrix for a provider, without any credentials.
     *
     * @return array<string,bool>
     */
    public function capabilitiesFor(string $provider): array
    {
        $config = new Config(['configoption1' => $provider]);

        return ProviderFactory::makeFor($this->providerKey($provider), $config)->capabilities();
    }

    /* ------------------------------------------------------------------
     | Internals
     * ----------------------------------------------------------------- */

    private function providerKey(string $value): string
    {
        $value = strtolower(trim($value));

        if (ProviderFactory::exists($value)) {
            return $value;
        }

        // Tolerate legacy labels stored on older products.
        $aliases = [
            'microsoft'        => Config::PROVIDER_MICROSOFT,
            'microsoft 365'    => Config::PROVIDER_MICROSOFT,
            'm365'             => Config::PROVIDER_MICROSOFT,
            'google_workspace' => Config::PROVIDER_GOOGLE,
            'google workspace' => Config::PROVIDER_GOOGLE,
            'gsuite'           => Config::PROVIDER_GOOGLE,
        ];

        return $aliases[$value] ?? Config::PROVIDER_PROFESSIONAL;
    }

    /**
     * Headline price for a product in a currency.
     *
     * @return array{verified:bool,value:float|null,formatted:string,cycle:string,cycle_label:string,setup:string}
     */
    private function pricing(int $productId, int $currencyId): array
    {
        $empty = [
            'verified'    => false,
            'value'       => null,
            'formatted'   => 'Pricing not published',
            'cycle'       => '',
            'cycle_label' => '',
            'setup'       => '',
        ];

        try {
            $row = Capsule::table('tblpricing')
                ->where('type', 'product')
                ->where('relid', $productId)
                ->where('currency', $currencyId)
                ->first();
        } catch (\Throwable $e) {
            return $empty;
        }

        if (!$row) {
            return $empty;
        }

        foreach (self::CYCLES as $cycle) {
            if (!isset($row->{$cycle})) {
                continue;
            }

            $value = (float) $row->{$cycle};

            // WHMCS stores -1 for "not offered".
            if ($value < 0) {
                continue;
            }

            $setupField = substr($cycle, 0, 1) . 'setupfee';
            $setup = isset($row->{$setupField}) ? (float) $row->{$setupField} : 0.0;

            return [
                'verified'    => true,
                'value'       => $value,
                'formatted'   => $this->formatCurrency($value, $currencyId),
                'cycle'       => $cycle,
                'cycle_label' => $this->cycleLabel($cycle),
                'setup'       => $setup > 0 ? $this->formatCurrency($setup, $currencyId) . ' setup' : '',
            ];
        }

        return $empty;
    }

    private function formatCurrency(float $value, int $currencyId): string
    {
        if (function_exists('formatCurrency')) {
            try {
                return (string) formatCurrency($value, $currencyId);
            } catch (\Throwable $e) {
                // fall through to the plain format
            }
        }

        return number_format($value, 2);
    }

    private function cycleLabel(string $cycle): string
    {
        $labels = [
            'monthly'      => 'per month',
            'quarterly'    => 'per quarter',
            'semiannually' => 'every 6 months',
            'annually'     => 'per year',
            'biennially'   => 'every 2 years',
            'triennially'  => 'every 3 years',
        ];

        return $labels[$cycle] ?? $cycle;
    }

    private function webmailLabel(string $provider): string
    {
        $labels = [
            Config::PROVIDER_MICROSOFT    => 'Outlook on the web',
            Config::PROVIDER_GOOGLE       => 'Gmail',
            Config::PROVIDER_PROFESSIONAL => 'Webmail (provider URL)',
        ];

        return $labels[$provider] ?? 'Webmail';
    }

    /**
     * Active currency for the visitor.
     *
     * @return array{id:int,code:string}
     */
    public function currency(int $currencyId): array
    {
        try {
            if ($currencyId > 0) {
                $row = Capsule::table('tblcurrencies')->where('id', $currencyId)->first();

                if ($row) {
                    return ['id' => (int) $row->id, 'code' => (string) $row->code];
                }
            }

            $row = Capsule::table('tblcurrencies')->where('default', 1)->first();

            if ($row) {
                return ['id' => (int) $row->id, 'code' => (string) $row->code];
            }
        } catch (\Throwable $e) {
            Logger::debug('catalog.currency_failed', ['error' => $e->getMessage()]);
        }

        return ['id' => 0, 'code' => ''];
    }
}
