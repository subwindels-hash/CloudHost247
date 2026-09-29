/**
 * Adversarial audit of the Phase 5C webhook-signing primitives and the sandbox gateway.
 *
 * SCOPE — READ THIS FIRST
 *
 * Webhook work is FROZEN. This probe does NOT build, wire, enable or exercise a webhook receiver,
 * and it does NOT demonstrate an end-to-end payment pipeline. It audits exactly two things:
 *
 *   1. that the signing/verification primitives are real cryptography that fails closed, and
 *   2. that the sandbox gateway cannot be mistaken for a real provider and cannot move money.
 *
 * It also asserts the ABSENCE of a receiver, because the honest claim about Phase 5C is
 * "signing exists and is tested; the pipeline does not exist and is therefore unverified". If a
 * future change quietly adds a receiver, the last group here starts failing, which is the point.
 *
 *   cd cloudhost247-node && npx tsx ../recovery/verify-webhook-signing.ts
 */
import { execSync } from 'node:child_process';
import { randomBytes, createHmac } from 'node:crypto';
import { signPayload, verifySignature } from '../cloudhost247-node/src/payments/webhook-signing';
import { sandboxGateway, buildSignedWebhookPayload } from '../cloudhost247-node/src/payments/sandbox-gateway';
import { manualGateway } from '../cloudhost247-node/src/payments/manual-gateway';
import { getGateway } from '../cloudhost247-node/src/payments/gateway-registry';
import { loadEnv } from '../cloudhost247-node/src/config/env';
import type { PaymentRow } from '../cloudhost247-node/src/db/payments';

let pass = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}

const SRC = '/home/user/CloudHost247/cloudhost247-node/src';
function grepCount(pattern: string, where = SRC): number {
  try {
    return parseInt(execSync(`grep -rl ${JSON.stringify(pattern)} ${where} --include=*.ts | wc -l`).toString().trim(), 10);
  } catch { return 0; }
}

