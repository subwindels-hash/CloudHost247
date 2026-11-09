/**
 * CloudHost247 — browser authentication ceremonies (Phase 5; closes the browser half of B-1).
 *
 * REAL-browser end-to-end coverage of the ceremonies that API-only checks cannot prove:
 * WebAuthn attestation/assertion needs a running authenticator, so this spec drives a CDP
 * virtual passkey authenticator through the REAL UI and API — no challenge-issuance shortcuts,
 * no mocked ceremony responses, no authenticator simulation at the HTTP layer.
 *
 *   1. Register → login (UI, incl. terms gate)
 *   2. Passkey REGISTRATION via /account UI + virtual authenticator (real attestation)
 *   3. Passkey AUTHENTICATION via the /login "Use a passkey" flow (real assertion)
 *   4. Passkey REVOCATION via UI → the deleted credential can no longer sign in (401)
 *   5. Session invalidation — logout: the exact token dies (401) immediately
 *   6. Session invalidation — password change: prior tokens die (session-version bump → 401)
 *   7. MFA recovery — a saved RECOVERY CODE completes the MFA login challenge
 *   8. Account recovery — reset request UX is byte-identical for known/unknown accounts
 *
 * Requires the FULL stack (API :3000 + dev/preview proxy). Run:
 *   npm run dev:stack &
 *   CH247_E2E_FULLSTACK=1 CH247_E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e -- e2e/auth-ceremonies.spec.ts
 * With a pre-existing Chromium where Playwright's CDN is unreachable:
 *   CH247_CHROMIUM_PATH=/path/to/chromium CH247_E2E_FULLSTACK=1 CH247_E2E_BASE_URL=... npm run e2e -- e2e/auth-ceremonies.spec.ts
 */
import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { randomBytes } from 'node:crypto';

const BASE = process.env.CH247_E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const FULLSTACK = process.env.CH247_E2E_FULLSTACK === '1';

test.skip(!FULLSTACK, 'Browser ceremonies need the full stack: set CH247_E2E_FULLSTACK=1 with the dev stack (or staging) up.');

function freshIdentity() {
  const stamp = randomBytes(4).toString('hex');
  return { email: `e2e-${stamp}@example.com`, password: `E2E-Pass-${stamp}!`, fullName: 'E2E Ceremony User' };
}

const storedToken = (page: Page) => page.evaluate(() => localStorage.getItem('ch247_token'));

async function uiRegister(page: Page, id: ReturnType<typeof freshIdentity>) {
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder('Full name').fill(id.fullName);
  await page.getByPlaceholder('Email').fill(id.email);
  await page.getByPlaceholder('Password', { exact: true }).fill(id.password);
  await page.getByPlaceholder('Confirm password').fill(id.password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL(/account|dashboard|verify/i, { timeout: 20_000 });
}

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
}

async function apiWithToken(page: Page, token: string, method: string, path: string, body?: unknown) {
  return page.evaluate(async ({ token, method, path, body }) => {
    const res = await fetch(path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.status;
  }, { token, method, path, body });
}

/** Attach a CDP virtual WebAuthn authenticator (platform, resident keys, verified user). */
async function addVirtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

/** RFC 6238 in the browser (SubtleCrypto) — the exact computation any authenticator app does. */
async function totpInBrowser(page: Page, secret: string): Promise<string> {
  return page.evaluate(async (secret) => {
    const b32 = (s: string) => {
      const map = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let bits = 0, v = 0; const out: number[] = [];
      for (const c of s.toUpperCase().replace(/=/g, '')) { v = (v << 5) | map.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
      return new Uint8Array(out);
    };
    const key = await crypto.subtle.importKey('raw', b32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const ctr = new ArrayBuffer(8); const dv = new DataView(ctr);
    const t = BigInt(Math.floor(Date.now() / 30000));
    dv.setUint32(0, Number(t >> 32n)); dv.setUint32(4, Number(t & 0xffffffffn));
    const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, ctr));
    const o = h[h.length - 1] & 15;
    return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000).padStart(6, '0');
  }, secret);
}

