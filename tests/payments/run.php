<?php
/**
 * CloudHost247 Payments behavioural tests.
 *
 * Runs without WHMCS: only the pure decision logic is exercised — the Blockonomics
 * availability matrix (spec §15), USDT configuration validation (spec §9, §33–§34) and the
 * normalized status mapping (spec §19). Database-backed and network-backed paths are covered
 * by the static suite (test_static.py) and by manual gateway testing on a WHMCS install.
 */
$root = dirname(__DIR__, 2);

// The gateway settings resolver only needs the Capsule symbol to exist to be loadable; the
// pure functions under test never touch it.
if (!class_exists('WHMCS\\Database\\Capsule')) {
    eval('namespace WHMCS\\Database; class Capsule { public static function table($n){ throw new \\RuntimeException("DB access is not allowed in pure-logic tests"); } public static function schema(){ throw new \\RuntimeException("DB access is not allowed in pure-logic tests"); } }');
}

require_once $root . '/modules/gateways/blockonomics/lib/GatewaySettings.php';
require_once $root . '/modules/addons/cloudhost247_payments/lib/Support/StatusMapper.php';

use Blockonomics\GatewaySettings;
use CloudHost247\Payments\Support\StatusMapper;

$VALID_USDT = array('UsdtAddress' => '0x' . str_repeat('a', 40), 'NetworkType' => 'ethereum');

$tests = array();

/* ------------------------------------------------------- availability matrix (spec §15) */

$tests['A: gateway ON, BTC ON, USDT OFF -> BTC only'] = function () use ($VALID_USDT) {
    $s = array_merge($VALID_USDT, array('GatewayEnabled' => 'on', 'btcEnabled' => 'on', 'usdtEnabled' => ''));
    return GatewaySettings::effectiveCurrenciesFrom($s, true) === array('btc');
};
$tests['B: gateway ON, BTC OFF, USDT ON -> USDT only'] = function () use ($VALID_USDT) {
    $s = array_merge($VALID_USDT, array('GatewayEnabled' => 'on', 'btcEnabled' => '', 'usdtEnabled' => 'on'));
    return GatewaySettings::effectiveCurrenciesFrom($s, true) === array('usdt');
};
$tests['C: gateway ON, BTC ON, USDT ON -> both'] = function () use ($VALID_USDT) {
    $s = array_merge($VALID_USDT, array('GatewayEnabled' => 'on', 'btcEnabled' => 'on', 'usdtEnabled' => 'on'));
    return GatewaySettings::effectiveCurrenciesFrom($s, true) === array('btc', 'usdt');
};
$tests['D: gateway ON, both OFF -> unavailable'] = function () use ($VALID_USDT) {
    $s = array_merge($VALID_USDT, array('GatewayEnabled' => 'on', 'btcEnabled' => '', 'usdtEnabled' => ''));
    return GatewaySettings::effectiveCurrenciesFrom($s, true) === array();
};
$tests['E: gateway OFF overrides enabled currencies (master switch precedence)'] = function () use ($VALID_USDT) {
    $s = array_merge($VALID_USDT, array('GatewayEnabled' => '', 'btcEnabled' => 'on', 'usdtEnabled' => 'on'));
    // GatewayEnabled saved as '' (OFF) must disable everything.
    $s['GatewayEnabled'] = 'off';
    return GatewaySettings::effectiveCurrenciesFrom($s, true) === array()
        && GatewaySettings::gatewayEnabledFrom($s) === false;
};

/* --------------------------------------------------- defaults & backwards compatibility */

$tests['absent master switch defaults to ON (existing installs unbroken)'] = function () {
    return GatewaySettings::gatewayEnabledFrom(array()) === true
        && GatewaySettings::gatewayEnabledFrom(array('GatewayEnabled' => '')) === true
        && GatewaySettings::gatewayEnabledFrom(array('GatewayEnabled' => 'on')) === true;
};
$tests['currency flags are explicit, never hard-coded on'] = function () {
    return GatewaySettings::currencyFlagFrom(array(), 'btc') === false
        && GatewaySettings::currencyFlagFrom(array('btcEnabled' => 'on'), 'btc') === true
        && GatewaySettings::currencyFlagFrom(array('usdtEnabled' => ''), 'usdt') === false;
};

/* ------------------------------------------------------ configuration validity (fail closed) */