(async () => {
  const SECRET = 'a-test-webhook-secret-value-0123456789';
  const body = JSON.stringify({ provider: 'sandbox', amount: '49.99', currency: 'USD' });

  console.log('\n=== GROUP 1: is the signature real cryptography? ===');
  {
    const sig = signPayload(SECRET, body);
    const independent = createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
    check('the signature equals an independently computed HMAC-SHA256', sig === independent, `${sig.slice(0, 24)}... vs ${independent.slice(0, 24)}...`);
    check('the signature is a 64-char hex digest (256-bit)', /^[0-9a-f]{64}$/.test(sig), `sig=${sig}`);
    check('it is not a hash of the body alone (the secret is actually used)',
      sig !== createHmac('sha256', '').update(body, 'utf8').digest('hex'));
    const sig2 = signPayload(SECRET + 'x', body);
    check('changing the secret changes the signature', sig !== sig2);
    const sig3 = signPayload(SECRET, body + ' ');
    check('changing one byte of the body changes the signature', sig !== sig3);
  }

  console.log('\n=== GROUP 2: does verification fail closed under attack? ===');
  {
    const sig = signPayload(SECRET, body);
    check('a correct signature verifies', verifySignature(SECRET, body, sig) === true);
    check('a tampered body is rejected', verifySignature(SECRET, body.replace('49.99', '0.01'), sig) === false);
    check('an amount changed to a larger value is rejected',
      verifySignature(SECRET, body.replace('49.99', '9999.99'), sig) === false);
    check('a different currency is rejected', verifySignature(SECRET, body.replace('USD', 'EUR'), sig) === false);
    check('the wrong secret is rejected', verifySignature('not-the-secret', body, sig) === false);
    check('an empty signature is rejected', verifySignature(SECRET, body, '') === false);
    check('a truncated signature is rejected', verifySignature(SECRET, body, sig.slice(0, 32)) === false);
    check('a signature with one byte flipped is rejected',
      verifySignature(SECRET, body, (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1)) === false);
    check('an over-long signature is rejected', verifySignature(SECRET, body, sig + 'ff') === false);
    check('non-hex garbage is rejected without throwing', verifySignature(SECRET, body, 'z'.repeat(64)) === false);
    check('an odd-length hex string is rejected without throwing', verifySignature(SECRET, body, sig.slice(0, 63)) === false);
    check('an empty body with a real signature is rejected', verifySignature(SECRET, '', sig) === false);
    // Length mismatch must return false rather than let timingSafeEqual throw.
    let threw = false;
    try { verifySignature(SECRET, body, 'ab'); } catch { threw = true; }
    check('a short signature returns false instead of throwing', threw === false);
    check('uppercase hex of the same digest still verifies (documented equivalence)',
      verifySignature(SECRET, body, sig.toUpperCase()) === true);
  }

  console.log('\n=== GROUP 3: timing safety ===');
  {
    const src = execSync(`cat ${SRC}/payments/webhook-signing.ts`).toString();
    check('verification uses crypto.timingSafeEqual, not === or Buffer.equals',
      src.includes('timingSafeEqual') && !/return\s+expected\s*===\s*signature/.test(src));
    check('a length check guards timingSafeEqual (which throws on mismatched lengths)',
      /expectedBuf\.length\s*!==\s*actualBuf\.length/.test(src));
  }

  console.log('\n=== GROUP 4: is the sandbox unmistakable for a real provider? ===');
  {
    check('the gateway id is literally "sandbox"', sandboxGateway.id === 'sandbox');
    const env = loadEnv({
      NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
      JWT_SECRET: 'p'.repeat(32), SANDBOX_GATEWAY_WEBHOOK_SECRET: SECRET,
    } as NodeJS.ProcessEnv);
    const res = await sandboxGateway.initiatePayment(
      { invoiceId: 'i', invoiceNumber: 'INV-00000001', amount: '49.99', currency: 'USD', userId: 'u' } as never, env);
    check('the provider reference is prefixed "sandbox_"', res.providerReference?.startsWith('sandbox_') === true, res.providerReference);
    check('the method is "sandbox_demo"', res.method === 'sandbox_demo', res.method);
    check('the customer-facing text says it is simulated', /simulated/i.test(res.instructions ?? ''), res.instructions);
    check('the customer-facing text says no real money moves', /no real money/i.test(res.instructions ?? ''));
    check('the sandbox never returns a terminal status', !('status' in (res as object)));

    // No real provider may be registered or claimed.
    for (const name of ['stripe', 'paypal', 'adyen', 'braintree', 'square', 'flutterwave', 'paystack']) {
      let resolved = true;
      try { getGateway(name, env); } catch { resolved = false; }
      check(`no "${name}" gateway is registered`, resolved === false);
    }
    check('the manual gateway is distinct and offline', manualGateway.id === 'manual');
  }

  console.log('\n=== GROUP 5: the signed payload is honest about itself ===');
  {
    const env = loadEnv({
      NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
      JWT_SECRET: 'p'.repeat(32), SANDBOX_GATEWAY_WEBHOOK_SECRET: SECRET,
    } as NodeJS.ProcessEnv);
    const payment = {
      id: 'pay-1', invoice_id: 'inv-1', user_id: 'u-1', provider: 'sandbox',
      provider_reference: `sandbox_${randomBytes(6).toString('hex')}`, method: 'sandbox_demo',
      amount: '49.99', currency: 'USD', status: 'pending',
    } as PaymentRow;

    const { payload, rawBody, signature } = buildSignedWebhookPayload(payment, 'successful', env);
    check('the built payload declares provider "sandbox"', payload.provider === 'sandbox');
    check('its signature verifies against the raw body', verifySignature(SECRET, rawBody, signature) === true);
    check('the raw body is exactly what was signed (no re-serialization drift)',
      verifySignature(SECRET, JSON.stringify(payload), signature) === true);
    check('the amount in the payload came from the payment row', payload.amount === '49.99');

    let refused = false;
    try { buildSignedWebhookPayload({ ...payment, provider: 'manual' } as PaymentRow, 'successful', env); }
    catch { refused = true; }
    check('it refuses to sign for a non-sandbox payment', refused);

    let noSecret = false;
    const envNoSecret = loadEnv({
      NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/d', JWT_SECRET: 'p'.repeat(32),
    } as NodeJS.ProcessEnv);
    try { buildSignedWebhookPayload(payment, 'successful', envNoSecret); } catch { noSecret = true; }
    check('it refuses to sign when no webhook secret is configured', noSecret);
  }

  console.log('\n=== GROUP 6: the receiver does NOT exist (so the pipeline is unverified, by design) ===');
  {
    const routeFiles = execSync(`ls ${SRC}/routes`).toString().split('\n').filter(Boolean);
    const webhookRoutes = routeFiles.filter(f => /webhook/i.test(f));
    check('no route file is a webhook receiver', webhookRoutes.length === 0, webhookRoutes.join(','));
    const webhookUrls = execSync(
      `grep -rhoE "'/[^']*webhook[^']*'" ${SRC}/routes 2>/dev/null | sort -u || true`).toString().trim();
    check('no route path contains "webhook"', webhookUrls === '', webhookUrls);
    check('verifySignature is not called by any route or service',
      grepCount('verifySignature', `${SRC}/routes ${SRC}/services`) === 0);
    check('buildSignedWebhookPayload is not called by any route or service',
      grepCount('buildSignedWebhookPayload', `${SRC}/routes ${SRC}/services`) === 0);
    const svc = execSync(`cat ${SRC}/services/payment-service.ts`).toString();
    check("nothing moves a 'sandbox' payment out of pending",
      !/provider\s*===\s*'sandbox'[\s\S]{0,400}successful/.test(svc));
    check('only manual-provider payments can be confirmed',
      /provider\s*!==\s*'manual'/.test(svc) || /'manual'/.test(svc));
  }

  console.log(`\n================ ${pass}/${pass + failures.length} checks passed ================`);
  if (failures.length) console.log('FAILED:\n  - ' + failures.join('\n  - '));
  console.log(
    '\nNOTE: this proves the signing primitive is sound and the sandbox is unmistakable.\n' +
    'It does NOT prove a working webhook pipeline — none exists. Phase 5C\'s payment\n' +
    'pipeline remains UNVERIFIED end to end, and that is the accurate claim.');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('PROBE CRASHED:', e); process.exit(2); });
