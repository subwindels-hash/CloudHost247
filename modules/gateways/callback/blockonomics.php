<?php

// Require libraries needed for gateway module functions.
require '../../../init.php';
require '../../../includes/gatewayfunctions.php';
require '../../../includes/invoicefunctions.php';

require '../blockonomics/blockonomics.php';

use Blockonomics\Blockonomics;

// Init Blockonomics class
$blockonomics = new Blockonomics();

$gatewayModuleName = 'blockonomics';

// Fetch gateway configuration parameters.
$gatewayParams = getGatewayVariables($gatewayModuleName);

// Die if module is not active.
if (!$gatewayParams['type']) {
    exit('Module Not Activated');
}

require_once $blockonomics->getLangFilePath();

// Retrieve data returned in payment gateway callback
$secret = isset($_GET['secret']) ? htmlspecialchars($_GET['secret']) : '';
$status = isset($_GET['status']) ? htmlspecialchars($_GET['status']) : '';
$addr = isset($_GET['addr']) ? htmlspecialchars($_GET['addr']) : '';
$value = isset($_GET['value']) ? htmlspecialchars($_GET['value']) : '';
$txid = isset($_GET['txid']) ? htmlspecialchars($_GET['txid']) : '';

/**
 * CloudHost247 hardening (spec §21–§23): a callback is untrusted input. Authenticate it with a
 * timing-safe secret comparison, then validate the SHAPE of every field before any database
 * read or write. Anything malformed is rejected with a generic response — no information leak,
 * no partial state change. All checks fail closed.
 */
$secret_value = $blockonomics->getCallbackSecret();

if (!is_string($secret_value) || $secret_value === ''
    || $secret === '' || !hash_equals((string) $secret_value, (string) $secret)) {
    http_response_code(403);
    echo isset($_BLOCKLANG['error']['secret']) ? $_BLOCKLANG['error']['secret'] : 'Invalid callback.';
    exit();
}

// status: small signed integer (Blockonomics uses 0..2). value: satoshi/base units, digits only.
if (!preg_match('/^-?\d{1,2}$/', $status) || !preg_match('/^\d{1,20}$/', $value)) {
    http_response_code(400);
    exit('Invalid callback.');
}
// addr: BTC/BCH address or the gateway's USDT composite reference. txid: hex / provider id.
if ($addr === '' || strlen($addr) > 128 || !preg_match('/^[a-zA-Z0-9:_-]+$/', $addr)) {
    http_response_code(400);
    exit('Invalid callback.');
}
if ($txid === '' || strlen($txid) > 128 || !preg_match('/^[a-zA-Z0-9]+$/', $txid)) {
    http_response_code(400);
    exit('Invalid callback.');
}
$status = (int) $status;
$value = (float) $value;

$order = $blockonomics->getOrderByAddress($addr);

// Address we never issued → reject. The payment identity must be OURS (spec §21).
if ($order === null || empty($order['order_id'])) {
    http_response_code(404);
    exit('Invalid callback.');
}

$invoiceId = $order['order_id'];
$bits = $order['bits'];

// Currency recorded on OUR order row is authoritative; it must be one the gateway supports.
if (!array_key_exists($order['blockonomics_currency'], $blockonomics->getSupportedCurrencies())) {
    http_response_code(400);
    exit('Invalid callback.');
}

// A zero/unset expected amount can never be credited from a percentage calculation.
if (!is_numeric($bits) || (float) $bits <= 0) {
    http_response_code(400);
    exit('Invalid callback.');
}

$confirmations = $blockonomics->getConfirmations();

$blockonomics_currency_code = $order['blockonomics_currency'];
$blockonomics_currency = $blockonomics->getSupportedCurrencies()[$blockonomics_currency_code];
if ($blockonomics_currency_code == 'btc') {
    $subdomain = 'www';
} else {
    $subdomain = $blockonomics_currency_code;
}

