<?php
/**
 * Read-only rate feed for the Node platform's display currency conversion.
 *
 * This is the only bridge from the WHMCS rate addon to the Node platform. It publishes the rates of
 * the latest SUCCESSFUL update run, for the currencies the operator has enabled in this addon. It
 * never writes anything, and it never publishes a rate that did not come from a successful run.
 *
 * Contract (GET, bearer-token authenticated):
 *   200 {"base":"USD","runId":123,"rates":[{"code":"EUR","rate":0.9231,"observedAt":"2026-10-12T06:00:00+00:00"}]}
 *   200 {"base":"USD","runId":null,"rates":[]}                 no successful run yet
 *   401 unauthorized | 405 method_not_allowed | 409 base_currency_mismatch | 503 feed_not_configured
 *
 * `rate` is the EFFECTIVE rate (provider rate plus the configured margin, rounded as configured):
 * the same value WHMCS writes to tblcurrencies.rate, so display amounts agree with WHMCS invoices.
 * Units: one USD buys `rate` units of the listed currency.
 *
 * The token lives in mod_cloudhost247_currency_settings under `display_feed_token`. When it is empty
 * the feed refuses every request. Deploy notes are in docs/CURRENCY_DISPLAY.md.
 */
define('CLIENTAREA', true);
require_once __DIR__ . '/../../../init.php';

use WHMCS\Database\Capsule;

function ch247_fx_respond($status, array $body)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body);
    exit;
}

function ch247_fx_iso_utc($localDateTime)
{
    // The addon stores timestamps with date('Y-m-d H:i:s'), i.e. in PHP's default timezone.
    $dt = new DateTime((string) $localDateTime, new DateTimeZone(date_default_timezone_get()));
    return $dt->setTimezone(new DateTimeZone('UTC'))->format('c');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    ch247_fx_respond(405, array('error' => 'method_not_allowed'));
}

$expected = (string) Capsule::table('mod_cloudhost247_currency_settings')
    ->where('setting_key', 'display_feed_token')
    ->value('setting_value');
if ($expected === '') {
    ch247_fx_respond(503, array('error' => 'feed_not_configured'));
}

$authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
if (!preg_match('/^Bearer\s+(\S+)$/', (string) $authorization, $matches) || !hash_equals($expected, $matches[1])) {
    ch247_fx_respond(401, array('error' => 'unauthorized'));
}

$run = Capsule::table('mod_cloudhost247_currency_runs')
    ->where('status', 'success')
    ->orderBy('id', 'desc')
    ->first();
if (!$run) {
    ch247_fx_respond(200, array('base' => 'USD', 'runId' => null, 'rates' => array()));
}

$base = strtoupper((string) $run->base_currency);
if ($base !== 'USD') {
    ch247_fx_respond(409, array('error' => 'base_currency_mismatch'));
}

$enabledCodes = Capsule::table('mod_cloudhost247_currency_config')
    ->where('enabled', 1)
    ->pluck('currency_code')
    ->all();

$rates = array();
if ($enabledCodes) {
    $rows = Capsule::table('mod_cloudhost247_currency_rates')
        ->where('run_id', $run->id)
        ->whereIn('currency_code', $enabledCodes)
        ->orderBy('currency_code')
        ->get();
    foreach ($rows as $row) {
        $code = strtoupper((string) $row->currency_code);
        if ($code === $base || !preg_match('/^[A-Z]{3}$/', $code)) {
            continue;
        }
        $rate = (float) $row->effective_rate;
        if (!is_finite($rate) || $rate <= 0) {
            continue;
        }
        $rates[] = array(
            'code' => $code,
            'rate' => $rate,
            'observedAt' => ch247_fx_iso_utc($row->observed_at),
        );
    }
}

ch247_fx_respond(200, array('base' => 'USD', 'runId' => (int) $run->id, 'rates' => $rates));
