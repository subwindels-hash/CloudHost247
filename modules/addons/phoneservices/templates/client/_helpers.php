<?php
/**
 * Shared escaping/formatting helpers for the client page templates.
 *
 * Included (once) at the top of every client template. Keeping these as plain
 * closures avoids polluting the global function namespace of the WHMCS client
 * area while still giving the templates terse helpers.
 *
 * @package PhoneServices
 */

$currency = $currency ?? 'USD';

if (!isset($e)) {
    /** HTML-escape any scalar. */
    $e = static function ($value): string {
        return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES, 'UTF-8');
    };
}

if (!isset($money)) {
    /** Format a monetary amount in the platform currency. */
    $money = static function ($amount) use ($currency): string {
        return htmlspecialchars(
            ((string) $currency) . ' ' . number_format((float) $amount, 2),
            ENT_QUOTES,
            'UTF-8'
        );
    };
}

if (!isset($duration)) {
    /** Seconds -> mm:ss. */
    $duration = static function ($seconds): string {
        $seconds = (int) $seconds;

        return sprintf('%02d:%02d', intdiv($seconds, 60), $seconds % 60);
    };
}

if (!isset($labelFor)) {
    /** Map a lifecycle status onto a Bootstrap contextual class. */
    $labelFor = static function (string $status): string {
        $map = [
            'active'    => 'success',
            'connected' => 'success',
            'delivered' => 'success',
            'completed' => 'success',
            'ended'     => 'default',
            'sent'      => 'info',
            'received'  => 'primary',
            'ringing'   => 'info',
            'pending'   => 'warning',
            'queued'    => 'warning',
            'suspended' => 'warning',
            'failed'    => 'danger',
            'released'  => 'danger',
            'expired'   => 'default',
        ];

        return $map[$status] ?? 'default';
    };
}
