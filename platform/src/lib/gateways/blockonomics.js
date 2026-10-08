/**
 * Blockonomics gateway — Bitcoin callbacks.
 *
 * Ported from the WHMCS build's `modules/gateways/callback/blockonomics.php` (plugin v1.9.8), which
 * is the only Blockonomics implementation this repository has ever had — `platform/` had none at
 * all. What is ported is the callback contract, exactly: the same authentication, the same
 * field-shape validation, the same confirmation rule, the same de-duplication key.
 *
 * **Authentication.** Blockonomics does not sign a body. It calls a callback URL registered with the
 * provider, and that URL carries a shared secret as a query parameter. The WHMCS callback compared
 * it with `hash_equals`; this port compares digests with `timingSafeEqual`, so neither the value nor
 * its length leaks. Verification happens before the receiver reads a single row — an unverified
 * caller costs one hash and one connection.
 *
 * **Parsing.** The provider reports `status` (confirmations seen), `value` (satoshis), `addr` (the
 * address it was told to watch) and `txid`:
 *   · every field is shape-checked before use — `status` is a small signed integer, `value` is
 *     digits only, `addr`/`txid` are short and restricted to characters an address or a transaction
 *     id can contain. A field that does not match is a malformed delivery, not a payment.
 *   · `status < confirmations required` means **not paid yet**: an unhandled event, recorded and
 *     ignored. Money does not move on a transaction the network has not confirmed.
 *   · a delivery that has reached the threshold is a `payment.success`, addressed by the Bitcoin
 *     address it names, and de-duplicated per `(address, txid, confirmations)` — so a re-delivery of
 *     one confirmation level is dropped while the *transition* to a higher one is a new event.
 *   · the threshold is the deployment's setting (`BLOCKONOMICS_CONFIRMATIONS`). It is never read
 *     from the callback: letting a caller declare its own payment confirmed defeats the threshold.
 *
 * **What it refuses, and why.** This build's money columns are `NUMERIC(16,2)` and the JSON backend
 * rounds matching that, so a Bitcoin amount cannot be *stored*: 0.00042 BTC becomes `0`, and a
 * payment credited that way would be marked succeeded while the invoice received nothing. The
 * receiver therefore records the delivery and refuses it by name (`exceedsLedgerPrecision`), naming
 * the figure it would have stored. That refusal is not a policy choice — a minor-unit ledger column
 * is the change that would make crypto settlement real, and until then a verified Bitcoin callback
 * is evidence, not a credit.
 *
 * Also refused, by name rather than by conversion:
 *   · **USDT / BCH.** The plugin supported them; each is a different unit with its own scale (USDT
 *     has six decimals) and its own quote model.
 *   · **The plugin's underpayment slack.** The audited callback credited partial payments
 *     proportionally (`underpayment_slack` percent of the quoted amount, converted back to invoice
 *     currency). This platform's rule is full payment or staff involvement, so an underpayment stays
 *     on the manual gateway. The plugin's rule is recorded here because it is the reference, not
 *     because it is applied.
 *   · **Issuing the monitoring address.** Starting a checkout needs the provider's address-issuance
 *     call (an API key plus egress) and a recorded `BTC amount + rate + quoted-at`; initiation is
 *     refused with that reason rather than handing a customer an address nobody is watching.
 */
'use strict';

const crypto = require('node:crypto');

const id = 'blockonomics';
const label = 'Bitcoin (Blockonomics)';
const configKey = 'BLOCKONOMICS_CALLBACK_SECRET';

/** The crypto this module settles. Everything else is refused by name, never guessed at. */
const SUPPORTED_CRYPTO = Object.freeze(['BTC']);
const CURRENCY = 'BTC';

/** Default number of confirmations before a payment is considered settled (plugin default: 2). */
const DEFAULT_CONFIRMATIONS = 2;

/** The gateway is driven by GET query parameters, not a signed body (Blockonomics' callback). */
const queryCallback = true;

const ADDRESS_RE = /^[a-zA-Z0-9:_-]{1,128}$/;
const TXID_RE = /^[a-zA-Z0-9]{1,128}$/;
const STATUS_RE = /^-?\d{1,2}$/;
const VALUE_RE = /^\d{1,20}$/;

function isConfigured(config) {
  return Boolean(config?.[configKey]);
}