$tests['BTC requires a configured API credential'] = function () use ($VALID_USDT) {
    $s = array_merge($VALID_USDT, array('GatewayEnabled' => 'on', 'btcEnabled' => 'on'));
    return GatewaySettings::effectiveCurrenciesFrom($s, false) === array();
};
$tests['USDT requires a valid 0x receiving address'] = function () {
    $bad = array('GatewayEnabled' => 'on', 'usdtEnabled' => 'on', 'UsdtAddress' => 'not-an-address', 'NetworkType' => 'ethereum');
    $short = array('GatewayEnabled' => 'on', 'usdtEnabled' => 'on', 'UsdtAddress' => '0x1234', 'NetworkType' => 'ethereum');
    return GatewaySettings::effectiveCurrenciesFrom($bad, true) === array()
        && GatewaySettings::effectiveCurrenciesFrom($short, true) === array()
        && GatewaySettings::usdtAddressValid('0x' . str_repeat('Ab1', 13) . 'a') === false;
};
$tests['USDT requires a supported network — none are invented'] = function () {
    $tron = array('GatewayEnabled' => 'on', 'usdtEnabled' => 'on', 'UsdtAddress' => '0x' . str_repeat('b', 40), 'NetworkType' => 'trc20');
    return GatewaySettings::effectiveCurrenciesFrom($tron, true) === array()
        && GatewaySettings::usdtNetworkValid('polygon') === false
        && GatewaySettings::usdtNetworkValid('ethereum') === true
        && GatewaySettings::usdtNetworkValid('sepolia') === true
        && array_keys(GatewaySettings::supportedUsdtNetworks()) === array('ethereum', 'sepolia');
};
$tests['network labels are explicit and test networks are distinguished'] = function () {
    $mainnet = GatewaySettings::usdtNetworkLabelFrom(array('NetworkType' => 'ethereum'));
    $testnet = GatewaySettings::usdtNetworkLabelFrom(array('NetworkType' => 'sepolia'));
    $missing = GatewaySettings::usdtNetworkLabelFrom(array());
    return $mainnet === 'Ethereum'
        && stripos($testnet, 'TEST') !== false
        && $missing === 'network not configured';
};
$tests['unavailable message is safe and generic'] = function () {
    $message = GatewaySettings::unavailableMessage();
    return $message === 'This payment method is currently unavailable.'
        && stripos($message, 'key') === false;
};

/* -------------------------------------------------------------- status mapping (spec §19) */

$now = 1700000000;

$tests['status: fresh unpaid order is Pending'] = function () use ($now) {
    return StatusMapper::map(-1, '', $now - 60, 10, 2, false, 1000, 0, $now) === StatusMapper::PENDING;
};
$tests['status: unpaid order past the window is Expired'] = function () use ($now) {
    return StatusMapper::map(-1, '', $now - 1200, 10, 2, false, 1000, 0, $now) === StatusMapper::EXPIRED;
};
$tests['status: detected transaction below confirmations is Confirming'] = function () use ($now) {
    return StatusMapper::map(0, 'abc123', $now - 60, 10, 2, false, 1000, 1000, $now) === StatusMapper::CONFIRMING
        && StatusMapper::map(1, 'abc123', $now - 60, 10, 2, false, 1000, 1000, $now) === StatusMapper::CONFIRMING;
};
$tests['status: confirmed but no WHMCS payment record is still NOT Paid'] = function () use ($now) {
    return StatusMapper::map(2, 'abc123', $now - 60, 10, 2, false, 1000, 1000, $now) === StatusMapper::CONFIRMING;
};
$tests['status: Paid only with confirmations AND the WHMCS accounting record'] = function () use ($now) {
    return StatusMapper::map(2, 'abc123', $now - 60, 10, 2, true, 1000, 1000, $now) === StatusMapper::PAID;
};
$tests['status: credited underpayment is labelled Underpaid, not silently Paid'] = function () use ($now) {
    return StatusMapper::map(2, 'abc123', $now - 60, 10, 2, true, 1000, 400, $now) === StatusMapper::UNDERPAID;
};
$tests['status: overpayment maps to Paid (credited per existing billing rules)'] = function () use ($now) {
    return StatusMapper::map(2, 'abc123', $now - 60, 10, 2, true, 1000, 1500, $now) === StatusMapper::PAID;
};
$tests['status: zero-confirmation configuration honours the accounting record'] = function () use ($now) {
    return StatusMapper::map(0, 'abc123', $now - 60, 10, 0, true, 1000, 1000, $now) === StatusMapper::PAID
        && StatusMapper::map(0, 'abc123', $now - 60, 10, 0, false, 1000, 1000, $now) === StatusMapper::CONFIRMING;
};

/* ---------------------------------------------------------------------------- execute */

$passed = 0;
$failed = array();
foreach ($tests as $name => $test) {
    try {
        $ok = (bool) $test();
    } catch (\Throwable $error) {
        $ok = false;
        $name .= ' [exception: ' . $error->getMessage() . ']';
    }
    if ($ok) {
        $passed++;
        echo "PASS  $name\n";
    } else {
        $failed[] = $name;
        echo "FAIL  $name\n";
    }
}

echo "\n$passed passed, " . count($failed) . " failed\n";
exit($failed ? 1 : 0);
