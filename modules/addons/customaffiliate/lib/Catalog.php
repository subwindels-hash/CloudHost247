<?php
/**
 * Catalogue / invoice introspection helpers.
 *
 * Resolves invoice line items back to the service, product and product group
 * they belong to. This is where the "web hosting only" scope is enforced.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

namespace CustomAffiliate;

use WHMCS\Database\Capsule;

class Catalog
{
    /**
     * Invoice item types that represent a product/service charge.
     *
     * Everything else - Domain, DomainRegister, DomainTransfer, DomainRenew,
     * Addon, Item (custom/billable), Setup fees on non-products, late fees,
     * credit and promotion lines - is ignored outright, which is how domains,
     * RDP, SSL and email hosting stay excluded from affiliate tracking.
     *
     * @var array<int,string>
     */
    const SERVICE_ITEM_TYPES = ['Hosting', 'Upgrade'];

    /** @var array<int,object|null> */
    private static $serviceCache = [];

    /** @var array<int,int> */
    private static $groupCache = [];

    /**
     * Load an invoice with the data the engine needs.
     *
     * @return object|null
     */
    public static function invoice(int $invoiceId)
    {
        if ($invoiceId <= 0) {
            return null;
        }

        try {
            return Capsule::table('tblinvoices')->where('id', $invoiceId)->first();
        } catch (\Throwable $e) {
            Logger::error('Could not load invoice', ['invoice_id' => $invoiceId, 'error' => $e->getMessage()]);

            return null;
        }
    }

    /**
     * All line items for an invoice.
     *
     * @return array<int,object>
     */
    public static function invoiceItems(int $invoiceId): array
    {
        try {
            return Capsule::table('tblinvoiceitems')
                ->where('invoiceid', $invoiceId)
                ->orderBy('id', 'asc')
                ->get()
                ->all();
        } catch (\Throwable $e) {
            Logger::error('Could not load invoice items', ['invoice_id' => $invoiceId, 'error' => $e->getMessage()]);

            return [];
        }
    }

    /**
     * Total value of negative (discount/credit/promotion) line items on an
     * invoice, as a positive magnitude.
     *
     * @param  array<int,object> $items
     */
    public static function discountTotal(array $items): float
    {
        $discount = 0.0;

        foreach ($items as $item) {
            $amount = (float) $item->amount;

            if ($amount < 0) {
                $discount += abs($amount);
            }
        }

        return round($discount, 2);
    }

    /**
     * Map a line item to the service it charges for.
     *
     * - "Hosting" items point straight at tblhosting.
     * - "Upgrade" items point at tblupgrades, whose relid is the service. An
     *   upgrade/downgrade therefore resolves to the SAME service, which is what
     *   keeps the first/recurring logic correct across package changes.
     *
     * @return int 0 when the item is not a commissionable service charge
     */
    public static function serviceIdForItem($item): int
    {
        $type = (string) ($item->type ?? '');
        $relatedId = (int) ($item->relid ?? 0);

        if ($relatedId <= 0) {
            return 0;
        }

        if ($type === 'Hosting') {
            return $relatedId;
        }

        if ($type === 'Upgrade') {
            try {
                $upgrade = Capsule::table('tblupgrades')->where('id', $relatedId)->first();
            } catch (\Throwable $e) {
                return 0;
            }

            if (!$upgrade) {
                return 0;
            }

            // Only product/config-option upgrades of a hosting service count;
            // domain upgrades and others have a different relation target.
            $upgradeType = strtolower((string) ($upgrade->type ?? ''));

            if (!in_array($upgradeType, ['product', 'configoptions', 'package'], true)) {
                return 0;
            }

            return (int) $upgrade->relid;
        }

        return 0;
    }

    /**
     * @return object|null
     */
    public static function service(int $serviceId)
    {
        if ($serviceId <= 0) {
            return null;
        }

        if (array_key_exists($serviceId, self::$serviceCache)) {
            return self::$serviceCache[$serviceId];
        }

        try {
            self::$serviceCache[$serviceId] = Capsule::table('tblhosting')->where('id', $serviceId)->first();
        } catch (\Throwable $e) {
            self::$serviceCache[$serviceId] = null;
        }

        return self::$serviceCache[$serviceId];
    }

    /**
     * Product group id for a product.
     */
    public static function productGroupId(int $productId): int
    {
        if ($productId <= 0) {
            return 0;
        }

        if (isset(self::$groupCache[$productId])) {
            return self::$groupCache[$productId];
        }

        try {
            self::$groupCache[$productId] = (int) Capsule::table('tblproducts')->where('id', $productId)->value('gid');
        } catch (\Throwable $e) {
            self::$groupCache[$productId] = 0;
        }

        return self::$groupCache[$productId];
    }

    /**
     * Is this product inside one of the commissionable groups?
     */
    public static function isCommissionableProduct(int $productId): bool
    {
        $groups = Settings::productGroupIds();

        if (!$groups) {
            return false;
        }

        return in_array(self::productGroupId($productId), $groups, true);
    }

    /**
     * All product groups, for the settings screen.
     *
     * @return array<int,string>
     */
    public static function productGroups(): array
    {
        $groups = [];

        try {
            foreach (Capsule::table('tblproductgroups')->orderBy('name')->get() as $group) {
                $groups[(int) $group->id] = (string) $group->name;
            }
        } catch (\Throwable $e) {
            Logger::debug('Could not load product groups', ['error' => $e->getMessage()]);
        }

        return $groups;
    }

    public static function productGroupName(int $groupId): string
    {
        $groups = self::productGroups();

        return $groups[$groupId] ?? ('Group #' . $groupId);
    }

    /**
     * Clear the in-request caches (used by the tests and long-running crons).
     */
    public static function clearCache(): void
    {
        self::$serviceCache = [];
        self::$groupCache = [];
    }
}
