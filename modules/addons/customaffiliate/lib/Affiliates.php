<?php
/**
 * WHMCS affiliate system gateway.
 *
 * All reads and writes against the core affiliate tables live here:
 *
 *   tblaffiliates          the affiliate (balance, withdrawn, payout overrides)
 *   tblaffiliatesaccounts  the referral: one row per referred service (relid)
 *   tblaffiliatespending   commission waiting for the clearing delay to expire
 *   tblaffiliateshistory   commission credited to the balance
 *
 * Crediting mirrors exactly what WHMCS itself does, so the standard cron
 * clearing routine, the admin affiliate screens and the client area affiliate
 * page all keep working unchanged.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

namespace CustomAffiliate;

use WHMCS\Database\Capsule;

class Affiliates
{
    const TABLE_AFFILIATES = 'tblaffiliates';
    const TABLE_ACCOUNTS   = 'tblaffiliatesaccounts';
    const TABLE_PENDING    = 'tblaffiliatespending';
    const TABLE_HISTORY    = 'tblaffiliateshistory';

    /**
     * The referral record for a service, if the service was referred.
     *
     * This - not tblclients - is the authoritative source of "who referred
     * this?": WHMCS writes it at order time from the affiliate tracking
     * cookie/session.
     *
     * @return object|null
     */
    public static function referralForService(int $serviceId)
    {
        if ($serviceId <= 0) {
            return null;
        }

        try {
            return Capsule::table(self::TABLE_ACCOUNTS)
                ->where('relid', $serviceId)
                ->orderBy('id', 'asc')
                ->first();
        } catch (\Throwable $e) {
            Logger::error('Failed to read affiliate referral', [
                'service_id' => $serviceId,
                'error'      => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * @return object|null
     */
    public static function affiliate(int $affiliateId)
    {
        if ($affiliateId <= 0) {
            return null;
        }

        try {
            return Capsule::table(self::TABLE_AFFILIATES)->where('id', $affiliateId)->first();
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Credit commission to an affiliate.
     *
     * With a clearing delay configured the amount is parked in
     * tblaffiliatespending, exactly like a native WHMCS commission, and the
     * WHMCS cron clears it (or removes it if the service is no longer active).
     * Without a delay it goes straight onto the balance with a history entry.
     *
     * @return array{status:string,pending_id:?int}
     */
    public static function credit(int $affiliateId, int $referralId, float $amount, string $description, int $delayDays): array
    {
        $amount = round($amount, 2);

        if ($affiliateId <= 0 || $referralId <= 0 || $amount <= 0) {
            return ['status' => 'skipped', 'pending_id' => null];
        }

        $today = date('Y-m-d');

        if ($delayDays > 0) {
            $pendingId = (int) Capsule::table(self::TABLE_PENDING)->insertGetId([
                'affaccid'     => $referralId,
                'amount'       => $amount,
                'clearingdate' => date('Y-m-d', strtotime('+' . $delayDays . ' days')),
            ]);

            self::touchReferral($referralId, $today);

            return ['status' => 'pending', 'pending_id' => $pendingId];
        }

        Capsule::table(self::TABLE_AFFILIATES)
            ->where('id', $affiliateId)
            ->increment('balance', $amount);

        Capsule::table(self::TABLE_HISTORY)->insert([
            'affiliateid' => $affiliateId,
            'date'        => $today,
            'description' => substr($description, 0, 255),
            'amount'      => $amount,
        ]);

        self::touchReferral($referralId, $today);

        return ['status' => 'credited', 'pending_id' => null];
    }

    /**
     * Reverse a commission previously credited by credit().
     *
     * Pending commission is simply removed; already-cleared commission is
     * clawed back with a negative history entry so the affiliate's statement
     * stays auditable.
     *
     * @return string One of 'pending_removed', 'balance_debited', 'noop'
     */
    public static function reverse(int $affiliateId, ?int $pendingId, float $amount, string $description): string
    {
        $amount = round($amount, 2);

        if ($amount <= 0) {
            return 'noop';
        }

        if ($pendingId) {
            $deleted = (int) Capsule::table(self::TABLE_PENDING)->where('id', $pendingId)->delete();

            if ($deleted > 0) {
                return 'pending_removed';
            }
            // The pending row is gone: the WHMCS cron already cleared it onto
            // the balance, so fall through and debit the balance instead.
        }

        if ($affiliateId <= 0) {
            return 'noop';
        }

        Capsule::table(self::TABLE_AFFILIATES)
            ->where('id', $affiliateId)
            ->decrement('balance', $amount);

        Capsule::table(self::TABLE_HISTORY)->insert([
            'affiliateid' => $affiliateId,
            'date'        => date('Y-m-d'),
            'description' => substr($description, 0, 255),
            'amount'      => -$amount,
        ]);

        return 'balance_debited';
    }

    /**
     * Keep tblaffiliatesaccounts.lastpaid in step with the payouts we create.
     */
    private static function touchReferral(int $referralId, string $date): void
    {
        try {
            Capsule::table(self::TABLE_ACCOUNTS)->where('id', $referralId)->update(['lastpaid' => $date]);
        } catch (\Throwable $e) {
            // lastpaid is informational only; never fail a payout over it.
            Logger::debug('Could not update referral lastpaid', [
                'referral_id' => $referralId,
                'error'       => $e->getMessage(),
            ]);
        }
    }

    /**
     * Is the WHMCS affiliate system switched on?
     */
    public static function systemEnabled(): bool
    {
        try {
            $value = Capsule::table('tblconfiguration')->where('setting', 'AffiliateSystem')->value('value');

            return in_array(strtolower((string) $value), ['on', '1', 'true'], true);
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Display name for an affiliate, for the admin tables.
     */
    public static function name(int $affiliateId): string
    {
        try {
            $row = Capsule::table(self::TABLE_AFFILIATES . ' as a')
                ->leftJoin('tblclients as c', 'c.id', '=', 'a.clientid')
                ->where('a.id', $affiliateId)
                ->select('c.firstname', 'c.lastname', 'c.companyname', 'a.clientid')
                ->first();

            if (!$row) {
                return 'Affiliate #' . $affiliateId;
            }

            $name = trim((string) $row->firstname . ' ' . (string) $row->lastname);

            if ($name === '') {
                $name = (string) $row->companyname;
            }

            return ($name !== '' ? $name : 'Client #' . (int) $row->clientid) . ' (#' . $affiliateId . ')';
        } catch (\Throwable $e) {
            return 'Affiliate #' . $affiliateId;
        }
    }
}