/** Constant-time comparison over fixed-length digests, so neither value nor length leaks. */
function secretMatches(expected, supplied) {
  const a = crypto.createHash('sha256').update(String(expected)).digest();
  const b = crypto.createHash('sha256').update(String(supplied)).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Verify the callback secret from the query string.
 *
 * `context.query` is the parsed query object the receiver hands to every gateway. A gateway that
 * signs a body ignores it; this one has nothing else to check, because nothing else is signed.
 */
async function verify(_rawBody, _headers, config, context = {}) {
  const secret = config?.[configKey];
  if (!secret) return false;
  const supplied = context?.query?.secret;
  if (typeof supplied !== 'string' || supplied === '') return false;
  return secretMatches(secret, supplied);
}

/**
 * The confirmations this deployment requires — from configuration only.
 *
 * The callback carries the confirmations *observed*; the number *required* is the operator's
 * setting, exactly as the WHMCS plugin configured it. Accepting a threshold from the callback would
 * let a caller declare its own payment confirmed, which is the whole point of having a threshold.
 */
function confirmationsRequired(config) {
  const configured = Number(config?.BLOCKONOMICS_CONFIRMATIONS);
  return Number.isInteger(configured) && configured >= 0 ? configured : DEFAULT_CONFIRMATIONS;
}

class MalformedCallback extends Error {}

function requiredField(source, name, pattern) {
  const value = source[name];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new MalformedCallback(`${name} is missing or malformed`);
  }
  return value;
}

/**
 * Parse a Blockonomics callback into the platform's canonical event.
 *
 * `context.query` is the authority when there is no body: the plugin reads the callback's parameters
 * from the query string, and so does this.
 */
function parseEvent(rawBody, _headers, payloadHash, context = {}) {  // eslint-disable-line no-unused-vars
  let source = context?.query ?? {};
  if (!source || Object.keys(source).length === 0) {
    // A POST delivery with the parameters in the body is accepted too — the plugin's `$_GET` reads
    // either, so a provider that POSTs them keeps working.
    source = JSON.parse(rawBody.toString('utf8'));
  }

  const status = requiredField(source, 'status', STATUS_RE);
  const value = requiredField(source, 'value', VALUE_RE);
  const addr = requiredField(source, 'addr', ADDRESS_RE);
  const txid = requiredField(source, 'txid', TXID_RE);

  const cryptoCode = String(source.crypto ?? CURRENCY).toUpperCase();
  if (!SUPPORTED_CRYPTO.includes(cryptoCode)) {
    throw new MalformedCallback(`This gateway settles ${SUPPORTED_CRYPTO.join('/')}; the callback reports ${cryptoCode}`);
  }

  const observed = Number(status);
  const satoshis = Number(value);

  // One event id per (address, transaction, confirmation level): a re-delivery of the same state is
  // deduplicated by the receiver, while the transition from unconfirmed to confirmed is a *new*
  // event and therefore allowed to settle.
  const providerEventId = `${addr}:${txid}:${observed}`;

  const base = {
    gateway: id,
    providerEventId,
    // The address is the platform's payment reference: it is what the payment row was issued with,
    // and the receiver looks the pending payment up by it.
    providerPaymentReference: addr,
    amountCents: satoshis, // minor units: satoshis for BTC (see lib/money.js)
    currency: CURRENCY,
    eventOccurredAt: source.timestamp ? new Date(Number(source.timestamp) * 1000).toISOString() : new Date().toISOString(),
    payloadHash,
    confirmations: observed,
  };

  const threshold = confirmationsRequired(context?.config);
  if (observed < threshold) {
    // Unconfirmed (or partially confirmed). Recorded, ignored, and no money moves — the platform's
    // representation of "waiting for the network" that cannot be mistaken for payment.
    return { ...base, canonicalEventType: 'unhandled', outcome: 'pending', confirmationsRequired: threshold };
  }

  if (satoshis <= 0) {
    // A confirmed transaction that moved nothing is not a payment. Refused outright: there is no
    // honest way to credit an invoice from it.
    throw new MalformedCallback('A confirmed callback reported a zero amount');
  }

  return {
    ...base,
    canonicalEventType: 'payment.success',
    outcome: 'succeeded',
    confirmationsRequired: threshold,
    txid,
  };
}

module.exports = {
  id,
  label,
  configKey,
  queryCallback,
  isConfigured,
  verify,
  parseEvent,
  confirmationsRequired,
  SUPPORTED_CRYPTO,
  CURRENCY,
  DEFAULT_CONFIRMATIONS,
  MalformedCallback,
};
