<?php
/**
 * Commission rules - pure decision logic.
 *
 * Deliberately free of database and WHMCS dependencies: the engine gathers the
 * facts, this class decides. That keeps the business rules (which are the part
 * an operator cares about) fully unit-testable - see tests/customaffiliate.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

namespace CustomAffiliate;

class Rules
{
    const TYPE_FIRST     = 'first';
    const TYPE_RECURRING = 'recurring';

    /** Rejection reasons (stable identifiers, safe to key reports off). */
    const REASON_OK                = 'ok';
    const REASON_DISABLED          = 'module_disabled';
    const REASON_NO_GROUPS         = 'no_groups_configured';
    const REASON_GROUP_EXCLUDED    = 'product_group_excluded';
    const REASON_NOT_A_SERVICE     = 'not_a_service_item';
    const REASON_NO_AFFILIATE      = 'no_affiliate_referral';
    const REASON_DUPLICATE         = 'duplicate_payout';
    const REASON_BELOW_MINIMUM     = 'below_minimum_amount';
    const REASON_ZERO_RATE         = 'zero_rate';
    const REASON_ZERO_COMMISSION   = 'zero_commission';

    /**
     * Decide whether a single invoice line item earns commission, and at which
     * rate.
     *
     * Expected context keys (all optional, sane defaults applied):
     *   enabled            bool   module master switch
     *   allowedGroups      int[]  product group ids that earn commission
     *   productGroupId     int    group of the purchased product
     *   serviceId          int    tblhosting.id behind the line item
     *   affiliateId        int    referring affiliate (0 = none)
     *   baseAmount         float  commissionable amount for the line item
     *   minimumBase        float  ignore anything smaller
     *   alreadyPaid        bool   a payout row already exists for this item
     *   firstPaid          bool   ledger: first commission already paid
     *   clientWasNew       bool   client was new when referred
     *   requireNewClient   bool   restrict the first rate to new clients
     *   firstRate          float  percent
     *   recurringRate      float  percent
     *
     * @param  array<string,mixed> $context
     * @return array{eligible:bool,reason:string,type:string,rate:float,amount:float}
     */
    public static function decide(array $context): array
    {
        $type = self::TYPE_RECURRING;
        $rate = 0.0;

        $reject = static function (string $reason) use (&$type): array {
            return [
                'eligible' => false,
                'reason'   => $reason,
                'type'     => $type,
                'rate'     => 0.0,
                'amount'   => 0.0,
            ];
        };

        if (empty($context['enabled'])) {
            return $reject(self::REASON_DISABLED);
        }

        $allowedGroups = array_map('intval', (array) ($context['allowedGroups'] ?? []));

        if (!$allowedGroups) {
            // Fail closed: with no group configured we must not pay commission
            // on everything, which is exactly the bug this module exists to
            // prevent.
            return $reject(self::REASON_NO_GROUPS);
        }

        if ((int) ($context['serviceId'] ?? 0) <= 0) {
            return $reject(self::REASON_NOT_A_SERVICE);
        }

        if (!in_array((int) ($context['productGroupId'] ?? 0), $allowedGroups, true)) {
            return $reject(self::REASON_GROUP_EXCLUDED);
        }

        if ((int) ($context['affiliateId'] ?? 0) <= 0) {
            return $reject(self::REASON_NO_AFFILIATE);
        }

        if (!empty($context['alreadyPaid'])) {
            return $reject(self::REASON_DUPLICATE);
        }

        $baseAmount = round((float) ($context['baseAmount'] ?? 0), 2);
        $minimum = (float) ($context['minimumBase'] ?? 0.01);

        if ($baseAmount < $minimum || $baseAmount <= 0) {
            return $reject(self::REASON_BELOW_MINIMUM);
        }

        // ---- First payment vs renewal -------------------------------------
        $firstPaid = !empty($context['firstPaid']);
        $requireNewClient = !empty($context['requireNewClient']);
        $clientWasNew = !array_key_exists('clientWasNew', $context) || !empty($context['clientWasNew']);

        $qualifiesAsFirst = !$firstPaid && (!$requireNewClient || $clientWasNew);

        $type = $qualifiesAsFirst ? self::TYPE_FIRST : self::TYPE_RECURRING;

        $rate = $qualifiesAsFirst
            ? Settings::normaliseRate($context['firstRate'] ?? null, 50.0)
            : Settings::normaliseRate($context['recurringRate'] ?? null, 20.0);

        if ($rate <= 0) {
            return $reject(self::REASON_ZERO_RATE);
        }

        $amount = self::commission($baseAmount, $rate);

        if ($amount <= 0) {
            return $reject(self::REASON_ZERO_COMMISSION);
        }

        return [
            'eligible' => true,
            'reason'   => self::REASON_OK,
            'type'     => $type,
            'rate'     => $rate,
            'amount'   => $amount,
        ];
    }

    /**
     * Commission for an amount at a percentage, rounded to cents.
     */
    public static function commission(float $baseAmount, float $rate): float
    {
        if ($baseAmount <= 0 || $rate <= 0) {
            return 0.0;
        }

        return round(($baseAmount * $rate) / 100, 2);
    }

    /**
     * Spread an invoice level discount across the commissionable line items in
     * proportion to their value.
     *
     * WHMCS records promotions and credits as separate (negative) line items,
     * so without this the affiliate would earn commission on the undiscounted
     * price.
     *
     * @param  array<int|string,float> $amounts  [lineItemId => positive amount]
     * @param  float                   $discount positive magnitude of the discount
     * @return array<int|string,float>           adjusted amounts, never negative
     */
    public static function distributeDiscount(array $amounts, float $discount): array
    {
        $total = 0.0;

        foreach ($amounts as $amount) {
            $total += max(0.0, (float) $amount);
        }

        if ($discount <= 0 || $total <= 0) {
            return array_map(static function ($amount) {
                return round(max(0.0, (float) $amount), 2);
            }, $amounts);
        }

        // Never discount below zero in total.
        $discount = min($discount, $total);
        $adjusted = [];

        foreach ($amounts as $key => $amount) {
            $amount = max(0.0, (float) $amount);
            $share = $discount * ($amount / $total);
            $adjusted[$key] = round(max(0.0, $amount - $share), 2);
        }

        return $adjusted;
    }

    /**
     * Human readable explanation for a rejection reason, used in the audit log
     * and the admin UI.
     */
    public static function explain(string $reason): string
    {
        $messages = [
            self::REASON_OK              => 'Commission applied.',
            self::REASON_DISABLED        => 'Module is disabled.',
            self::REASON_NO_GROUPS       => 'No commissionable product group is configured.',
            self::REASON_GROUP_EXCLUDED  => 'Product is not in a commissionable product group.',
            self::REASON_NOT_A_SERVICE   => 'Line item is not linked to a product/service.',
            self::REASON_NO_AFFILIATE    => 'Service was not referred by an affiliate.',
            self::REASON_DUPLICATE       => 'Commission for this invoice item was already processed.',
            self::REASON_BELOW_MINIMUM   => 'Commissionable amount is below the configured minimum.',
            self::REASON_ZERO_RATE       => 'Configured commission rate is zero.',
            self::REASON_ZERO_COMMISSION => 'Calculated commission rounds to zero.',
        ];

        return $messages[$reason] ?? $reason;
    }
}
