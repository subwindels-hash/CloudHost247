<?php
/**
 * Commission engine.
 *
 * Owns the full lifecycle:
 *
 *   InvoicePaid      -> processInvoice()   : decide, credit, record
 *   InvoiceRefunded  -> reverseInvoice()   : claw back
 *   InvoiceCancelled -> reverseInvoice()
 *   InvoiceUnpaid    -> reverseInvoice()   : a payment that was undone
 *
 * Design notes
 * ------------
 * - Commission is only ever created from a PAID invoice; nothing is trusted
 *   from the order or the cart.
 * - The referring affiliate comes from tblaffiliatesaccounts (written by WHMCS
 *   from the affiliate tracking cookie at order time), never from a guess.
 * - Duplicate payouts are impossible: mod_customaffiliate_payouts has a unique
 *   key on (invoice_id, invoice_item_id) and the insert happens before the
 *   affiliate is credited.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

namespace CustomAffiliate;

use WHMCS\Database\Capsule;

class CommissionEngine
{
    const PAYOUTS_TABLE = 'mod_customaffiliate_payouts';

    /**
     * Process a paid invoice.
     *
     * @return array{processed:int,skipped:int,amount:float,details:array<int,array<string,mixed>>}
     */
    public function processInvoice(int $invoiceId): array
    {
        $summary = ['processed' => 0, 'skipped' => 0, 'amount' => 0.0, 'details' => []];

        if (!Settings::isEnabled()) {
            return $summary;
        }

        $invoice = Catalog::invoice($invoiceId);

        if (!$invoice) {
            Logger::warning('InvoicePaid for an unknown invoice', ['invoice_id' => $invoiceId, 'action' => 'invoice_missing']);

            return $summary;
        }

        // Only ever pay on a genuinely paid invoice. The hook can fire from a
        // gateway callback, the admin area, the API or the cron; re-checking
        // the stored status keeps all of those honest.
        if ((string) $invoice->status !== 'Paid') {
            Logger::debug('Invoice is not in Paid status; ignoring', [
                'invoice_id' => $invoiceId,
                'status'     => $invoice->status,
            ]);

            return $summary;
        }

        $items = Catalog::invoiceItems($invoiceId);

        if (!$items) {
            return $summary;
        }

        $bases = $this->commissionableBases($items);

        foreach ($items as $item) {
            $itemId = (int) $item->id;

            if (!array_key_exists($itemId, $bases)) {
                continue; // not a service charge, or a discount/credit line
            }

            $result = $this->processItem($invoice, $item, $bases[$itemId]);
            $summary['details'][] = $result;

            if (!empty($result['eligible'])) {
                $summary['processed']++;
                $summary['amount'] = round($summary['amount'] + (float) $result['amount'], 2);
            } else {
                $summary['skipped']++;
            }
        }

        return $summary;
    }

    /**
     * Commissionable base amount per line item, with invoice level discounts
     * spread proportionally across them.
     *
     * @param  array<int,object> $items
     * @return array<int,float>  [invoice item id => base amount]
     */
    private function commissionableBases(array $items): array
    {
        $amounts = [];

        foreach ($items as $item) {
            $amount = (float) $item->amount;

            if ($amount <= 0) {
                continue;
            }

            if (!in_array((string) $item->type, Catalog::SERVICE_ITEM_TYPES, true)) {
                continue;
            }

            if (Catalog::serviceIdForItem($item) <= 0) {
                continue;
            }

            $amounts[(int) $item->id] = round($amount, 2);
        }

        if (!$amounts || !Settings::appliesDiscounts()) {
            return $amounts;
        }

        $discount = Catalog::discountTotal($items);

        if ($discount <= 0) {
            return $amounts;
        }

        return Rules::distributeDiscount($amounts, $discount);
    }

    /**
     * Evaluate and, when eligible, pay a single line item.
     *
     * @return array<string,mixed>
     */
    private function processItem($invoice, $item, float $baseAmount): array
    {
        $invoiceId = (int) $invoice->id;
        $itemId = (int) $item->id;
        $clientId = (int) $invoice->userid;

        $serviceId = Catalog::serviceIdForItem($item);
        $service = Catalog::service($serviceId);
        $productId = $service ? (int) $service->packageid : 0;
        $productGroupId = Catalog::productGroupId($productId);

        $referral = Affiliates::referralForService($serviceId);
        $affiliateId = $referral ? (int) $referral->affiliateid : 0;

        $ledger = $affiliateId > 0 ? Ledger::find($serviceId, $affiliateId) : null;

        $context = [
            'enabled'          => Settings::isEnabled(),
            'allowedGroups'    => Settings::productGroupIds(),
            'productGroupId'   => $productGroupId,
            'serviceId'        => $serviceId,
            'affiliateId'      => $affiliateId,
            'baseAmount'       => $baseAmount,
            'minimumBase'      => Settings::minimumBaseAmount(),
            'alreadyPaid'      => $this->payoutExists($invoiceId, $itemId),
            'firstPaid'        => $ledger ? (bool) $ledger->first_commission_paid : false,
            'clientWasNew'     => $ledger
                ? (bool) $ledger->client_was_new
                : Ledger::clientWasNew($clientId, $serviceId),
            'requireNewClient' => Settings::requiresNewClient(),
            'firstRate'        => Settings::firstRate(),
            'recurringRate'    => Settings::recurringRate(),
        ];

        $decision = Rules::decide($context);

        $base = [
            'invoice_id'      => $invoiceId,
            'invoice_item_id' => $itemId,
            'service_id'      => $serviceId,
            'affiliate_id'    => $affiliateId,
            'product_id'      => $productId,
            'base_amount'     => $baseAmount,
        ];

        if (!$decision['eligible']) {
            // Only log the interesting skips; "not referred" and "not hosting"
            // are the overwhelming majority of line items on a busy system and
            // would otherwise flood the audit trail.
            if (!in_array($decision['reason'], [Rules::REASON_NO_AFFILIATE, Rules::REASON_GROUP_EXCLUDED], true)) {
                Logger::commission('skipped', Rules::explain($decision['reason']), $base + [
                    'action' => 'skipped',
                    'reason' => $decision['reason'],
                    'level'  => $decision['reason'] === Rules::REASON_NO_GROUPS ? Logger::LEVEL_WARNING : Logger::LEVEL_INFO,
                ]);
            } else {
                Logger::debug(Rules::explain($decision['reason']), $base + ['reason' => $decision['reason']]);
            }

            return $base + ['eligible' => false, 'reason' => $decision['reason'], 'amount' => 0.0];
        }

        $ledger = Ledger::ensure($serviceId, $affiliateId, [
            'client_id'        => $clientId,
            'product_id'       => $productId,
            'product_group_id' => $productGroupId,
            'client_was_new'   => $context['clientWasNew'],
        ]);

        if (!$ledger) {
            Logger::error('Could not create ledger row; commission not paid', $base);

            return $base + ['eligible' => false, 'reason' => 'ledger_unavailable', 'amount' => 0.0];
        }

        return $this->payout($invoice, $item, $referral, $ledger, $decision, $baseAmount) + $base;
    }

    /**
     * Record and credit an eligible commission.
     *
     * The payout row is inserted FIRST: its unique key is what makes a
     * duplicate credit impossible, even under concurrent hook execution.
     *
     * @param  array{eligible:bool,reason:string,type:string,rate:float,amount:float} $decision
     * @return array<string,mixed>
     */
    private function payout($invoice, $item, $referral, $ledger, array $decision, float $baseAmount): array
    {
        $invoiceId = (int) $invoice->id;
        $itemId = (int) $item->id;
        $affiliateId = (int) $referral->affiliateid;
        $amount = (float) $decision['amount'];
        $type = (string) $decision['type'];

        $payoutId = 0;

        try {
            $payoutId = (int) Capsule::table(self::PAYOUTS_TABLE)->insertGetId([
                'ledger_id'       => (int) $ledger->id,
                'service_id'      => (int) $ledger->service_id,
                'affiliate_id'    => $affiliateId,
                'client_id'       => (int) $invoice->userid,
                'invoice_id'      => $invoiceId,
                'invoice_item_id' => $itemId,
                'commission_type' => $type,
                'base_amount'     => $baseAmount,
                'rate'            => $decision['rate'],
                'amount'          => $amount,
                'currency_id'     => (int) ($invoice->currency ?? 0),
                'affacc_id'       => (int) $referral->id,
                'status'          => 'pending',
                'created_at'      => date('Y-m-d H:i:s'),
                'updated_at'      => date('Y-m-d H:i:s'),
            ]);
        } catch (\Throwable $e) {
            // Unique key violation: another execution of the hook already
            // handled this line item. That is a success, not an error.
            Logger::debug('Duplicate payout prevented by unique key', [
                'invoice_id'      => $invoiceId,
                'invoice_item_id' => $itemId,
                'error'           => $e->getMessage(),
            ]);

            return ['eligible' => false, 'reason' => Rules::REASON_DUPLICATE, 'amount' => 0.0];
        }

        $description = sprintf(
            '%s commission (%s%%) - service #%d, invoice #%d',
            $type === Rules::TYPE_FIRST ? 'First payment' : 'Renewal',
            rtrim(rtrim(number_format($decision['rate'], 3, '.', ''), '0'), '.'),
            (int) $ledger->service_id,
            $invoiceId
        );

        try {
            $credit = Affiliates::credit(
                $affiliateId,
                (int) $referral->id,
                $amount,
                $description,
                Settings::commissionDelayDays()
            );
        } catch (\Throwable $e) {
            // Roll the payout row back so the commission can be retried rather
            // than being silently lost behind the duplicate guard.
            Capsule::table(self::PAYOUTS_TABLE)->where('id', $payoutId)->delete();

            Logger::error('Failed to credit affiliate; payout rolled back', [
                'invoice_id'   => $invoiceId,
                'affiliate_id' => $affiliateId,
                'amount'       => $amount,
                'error'        => $e->getMessage(),
            ]);

            return ['eligible' => false, 'reason' => 'credit_failed', 'amount' => 0.0];
        }

        Capsule::table(self::PAYOUTS_TABLE)->where('id', $payoutId)->update([
            'status'     => $credit['status'] === 'pending' ? 'pending' : 'credited',
            'pending_id' => $credit['pending_id'],
            'updated_at' => date('Y-m-d H:i:s'),
        ]);

        Ledger::applyPayout((int) $ledger->id, $type, $amount, $invoiceId);

        Logger::commission($type . '_commission', $description, [
            'action'       => $type . '_commission',
            'service_id'   => (int) $ledger->service_id,
            'affiliate_id' => $affiliateId,
            'invoice_id'   => $invoiceId,
            'amount'       => $amount,
            'rate'         => $decision['rate'],
            'base_amount'  => $baseAmount,
            'status'       => $credit['status'],
        ]);

        return [
            'eligible' => true,
            'reason'   => Rules::REASON_OK,
            'type'     => $type,
            'rate'     => $decision['rate'],
            'amount'   => $amount,
            'status'   => $credit['status'],
        ];
    }

    private function payoutExists(int $invoiceId, int $itemId): bool
    {
        try {
            return Capsule::table(self::PAYOUTS_TABLE)
                ->where('invoice_id', $invoiceId)
                ->where('invoice_item_id', $itemId)
                ->whereIn('status', ['pending', 'credited'])
                ->exists();
        } catch (\Throwable $e) {
            // Fail closed: if we cannot verify, do not risk paying twice.
            Logger::error('Duplicate check failed; skipping payout', [
                'invoice_id' => $invoiceId,
                'error'      => $e->getMessage(),
            ]);

            return true;
        }
    }

    /* ==================================================================
     | Reversals
     * ================================================================= */

    /**
     * Reverse every commission raised from an invoice.
     *
     * @return array{reversed:int,amount:float}
     */
    public function reverseInvoice(int $invoiceId, string $reason): array
    {
        $summary = ['reversed' => 0, 'amount' => 0.0];

        try {
            $payouts = Capsule::table(self::PAYOUTS_TABLE)
                ->where('invoice_id', $invoiceId)
                ->whereIn('status', ['pending', 'credited'])
                ->get();
        } catch (\Throwable $e) {
            Logger::error('Could not load payouts for reversal', [
                'invoice_id' => $invoiceId,
                'error'      => $e->getMessage(),
            ]);

            return $summary;
        }

        foreach ($payouts as $payout) {
            if ($this->reversePayout($payout, $reason)) {
                $summary['reversed']++;
                $summary['amount'] = round($summary['amount'] + (float) $payout->amount, 2);
            }
        }

        return $summary;
    }

    /**
     * Reverse a single payout row.
     */
    public function reversePayout($payout, string $reason): bool
    {
        $amount = (float) $payout->amount;
        $affiliateId = (int) $payout->affiliate_id;

        $description = sprintf(
            'Commission reversed (%s) - service #%d, invoice #%d',
            $reason,
            (int) $payout->service_id,
            (int) $payout->invoice_id
        );

        try {
            $outcome = Affiliates::reverse(
                $affiliateId,
                $payout->pending_id ? (int) $payout->pending_id : null,
                $amount,
                $description
            );

            Capsule::table(self::PAYOUTS_TABLE)->where('id', (int) $payout->id)->update([
                'status'      => 'reversed',
                'reason'      => substr($reason, 0, 255),
                'reversed_at' => date('Y-m-d H:i:s'),
                'updated_at'  => date('Y-m-d H:i:s'),
            ]);

            Ledger::reversePayout(
                (int) $payout->ledger_id,
                (string) $payout->commission_type,
                $amount,
                'Commission reversed: ' . $reason
            );

            Logger::commission('reversal', $description, [
                'action'       => 'reversal',
                'service_id'   => (int) $payout->service_id,
                'affiliate_id' => $affiliateId,
                'invoice_id'   => (int) $payout->invoice_id,
                'amount'       => -$amount,
                'rate'         => (float) $payout->rate,
                'outcome'      => $outcome,
                'level'        => Logger::LEVEL_WARNING,
            ]);

            return true;
        } catch (\Throwable $e) {
            Logger::error('Commission reversal failed', [
                'payout_id' => (int) $payout->id,
                'error'     => $e->getMessage(),
            ]);

            return false;
        }
    }

    /* ==================================================================
     | Reporting helpers for the admin UI
     * ================================================================= */

    /**
     * @param  array<string,mixed> $filters
     * @return array<int,object>
     */
    public static function payouts(array $filters = [], int $limit = 100): array
    {
        try {
            $query = Capsule::table(self::PAYOUTS_TABLE)->orderBy('id', 'desc');

            foreach (['affiliate_id', 'service_id', 'invoice_id', 'client_id'] as $field) {
                if (!empty($filters[$field])) {
                    $query->where($field, (int) $filters[$field]);
                }
            }

            if (!empty($filters['commission_type'])) {
                $query->where('commission_type', (string) $filters['commission_type']);
            }

            if (!empty($filters['status'])) {
                $query->where('status', (string) $filters['status']);
            }

            if (!empty($filters['from'])) {
                $query->where('created_at', '>=', date('Y-m-d 00:00:00', strtotime((string) $filters['from'])));
            }

            if (!empty($filters['to'])) {
                $query->where('created_at', '<=', date('Y-m-d 23:59:59', strtotime((string) $filters['to'])));
            }

            return $query->limit(max(1, min($limit, 1000)))->get()->all();
        } catch (\Throwable $e) {
            return [];
        }
    }

    /**
     * Aggregate figures for the dashboard.
     *
     * @param  array<string,mixed> $filters
     * @return array<string,float|int>
     */
    public static function totals(array $filters = []): array
    {
        $defaults = [
            'payouts'   => 0,
            'first'     => 0.0,
            'recurring' => 0.0,
            'reversed'  => 0.0,
            'pending'   => 0.0,
            'credited'  => 0.0,
        ];

        try {
            $rows = self::payouts($filters, 1000);
        } catch (\Throwable $e) {
            return $defaults;
        }

        foreach ($rows as $row) {
            $amount = (float) $row->amount;
            $defaults['payouts']++;

            if ($row->status === 'reversed') {
                $defaults['reversed'] = round($defaults['reversed'] + $amount, 2);
                continue;
            }

            if ($row->commission_type === Rules::TYPE_FIRST) {
                $defaults['first'] = round($defaults['first'] + $amount, 2);
            } else {
                $defaults['recurring'] = round($defaults['recurring'] + $amount, 2);
            }

            if ($row->status === 'pending') {
                $defaults['pending'] = round($defaults['pending'] + $amount, 2);
            } else {
                $defaults['credited'] = round($defaults['credited'] + $amount, 2);
            }
        }

        return $defaults;
    }
}
