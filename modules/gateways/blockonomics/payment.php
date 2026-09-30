<?php

require_once __DIR__ . '/../../../init.php';
require_once __DIR__ . '/blockonomics.php';

use Blockonomics\Blockonomics;
use WHMCS\ClientArea;

define('CLIENTAREA', true);

// Init Blockonomics class
$blockonomics = new Blockonomics();
require $blockonomics->getLangFilePath(isset($_GET['language']) ? htmlspecialchars($_GET['language']) : '');

$ca = new ClientArea();

$ca->setPageTitle('Bitcoin Payment');

$ca->addToBreadCrumb('index.php', Lang::trans('globalsystemname'));
$ca->addToBreadCrumb('payment.php', 'Bitcoin Payment');

$ca->initPage();

$blockonomics->start_polling_job();

/*
 * SET POST PARAMETERS TO VARIABLES AND CHECK IF THEY EXIST
 */
$show_order = isset($_GET["show_order"]) ? htmlspecialchars($_GET['show_order']) : "";
$crypto = isset($_GET["crypto"]) ? htmlspecialchars($_GET['crypto']) : "";
$select_crypto = isset($_GET["select_crypto"]) ? htmlspecialchars($_GET['select_crypto']) : "";
$finish_order = isset($_GET["finish_order"]) ? htmlspecialchars($_GET['finish_order']) : "";
$get_order = isset($_GET['get_order']) ? htmlspecialchars($_GET['get_order']) : "";
$txn = isset($_GET['txn']) ? htmlspecialchars($_GET['txn']) : "";

/**
 * CloudHost247 server-side payment-method enforcement (spec §6–§8, §15–§16, §36).
 *
 * The browser is only a presentation layer: every NEW-payment path (currency selection,
 * checkout display, order creation/refresh) re-validates the master switch and the effective
 * per-currency availability on the server. Query parameters are never trusted. Only the
 * finish_order path for an already-created order is exempt, because at that point the
 * customer's funds may already be in flight and refusing to record them would strand the
 * payment — verification/crediting still happens exclusively in the callback/poller.
 */
$creating_new_payment = ($show_order !== "" || $select_crypto !== "" || $get_order !== "");
if ($creating_new_payment) {
    if (!\Blockonomics\GatewaySettings::gatewayEnabled()) {
        http_response_code(403);
        exit(\Blockonomics\GatewaySettings::unavailableMessage());
    }
    if ($crypto !== "" && $crypto !== "empty"
        && !\Blockonomics\GatewaySettings::currencyAvailable($crypto)) {
        http_response_code(403);
        exit(\Blockonomics\GatewaySettings::unavailableMessage());
    }
}
// USDT web3 finish redirects carry the on-chain transaction hash; accept only a plausible
// EVM hash so arbitrary strings never reach the order record (spec §36).
if ($txn !== "" && !preg_match('/^0x[0-9a-fA-F]{64}$/', $txn)) {
    $txn = "";
}

if($crypto === "empty"){
    $blockonomics->load_blockonomics_template($ca, 'no_crypto_selected');
}else if ($show_order && $crypto) {
    $blockonomics->load_checkout_template($ca, $show_order, $crypto);
}else if ($select_crypto) {
    $active_cryptos = $blockonomics->getActiveCurrencies();
    if (count($active_cryptos) === 0) {
        // Effective configuration offers nothing — honest "unavailable" page (spec §15 D).
        $blockonomics->load_blockonomics_template($ca, 'no_crypto_selected');
    } else {
        $blockonomics->load_blockonomics_template($ca, 'crypto_options', array(
            "cryptos" => $active_cryptos,
            "order_hash" => $select_crypto,
            "usdt_network_label" => \Blockonomics\GatewaySettings::usdtNetworkLabel()
        ));
    }
}else if ($finish_order) {
    if ($crypto == "usdt"){
        $blockonomics->process_token_order($finish_order, $crypto, $txn); 
    }
    $blockonomics->redirect_finish_order($finish_order);
}else if ($get_order && $crypto) {
    $existing_order = $blockonomics->processOrderHash($get_order, $crypto);
    // No order exists, exit
    if (is_null($existing_order->id_order)) {
        exit();
    } else {
        $response = [
            "order_amount" => $blockonomics->fix_displaying_small_values($existing_order->bits, $existing_order->blockonomics_currency),
            "crypto_rate_str" => $blockonomics->get_crypto_rate_from_params($existing_order->value, $existing_order->bits, $existing_order->blockonomics_currency),
            "payment_uri" => $blockonomics->get_payment_uri($blockonomics->getSupportedCurrencies()[$crypto]['uri'], $existing_order->addr, $existing_order->bits)
        ];
        header('Content-Type: application/json');
        exit(json_encode($response));
    }
}

$ca->assign('_BLOCKLANG', $_BLOCKLANG);

$ca->output();

exit();
