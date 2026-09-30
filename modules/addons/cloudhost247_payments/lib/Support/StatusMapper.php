<?php
/**
 * Normalizes provider-specific Blockonomics order state into the CloudHost247 customer/admin
 * payment vocabulary (spec §19): Pending / Confirming / Paid / Underpaid / Expired.
 *
 * Pure functions over plain values — no WHMCS, no database — so the mapping is unit testable
 * (tests/payments/run.php) and identical everywhere it is displayed.
 *
 * Provider semantics preserved internally:
 *   blockonomics_orders.status  -1 = awaiting payment, 0 = unconfirmed,
 *                                1 = partially confirmed, 2 = confirmed
 *   `Paid` is only ever asserted when a matching WHMCS payment record exists — the display
 *   layer never invents a success the accounting layer has not recorded (spec §19, §51).
 */

namespace CloudHost247\Payments\Support;

final class StatusMapper
{
    const PENDING    = 'Pending';
    const CONFIRMING = 'Confirming';
    const PAID       = 'Paid';
    const UNDERPAID  = 'Underpaid';
    const EXPIRED    = 'Expired';

    /**
     * @param int        $providerStatus     blockonomics_orders.status
     * @param string     $txid               provider transaction id ('' when none observed)
     * @param int        $createdTimestamp   blockonomics_orders.timestamp (unix)
     * @param int        $timePeriodMinutes  configured payment window
     * @param int        $requiredConfirmations configured confirmation requirement
     * @param bool       $hasWhmcsPayment    a tblaccounts row exists for this order's txid
     * @param float      $expected           expected amount (bits)
     * @param float      $received           received amount (bits_payed)
     * @param int        $now                current unix time (injected for testability)
     * @return string
     */
    public static function map(
        $providerStatus,
        $txid,
        $createdTimestamp,
        $timePeriodMinutes,
        $requiredConfirmations,
        $hasWhmcsPayment,
        $expected,
        $received,
        $now
    ) {
        $providerStatus = (int) $providerStatus;
        $txid = trim((string) $txid);

        // No transaction ever observed: the address either still waits or the window lapsed.
        if ($providerStatus <= -1 && $txid === '') {
            $expiresAt = (int) $createdTimestamp + ((int) $timePeriodMinutes * 60);
            return $now > $expiresAt ? self::EXPIRED : self::PENDING;
        }

        // A transaction exists but the configured confirmation requirement is not met yet.
        if ($providerStatus < (int) $requiredConfirmations && !$hasWhmcsPayment) {
            return self::CONFIRMING;
        }

        // Confirmed on-chain. "Paid" requires the WHMCS accounting record; a confirmed but
        // uncredited payment stays visibly in Confirming so nothing looks settled early.
        if (!$hasWhmcsPayment) {
            return self::CONFIRMING;
        }

        if ((float) $received > 0 && (float) $received < (float) $expected) {
            return self::UNDERPAID; // credited partially per the existing slack/percent rules
        }

        return self::PAID;
    }

    /** All labels, for filter dropdowns. */
    public static function labels()
    {
        return array(self::PENDING, self::CONFIRMING, self::PAID, self::UNDERPAID, self::EXPIRED);
    }
}