test.describe('browser authentication ceremonies (full stack required)', () => {
  test('1-4: passkey registration(UI) → authentication(Use a passkey) → revocation → 401', async ({ page }) => {
    const id = freshIdentity();
    await uiRegister(page, id);
    expect(await storedToken(page)).toBeTruthy();

    // --- 2. REGISTRATION ceremony: real attestation through the real UI ---
    await page.goto(`${BASE}/account`);
    const passkeyCard = page.locator('.ch247-card', { has: page.getByRole('heading', { name: 'Passkeys' }) });
    const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
    await passkeyCard.getByLabel('Passkey name').fill('E2E virtual authenticator');
    await passkeyCard.getByLabel('Confirm your password').fill(id.password);
    await passkeyCard.getByRole('button', { name: 'Add passkey' }).click();
    await expect(passkeyCard.getByText('Passkey added.')).toBeVisible({ timeout: 20_000 });
    const creds = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    expect((creds as { credentials: unknown[] }).credentials.length).toBe(1); // real credential materialized

    // --- 3. AUTHENTICATION ceremony: fresh session, "Use a passkey" REAL assertion flow ---
    await page.evaluate(() => { localStorage.removeItem('ch247_token'); localStorage.removeItem('ch247_user'); });
    await page.goto(`${BASE}/login`);
    await page.locator('#login-email').fill(id.email);
    await page.getByRole('button', { name: 'Use a passkey' }).click();
    await expect(page).toHaveURL(/account|dashboard/i, { timeout: 20_000 });
    expect(await storedToken(page)).toBeTruthy(); // session minted from a REAL WebAuthn assertion

    // --- 4. REVOCATION: remove the credential; the deleted passkey must no longer sign in ---
    await page.goto(`${BASE}/account`);
    page.on('dialog', (d) => d.accept(id.password));
    const card2 = page.locator('.ch247-card', { has: page.getByRole('heading', { name: 'Passkeys' }) });
    await card2.getByRole('button', { name: 'Remove' }).first().click();
    await expect(card2.getByText('Passkey removed.')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { localStorage.removeItem('ch247_token'); localStorage.removeItem('ch247_user'); });
    await page.goto(`${BASE}/login`);
    await page.locator('#login-email').fill(id.email);
    await page.getByRole('button', { name: 'Use a passkey' }).click();
    await expect(page.locator('#login-status')).toBeVisible({ timeout: 15_000 }); // honest error, no session
    await expect.poll(() => page.evaluate(() => localStorage.getItem('ch247_token'))).toBeNull();
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  });

  test('5: logout revokes the exact session token (401 on reuse)', async ({ page }) => {
    const id = freshIdentity();
    await uiRegister(page, id);
    const oldToken = await storedToken(page);
    expect(oldToken).toBeTruthy();
    expect(await apiWithToken(page, oldToken!, 'GET', '/api/v1/account/services')).toBe(200);
    await page.goto(`${BASE}/account`);
    await page.getByRole('button', { name: /log out/i }).click();
    expect(await apiWithToken(page, oldToken!, 'GET', '/api/v1/account/services')).toBe(401);
  });

  test('6: password change invalidates every prior session (401 on the old token)', async ({ page }) => {
    const id = freshIdentity();
    await uiRegister(page, id);
    const oldToken = await storedToken(page);
    const newPassword = `E2E-New-${randomBytes(4).toString('hex')}!`;
    await page.goto(`${BASE}/account`);
    const pwCard = page.locator('.ch247-card', { has: page.getByRole('heading', { name: 'Change password' }) });
    await pwCard.getByLabel(/current password/i).fill(id.password);
    await pwCard.getByLabel(/new password/i).first().fill(newPassword);
    const confirm = pwCard.getByLabel(/confirm new/i);
    if (await confirm.count()) await confirm.fill(newPassword);
    await pwCard.getByRole('button', { name: /change password|update password/i }).click();
    await expect(page.getByText(/password (has been |was )?(changed|updated)|success/i)).toBeVisible({ timeout: 15_000 });
    expect(await apiWithToken(page, oldToken!, 'GET', '/api/v1/account/services')).toBe(401);
  });

  test('7: MFA recovery — a saved recovery code completes the login challenge', async ({ page }) => {
    const id = freshIdentity();
    await uiRegister(page, id);
    await page.goto(`${BASE}/account`);
    const mfaCard = page.locator('.ch247-card', { has: page.getByRole('heading', { name: 'Multi-factor authentication' }) });
    await mfaCard.getByLabel(/Confirm your password to begin setup/).fill(id.password);
    await mfaCard.getByRole('button', { name: 'Set up authenticator app' }).click();
    await expect(mfaCard.locator('code').first()).toBeVisible({ timeout: 10_000 });
    const secret = (await mfaCard.locator('code').first().innerText()).trim();
    await mfaCard.getByLabel('Authenticator code').fill(await totpInBrowser(page, secret));
    await mfaCard.getByRole('button', { name: 'Confirm and enable MFA' }).click();
    await expect(mfaCard.getByText('Save these recovery codes now.')).toBeVisible({ timeout: 15_000 });
    const recoveryCodes = await mfaCard.locator('ul li code').allInnerTexts();
    expect(recoveryCodes.length).toBeGreaterThan(0);

    await page.evaluate(() => { localStorage.removeItem('ch247_token'); localStorage.removeItem('ch247_user'); });
    await uiLogin(page, id.email, id.password);
    await expect(page.getByPlaceholder('Authenticator or recovery code')).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('Authenticator or recovery code').fill(recoveryCodes[0].trim());
    await page.getByRole('button', { name: 'Verify and log in' }).click();
    await expect(page).toHaveURL(/account|dashboard/i, { timeout: 20_000 });
    expect(await storedToken(page)).toBeTruthy(); // session == recovery code accepted, TOTP never used
  });

  test('8: account recovery — reset UX byte-identical for known vs unknown accounts', async ({ page }) => {
    const id = freshIdentity();
    await uiRegister(page, id);
    await page.goto(`${BASE}/forgot-password`);
    await page.getByPlaceholder(/email/i).fill(id.email);
    await page.getByRole('button', { name: /reset|send|continue/i }).click();
    const knownHint = await page.getByText(/if an active account matches|reset link/i).innerText();
    await page.goto(`${BASE}/forgot-password`);
    await page.getByPlaceholder(/email/i).fill(`ghost-${randomBytes(3).toString('hex')}@example.com`);
    await page.getByRole('button', { name: /reset|send|continue/i }).click();
    const unknownHint = await page.getByText(/if an active account matches|reset link/i).innerText();
    expect(unknownHint).toBe(knownHint);
  });
});
