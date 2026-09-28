<?php
/**
 * Commission ledger (mod_customaffiliate_commissions).
 *
 * One row per referred service. The `first_commission_paid` flag on that row is
 * the single source of truth for "has the 50% first-payment commission already
 * been earned for this service?".
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

namespace CustomAffiliate;

use WHMCS\Database\Capsule;

class Ledger
{
    const TABLE = 'mod_customaffiliate_commissions';

    /**
     * @return object|null
     */
    public static function find(int $serviceId, int $affiliateId)
    {
        try {
            return Capsule::table(self::TABLE)
                ->where('service_id', $serviceId)
                ->where('affiliate_id', $affiliateId)
                ->first();
        } catch (\Throwable $e) {
            Logger::error('Ledger lookup failed', [
                'service_id'   => $serviceId,
                'affiliate_id' => $affiliateId,
                'error'        => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Fetch the ledger row for a service/affiliate pair, creating it if needed.
     *
     * @param  array<string,mixed> $data
     * @return object|null
     */
    public static function ensure(int $serviceId, int $affiliateId, array $data = [])
    {
        $existing = self::find($serviceId, $affiliateId);

        if ($existing) {
            return $existing;
        }

        try {
            Capsule::table(self::TABLE)->insert([
                'service_id'       => $serviceId,
                'affiliate_id'     => $affiliateId,
                'client_id'        => (int) ($data['client_id'] ?? 0),
                'product_id'       => (int) ($data['product_id'] ?? 0),
                'product_group_id' => (int) ($data['product_group_id'] ?? 0),
                'client_was_new'   => !empty($data['client_was_new']) ? 1 : 0,
                'notes'            => (string) ($data['notes'] ?? 'Created by Custom Affiliate Commission'),
                'created_at'       => date('Y-m-d H:i:s'),
                'updated_at'       => date('Y-m-d H:i:s'),
            ]);
        } catch (\Throwable $e) {
            // A concurrent request may have inserted it first: the unique key
            // on (service_id, affiliate_id) makes that safe to ignore.
            Logger::debug('Ledger insert race or failure', [
                'service_id'   => $serviceId,
                'affiliate_id' => $affiliateId,
                'error'        => $e->getMessage(),
            ]);
        }

        return self::find($serviceId, $affiliateId);
    }

    /**
     * Apply a successful payout to the ledger counters.
     */
    public static function applyPayout(int $ledgerId, string $type, float $amount, int $invoiceId): void
    {
        $now = date('Y-m-d H:i:s');

        $update = [
            'last_invoice_id'    => $invoiceId,
            'last_commission_at' => $now,
            'updated_at'         => $now,
        ];

        try {
            if ($type === Rules::TYPE_FIRST) {
                $update['first_commission_paid'] = 1;
                $update['first_commission_amount'] = $amount;
                $update['first_commission_invoice_id'] = $invoiceId;
                $update['first_commission_paid_at'] = $now;
                $update['first_commission_reversed_at'] = null;

                Capsule::table(self::TABLE)->where('id', $ledgerId)->update($update);
            } else {
                Capsule::table(self::TABLE)->where('id', $ledgerId)->update($update);
                Capsule::table(self::TABLE)->where('id', $ledgerId)->increment('recurring_count', 1);
                Capsule::table(self::TABLE)->where('id', $ledgerId)->increment('total_recurring_commission', $amount);
            }

            Capsule::table(self::TABLE)->where('id', $ledgerId)->increment('total_commission', $amount);
        } catch (\Throwable $e) {
            Logger::error('Failed to update ledger after payout', [
                'ledger_id' => $ledgerId,
                'error'     => $e->getMessage(),
            ]);
        }
    }

    /**
     * Roll a payout back off the ledger.
     *
     * Reversing the FIRST commission clears the flag, so that if the client
     * pays again (for example a failed/refunded first payment followed by a
     * successful one) the affiliate correctly earns the first-payment rate.
     */
    public static function reversePayout(int $ledgerId, string $type, float $amount, string $note = ''): void
    {
        $now = date('Y-m-d H:i:s');

        try {
            if ($type === Rules::TYPE_FIRST) {
                Capsule::table(self::TABLE)->where('id', $ledgerId)->update([
                    'first_commission_paid'        => 0,
                    'first_commission_amount'      => 0.00,
                    'first_commission_invoice_id'  => null,
                    'first_commission_paid_at'     => null,
                    'first_commission_reversed_at' => $now,
                    'updated_at'                   => $now,
                ]);
            } else {
                $row = Capsule::table(self::TABLE)->where('id', $ledgerId)->first();

                Capsule::table(self::TABLE)->where('id', $ledgerId)->update([
                    'recurring_count'            => max(0, (int) ($row->recurring_count ?? 1) - 1),
                    'total_recurring_commission' => max(0, round((float) ($row->total_recurring_commission ?? 0) - $amount, 2)),
                    'updated_at'                 => $now,
                ]);
            }

            $row = Capsule::table(self::TABLE)->where('id', $ledgerId)->first();

            Capsule::table(self::TABLE)->where('id', $ledgerId)->update([
                'total_commission' => max(0, round((float) ($row->total_commission ?? 0) - $amount, 2)),
            ]);

            if ($note !== '') {
                self::note($ledgerId, $note);
            }
        } catch (\Throwable $e) {
            Logger::error('Failed to reverse ledger entry', [
                'ledger_id' => $ledgerId,
                'error'     => $e->getMessage(),
            ]);
        }
    }

    /**
     * Append a timestamped note (used by the upgrade/downgrade handler).
     */
    public static function note(int $ledgerId, string $note): void
    {
        try {
            $row = Capsule::table(self::TABLE)->where('id', $ledgerId)->first();

            if (!$row) {
                return;
            }

            $existing = (string) ($row->notes ?? '');
            $entry = '[' . date('Y-m-d H:i') . '] ' . $note;
            $combined = $existing === '' ? $entry : $existing . "\n" . $entry;

            Capsule::table(self::TABLE)->where('id', $ledgerId)->update([
                'notes'      => substr($combined, -4000),
                'updated_at' => date('Y-m-d H:i:s'),
            ]);
        } catch (\Throwable $e) {
            Logger::debug('Could not append ledger note', ['ledger_id' => $ledgerId, 'error' => $e->getMessage()]);
        }
    }

    /**
     * Update the product/group recorded against a service (after an
     * upgrade/downgrade).
     */
    public static function syncProduct(int $ledgerId, int $productId, int $productGroupId): void
    {
        try {
            Capsule::table(self::TABLE)->where('id', $ledgerId)->update([
                'product_id'       => $productId,
                'product_group_id' => $productGroupId,
                'updated_at'       => date('Y-m-d H:i:s'),
            ]);
        } catch (\Throwable $e) {
            Logger::debug('Could not sync ledger product', ['ledger_id' => $ledgerId, 'error' => $e->getMessage()]);
        }
    }

    /**
     * Was the client new when this service was ordered?
     *
     * "New" means the service is the client's earliest order: they had no other
     * service and no paid invoice before it. This lets the first-payment rate be
     * restricted to genuinely new customers, as required by the commission
     * structure, while renewals and second purchases fall back to the recurring
     * rate.
     */
    public static function clientWasNew(int $clientId, int $serviceId): bool
    {
        if ($clientId <= 0 || $serviceId <= 0) {
            return true;
        }

        try {
            $service = Capsule::table('tblhosting')->where('id', $serviceId)->first();

            if (!$service) {
                return true;
            }

            $earlierServices = Capsule::table('tblhosting')
                ->where('userid', $clientId)
                ->where('id', '<>', $serviceId)
                ->where(function ($query) use ($service) {
                    $query->where('regdate', '<', $service->regdate)
                        ->orWhere(function ($inner) use ($service) {
                            $inner->where('regdate', '=', $service->regdate)
                                ->where('id', '<', $service->id);
                        });
                })
                ->count();

            if ($earlierServices > 0) {
                return false;
            }

            $earlierPaidInvoices = Capsule::table('tblinvoices')
                ->where('userid', $clientId)
                ->where('status', 'Paid')
                ->where('datepaid', '<', $service->regdate . ' 00:00:00')
                ->count();

            return $earlierPaidInvoices === 0;
        } catch (\Throwable $e) {
            Logger::debug('Could not determine client novelty; assuming new', [
                'client_id'  => $clientId,
                'service_id' => $serviceId,
                'error'      => $e->getMessage(),
            ]);

            return true;
        }
    }

    /**
     * Ledger rows for the admin UI.
     *
     * @param  array<string,mixed> $filters
     * @return array<int,object>
     */
    public static function search(array $filters = [], int $limit = 100): array
    {
        try {
            $query = Capsule::table(self::TABLE)->orderBy('id', 'desc');

            if (!empty($filters['affiliate_id'])) {
                $query->where('affiliate_id', (int) $filters['affiliate_id']);
            }

            if (!empty($filters['service_id'])) {
                $query->where('service_id', (int) $filters['service_id']);
            }

            if (isset($filters['first_paid']) && $filters['first_paid'] !== '') {
                $query->where('first_commission_paid', (int) $filters['first_paid']);
            }

            return $query->limit(max(1, min($limit, 500)))->get()->all();
        } catch (\Throwable $e) {
            return [];
        }
    }
}
