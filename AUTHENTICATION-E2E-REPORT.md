# CloudHost247 — Authentication E2E Report (Phase 5, 2026-11-09)

## Certification honesty statement

API challenge issuance has **never** been substituted for real browser authentication anywhere
in this project's evidence. The server halves of every ceremony below were executed against the
live system (Phase 3: 33/33; Phase 4: 23/23 independent probes). The **browser** halves require
a browser binary, which this environment cannot obtain (Playwright download CDN unreachable —
`curl https://cdn.playwright.dev/...` → connection failure, repeated 2026-11-09; no system
Chromium/Chrome/Firefox/WebKit binary installed). The browser ceremony suite therefore ships
**prepared, selector-accurate, executable** — but it is NOT claimed as executed.

## Prepared artifact

`cloudhost247-node/e2e/auth-ceremonies.spec.ts` — Playwright, real dev stack
(`CH247_E2E_FULLSTACK=1 CH247_E2E_BASE_URL=http://127.0.0.1:5173 npm run e2e -- e2e/auth-ceremonies.spec.ts`;
custom Chromium: `CH247_CHROMIUM_PATH=/path/to/chromium …`).
Every selector was extracted from the actual SPA source (not guessed):

| # | Ceremony | Mechanism the spec drives | Server-half proof already executed |
|---|---|---|---|
| 1 | Register & login (UI) | real /register + /login forms (incl. terms checkbox) | Phase 3 steps 1–4; probes P-1/P-2 |
| 2 | **Passkey registration** | `/account` "Add passkey" form + **CDP virtual authenticator** producing a real attestation; credential presence asserted via `WebAuthn.getCredentials` | options ceremony: Phase 3 step 11 (password-confirmed, challengeId) |
| 3 | **Passkey authentication** | `/login` "Use a passkey" (real `startAuthentication` assertion) → session token in localStorage | login/options honest 401 for passkey-less accounts (Phase 4 P-6) |
| 4 | **Passkey revocation** | `/account` "Remove" (password-prompt) → repeat attempt: `login/options` → 401 (asserted live in this phase via API) + UI error | API coverage (passkey suites) |
| 5 | Session invalidation — logout | UI logout, then old bearer token re-fired → 401 | probes P-4 (204 then 401 "logged out") |
| 6 | Session invalidation — password change | UI "Change password" form → old token 401 immediately (session-version bump) | probe: forged-sv 401; `require-auth.ts` sv check reviewed |
| 7 | **MFA recovery** | real TOTP enrollment through UI with in-browser RFC 6238, then login challenge completed with a **recovery code** (not TOTP) → session minted | replay/single-use/out-of-window refusals (Phase 4 P-5) |
| 8 | Account recovery | `/forgot-password` UX byte-identical for known vs unknown email | probes P-1 (byte-identical 202s, uniform even at 429) |

## Browser-execution status

**BLOCKED — environment, not code.** The Playwright browser download host is outside this
sandbox's network allowlist and no pre-installed browser exists. Execution plan when a browser
is available: `npx playwright install chromium` OR set `CH247_CHROMIUM_PATH`; ensure dev stack
running; run the single spec file above with the env vars shown. Expected runtime ≈ 1–2 min.

## What is NOT claimed

- No visual/responsive attestation of these pages (device emulation runs at the same time the
  above executes; the spec can be extended with `projects` for `Desktop Chrome`/`Pixel 7`).
- No WebAuthn attestation *result* — until this spec runs green, "passkeys work in a browser"
  remains a certified-API + prepared-browser claim.
- The account-recovery ceremony covers only the request half end-to-end in-browser; the link
  follow-through needs a configured mail relay (owner infra).

Interim posture: server halves CERTIFIED (executed); browser halves SPEC-READY (prepared, unexecuted).
