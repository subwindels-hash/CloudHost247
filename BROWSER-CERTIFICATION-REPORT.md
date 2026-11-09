# CloudHost247 — Browser Certification Report (Phase 6, 2026-11-09)

## Status: STOPPED — infrastructure gate (documented per Phase 6 §7 discipline)

**Authorization discipline record (2026-11-09T13:40 UTC sweep):**

| Discipline check | Result | Evidence |
|---|---|---|
| Environment is staging/sandbox? | no browser environment exists at all in this sandbox | `which chromium chromium-browser google-chrome google-chrome-stable firefox` → none; `/root/.cache/ms-playwright` → absent |
| Browser acquisition channel? | unreachable — `cdn.playwright.dev` → connection failed (sandbox egress allowlist) | curl sweep 2026-11-09, exit 000 |
| Owner-approved browser environment supplied? | none supplied | credential/asset inventory: none |

**No test was executed in a browser. No prepared test is marked as passed.**

## What is certified without a browser (executed evidence, unchanged)

The **server halves** of every ceremony this report covers were executed live and green:
- Registration/login, duplicate/wrong-password refusals (Phase 3 steps 1–4).
- Uniform anti-enumeration password recovery, byte-identical known/unknown (Phase 3 step 5; Phase 4 probe P-1, including byte-identical 429s at the rate boundary).
- Full TOTP MFA ceremony incl. replay/single-use/out-of-window refusals and recovery codes (Phase 3 steps 6–10; Phase 4 probe P-5).
- Passkey challenge issuance (password-confirmed) and honest refusal for passkey-less accounts (Phase 3 step 11; Phase 4 P-6).
- Session expiration, revocation, session-version invalidation, forged-claim denial (Phase 4 probes P-2..P-4).
- Customer dashboard data APIs and admin boundaries (Phase 3 steps 12–16, 31).

## What requires browser execution (NONE of it claimed as run)

Prepared suite: `cloudhost247-node/e2e/auth-ceremonies.spec.ts` (+ responsive projects to extend /
existing config supports `CH247_CHROMIUM_PATH`).

| Ceremony | What only a browser proves | Prepared? |
|---|---|---|
| Passkey registration | real attestation from a real/ virtual authenticator (CDP) | ✅ spec §1–2 |
| Passkey sign-in | real assertion through "Use a passkey" UI flow | ✅ spec §3 |
| Passkey revocation | UI removal → 401 sign-in | ✅ spec §4 |
| MFA recovery | recovery-code challenge completion in browser | ✅ spec §7 |
| Password recovery UX | uniform copy + flow navigation | ✅ spec §8 |
| Session invalidation | logout/password-change prove old token 401 from same browser | ✅ spec §5–6 |
| Customer dashboard (visual) | render + data binding in real UA | covered by existing e2e config hooks (extension written into runbook below) |
| Administrative workflows (visual) | admin console journeys (requires authorized staging super_admin) | runbook step 6 |
| Responsive layouts | device emulation (`Pixel 7`/`iPhone`/desktop projects) | runbook step 7 |

## Unblock runbook (exact, for whoever holds the gate)

1. Provide any Chromium-family binary inside a permitted environment (`CH247_CHROMIUM_PATH=/path/to/chromium`), or allow egress to `cdn.playwright.dev` and run `npx playwright install chromium`.
2. Start the full stack: `cd cloudhost247-node && npm run dev:stack` (API :3000, web :5173 proxying /api).
3. Execute: `CH247_E2E_FULLSTACK=1 CH247_E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e -- e2e/auth-ceremonies.spec.ts`.
4. Dashboard/admin visual journeys: extend the same spec patterns with the authenticated navigation maps in `frontend/src/navigation/registry.generated.ts` (199 SPA routes enumerated there); admin journeys additionally require an **authorized staging super_admin account** (cannot be self-created — the super_admin boundary is load-bearing, Phase 4 audit).
5. Responsive: add `projects: ['Desktop Chrome', 'Pixel 7']` configs (config scaffold exists) and screenshot-compare layout contracts.
6. File raw Playwright traces (`trace: retain-on-failure` is already configured) under `docs/staging/` as execution evidence.

**Conclusion:** browser certification is NOT blocked by code; it is blocked by the absence of a
browser runtime and an egress path to fetch one. Everything scriptable is scripted; everything
claimable was claimed; nothing was claimed that wasn't run.