$systemUrl = \App::getSystemURL();
if ($status < $confirmations) {
    $invoiceNote = '<b>' . $_BLOCKLANG['invoiceNote']['waiting'] . ' <img src="' . $systemUrl . 'modules/gateways/blockonomics/assets/img/' . $blockonomics_currency_code . '.png" style="max-width: 20px;"> ' . $blockonomics_currency->name . ' ' . $_BLOCKLANG['invoiceNote']['network'] . "</b>\r\r" .
    $blockonomics_currency->name . " transaction id:\r" .
        '<a target="_blank" href="https://' . $subdomain . ".blockonomics.co/api/tx?txid=$txid&addr=$addr\">$txid</a>";

    $blockonomics->updateOrderInDb($addr, $txid, $status, $value);
    $blockonomics->updateInvoiceNote($invoiceId, $invoiceNote);

    exit();
}

$underpayment_slack = $blockonomics->getUnderpaymentSlack() / 100 * $bits;
if ($value < $bits - $underpayment_slack || $value > $bits) {
    $satoshiAmount = $value;
} else {
    $satoshiAmount = $bits;
}
$percentPaid = $satoshiAmount / $bits * 100;
$paymentAmount = $blockonomics->convertPercentPaidToInvoiceCurrency($order, $percentPaid);
$blockonomics->updateInvoiceNote($invoiceId, null);
$blockonomics->updateOrderInDb($addr, $txid, $status, $value);

/**
 * Validate Callback Invoice ID.
 *
 * Checks invoice ID is a valid invoice number. Note it will count an
 * invoice in any status as valid.
 *
 * Performs a exit upon encountering an invalid Invoice ID.
 *
 * Returns a normalised invoice ID.
 *
 * @param int $invoiceId Invoice ID
 * @param string $gatewayName Gateway Name
 */
$invoiceId = checkCbInvoiceID($invoiceId, $gatewayParams['name']);


if ($txid == 'WarningThisIsAGeneratedTestPaymentAndNotARealBitcoinTransaction') {
    // If this is test transaction, generate new transaction ID
    $txid = 'WarningThisIsATestTransaction - ' . $addr;
} else {
    /**
     * Add address to txid, this is because multiple addresses may have 
     * same transaction ids (due to how bitcoin operates, see ref), which 
     * causes invoices with such cases to be skipped due to which they are 
     * not marked as paid in WHMCS.
     * Ref: https://bitcoin.stackexchange.com/a/43136
     * Ref: https://github.com/blockonomics/whmcs-bitcoin-plugin/issues/79
     * 
     * Adding address to the txid makes the transaction id unique in 
     * WHMCS which solves the above issue.
     * 
     */ 
    $txid = $txid . " - " . $addr;
}

/**
 * Check Callback Transaction ID.
 *
 * Performs a check for any existing transactions with the same given
 * transaction number.
 *
 * Performs a exit upon encountering a duplicate.
 *
 * @param string $transactionId Unique Transaction ID
 */

if ($blockonomics->checkIfTransactionExists($blockonomics_currency_code . ' - ' . $txid)) {
    exit();
}

/**
 * Log Transaction.
 *
 * Add an entry to the Gateway Log for debugging purposes.
 *
 * The debug data can be a string or an array. In the case of an
 * array it will be
 *
 * @param string $gatewayName        Display label
 * @param string|array $debugData    Data to log
 * @param string $transactionStatus  Status
 */
$loggedCallback = $_GET;
if (isset($loggedCallback['secret'])) {
    $loggedCallback['secret'] = '[REDACTED]';
}
logTransaction($gatewayParams['name'], $loggedCallback, 'Successful');

$paymentFee = 0;

/**
 * Add Invoice Payment.
 *
 * Applies a payment transaction entry to the given invoice ID.
 *
 * @param int $invoiceId         Invoice ID
 * @param string $transactionId  Transaction ID
 * @param float $paymentAmount   Amount paid (defaults to full balance)
 * @param float $paymentFee      Payment fee (optional)
 * @param string $gatewayModule  Gateway module name
 */
addInvoicePayment(
    $invoiceId,
    $blockonomics_currency_code . ' - ' . $txid,
    $paymentAmount,
    $paymentFee,
    $gatewayModuleName
);
