# CloudHost247 — Authentication & Security Audit (Phase 4 independent, 2026-11-09)

Method: source review of `src/routes/auth.ts`, `src/lib/jwt.ts`, `src/lib/require-auth.ts`,
`src/lib/require-role.ts`, `src/services/totp-mfa-service.ts`, `src/services/passkey-*.ts`,
`src/db/revoked-tokens.ts` usage, plus **23/23 live independent probes** (fresh code, evidence:
`docs/staging/phase4-independent-probe-evidence-2026-11-09.json`). No security control was
weakened or bypassed to obtain any result; probe failures were always fixed on the probe side.

| Area | Independent evidence | Verdict |
|---|---|---|
| Registration | 201 new; duplicate 409 live | SOUND |
| Login | wrong password 401; valid → signed HS256 JWT with jti/iat/exp | SOUND |
| Password reset (anti-enumeration) | known vs unknown → byte-identical 202; **under rate-limit pressure the 429s are also byte-identical** — no enumeration at either layer; durable per-account issue limit in `issueAuthAction` (DB) complements per-IP limits | SOUND |
| MFA/TOTP replay protection | `last_used_timestep` single-use enforced in DB tx: (1) replay of enrollment-confirmed code → **401 in-window**; (2) reuse of a successfully used login code on a new challenge → **401**; (3) out-of-window code (±3 steps) → **401**; (4) fresh adjacent window → **200** (proves the positive path, not just denials) | SOUND |
| Passkey challenge lifecycle | register/options requires password (400 without); login/options for passkey-less account fails honestly 401 with explicit message; challenge challengeId + server-stored challenge; attestation/assertion crypto halves are browser+library-bound → **B-1** remains | SOUND (server half), browser half open |
| Session expiration | minted already-expired JWT (real secret, real claims, past exp) → **401** | SOUND |
| Session revocation | POST /api/auth/logout → 204; immediate reuse of the same token → **401 "This session has been logged out"** (jti in `revoked_tokens`, checked per-request) | SOUND |
| Session-version invalidation | forged `sv` (wrong auth session generation) → **401** with explicit message; design reviewed: monotonic `auth_session_version` incremented atomically with password changes; legacy same-second `password_changed_at` edge case is consciously documented in code (accepted trade-off, narrowly scoped) | SOUND |
| Token forgery | wrong-secret signature → 401; valid-signature **forged `role:"super_admin"` claim** for a customer account → **403** — roles are re-read from the DB on every request (`requireRole`), so claim tampering with a stolen-key-quiet... even with the real secret cannot elevate a customer | SOUND |
| CSRF | API is pure bearer-token: **no session cookies issued (verified: no Set-Cookie)** → classic CSRF is structurally N/A on API routes. The one cookie-bound surface (marketing consent) refuses writes without its bootstrap-bound context (403 fail-closed, Phase-3 live) | SOUND |
| Rate limiting | route-level limits verified live: login 10/min (Phase-3 11th → 429), reset 5/15min, MFA verify 10/15min, enroll 5/15min, passkeys 10/15min. Behavior during audit (429 persistence across `tsx watch` reload, cleared by full restart) confirmed counters are in-memory per process — **production fleets need edge/WAF limiting (documented ops requirement, not a code defect)** | SOUND (env-bounded) |
| Cross-tenant isolation | second customer probing first customer's invoice: read **404**, **payment initiation also 404** (existence-hidden); Phase-3 equivalent PASS re-verified genuine (correct route path) | SOUND |
| Admin / Super Admin authorization | customer token → 403 on three distinct admin route families (catalog, billing-ledger, users); anonymous → 401; admin-role rows require super_admin actor (`admin-users.ts`) — **self-elevation is impossible via API**, and this audit deliberately did not create one | SOUND |
| Support (delegated) sessions | code review: `sup`/`act` claims are re-validated against the `admin_support_sessions` row every request; ended/expired session kills the token immediately | SOUND (code-level) |

## Not verified in-host (unchanged, honest)

- WebAuthn attestation/assertion halves (authenticator present) — B-1.
- Email delivery realism for reset/verify (no relay configured — queued truthfully) — owner infra.
- Production-scale brute-force behavior: per-instance limits + durable per-account issue limits
  verified; fleet-wide ceilings are an ops/WAF item.
- OIDC/SSO: not a feature of this codebase; nothing mislabeled as present.

**Conclusion:** authentication and authorization controls are independently reproduced end-to-end.
No weakening was required, applied, or observed; every refusal above is enforced server-side,
several additionally at the database layer (timestep single-use, revoked-token lookup, durable
per-account issue limit).
