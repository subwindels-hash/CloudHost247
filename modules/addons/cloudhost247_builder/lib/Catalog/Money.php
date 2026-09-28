<?php
namespace CloudHost247\Builder\Catalog;

/**
 * Currency formatting for live prices.
 *
 * WHMCS owns the numbers; this only renders them, using the prefix and suffix
 * configured for the currency. It never rounds a price up, never substitutes a
 * currency and never formats a value it was not given.
 */
final class Money
{
    public static function format($amount, array $currency)
    {
        if (!is_numeric($amount)) { return ''; }
        $prefix = isset($currency['prefix']) ? (string) $currency['prefix'] : '';
        $suffix = isset($currency['suffix']) ? (string) $currency['suffix'] : '';
        $formatted = number_format((float) $amount, 2, '.', ',');
        return trim($prefix . $formatted . ($suffix !== '' ? ' ' . $suffix : ''));
    }

    /** Human label for a WHMCS billing cycle. */
    public static function cycleLabel($cycle)
    {
        $labels = array(
            'monthly' => 'per month', 'quarterly' => 'per quarter', 'semiannually' => 'per 6 months',
            'annually' => 'per year', 'biennially' => 'per 2 years', 'triennially' => 'per 3 years',
        );
        return isset($labels[$cycle]) ? $labels[$cycle] : '';
    }
}
