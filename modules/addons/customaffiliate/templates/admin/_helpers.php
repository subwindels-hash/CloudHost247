<?php
/**
 * Shared helpers for the admin templates.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

if (!isset($e)) {
    /** HTML escape. */
    $e = static function ($value): string {
        return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES, 'UTF-8');
    };
}

if (!isset($money)) {
    /** Two decimal money formatting. */
    $money = static function ($value): string {
        return number_format((float) $value, 2);
    };
}

if (!isset($moduleLink)) {
    $moduleLink = htmlspecialchars((string) ($vars['modulelink'] ?? ''), ENT_QUOTES, 'UTF-8');
}

if (!isset($statusLabel)) {
    $statusLabel = static function (string $status): string {
        $map = ['credited' => 'success', 'pending' => 'warning', 'reversed' => 'danger'];

        return $map[$status] ?? 'default';
    };
}
