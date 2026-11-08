# Customer identity: implementation report

Branch `arena/5f3b1db4-cloudhost247` — commits `a0c625a` (backend) and `a84f258` (frontend + docs).

Everything below was verified by running the code, not by reading it. The numbers in the
"Verification" section are the actual output of the commands shown.

## What was built

### 1. Unique username

* `users.username` with a case-insensitive unique index (`lower(username)`), a format check
  constraint, and a `reserved_usernames` table operators can extend without a deploy.
* One module owns every rule — `src/services/username-service.ts` (format, reserved words and
  deceptive substrings such as `official-support` and `a.d.m.i.n`, uniqueness, suggestions,
  derivation). Registration, account settings and the admin create-user path all call it.
* Changeable from account settings (`PATCH /api/v1/account/username`, audited, old handle stops
  working for sign-in immediately).
* Sign-in accepts username **or** email in one field, with an identical 401 either way.

### 2. Permanent nine-digit Customer ID

* `users.customer_id` widened from `varchar(6)` to `varchar(9)` **in place**. Existing six-digit
  values are preserved verbatim — nothing is re-issued, so a customer who was told `000042` still
  has that number.
* New accounts are issued nine CSPRNG digits (100000000–999999999), unique by index with
  insert-and-retry.
* Immutability is enforced by a `BEFORE UPDATE` trigger, not just by stripping the field from
  request schemas: any attempt to change it aborts with `23514`.

### 3. Rotating four-digit Security PIN

* Four digits with leading zeros preserved; stored as a keyed HMAC-SHA-256 (per-value salt) **and**
  an AES-256-GCM envelope, domain-separated from each other, so:
  * the plaintext is never in the database, a log, a JWT or an audit row, yet
  * the owner can be shown the current value — which a bare hash could not support.
* 24-hour rotation, enforced proactively by the worker sweep and reactively on
  `GET /account/security`.
* Viewing is a three-step gate: request a code → verify it → reveal once.

### 4. Verification gate

| Property | Behaviour |
| --- | --- |
| Recipient | the account's registered address only; the request body has no address field |
| Precondition | verified email (403 before a code is generated) |
| One live challenge | a new challenge supersedes the old; a resend preserves the token but replaces the code |
| Session-bound | keyed to `session_jti`; a token from another session gets 404 |
| Attempts | 5 wrong codes finish the challenge; counted in a committed transaction |
| Single use | `reveal` consumes the challenge; replay is 404 |
| Support mode | blocked outright (`security_pin.view` is a restricted action) |
| Code storage | sealed (`pinv1:<iv>:<tag>:<ct>`) in `pin_verification_email_queue`; stale rows are cancelled, not delivered late |

### 5. Account recovery

A claim, not a bypass: `POST /account/recovery` records it (idempotent, one open request per
account, enforced by a partial unique index), support verifies identity out of band, and approval
**revokes** verification (clears `email_verified_at`, consumes open challenges) instead of revealing
or resetting anything. Approval without a recorded `IDENTITY_VERIFIED` step is a 409.

### 6. Frontend

* `RegisterPage`: optional username with live availability, suggestions, and a working
  "leave it blank" path (no `username` key is sent at all in that case).
* `AccountPage`: username in the identity block with an inline change form; a Security PIN card
  implementing view → verify → reveal, with the value in component state only and wiped when the
  server's `displayTtlSeconds` elapses.
* `AdminCustomerIdentityPanel`: username, PIN lifecycle metadata, and a rotate action whose
  response cannot contain the new value.

## Verification

```
npx tsc -p tsconfig.json --noEmit        → clean (exit 0)
npx vitest run                          → 2389 passed, 6 skipped, 4 failed (185 files)
```

The 4 failures are **pre-existing on this branch and unrelated** — brand-palette drift
(`design-system.test.ts`, `hostinger-chrome.test.tsx`, `hosting-catalog-page.test.tsx`,
`hosting-vps-page.test.tsx`). They fail identically with all of this work stashed: the canonical
`shared/site/design-system.css` moved to gold (`--ch247-primary: #5f450a`) while
`frontend/src/styles.css` still bridges the old green. Fixing that is a separate decision about
which palette is current, so it was left alone rather than guessed at.

New coverage dedicated to this work: `tests/integration/customer-security.test.ts` — 42 tests
against a real embedded PostgreSQL with the real migrations applied, so the unique indexes, the
immutability trigger, the row locks and the partial indexes are genuinely exercised:

```
npx vitest run tests/integration/customer-security.test.ts → 42 passed
```

Plus new UI tests: the PIN gate end to end, the mask-before-verification property, honesty about a
wrong code, the unverified-email state, and the registration username field (6 tests).

### Defects found and fixed

Each of these was a real bug that the suite surfaced; all are covered by regression tests.

1. **The PIN attempt counter never incremented.** `verifyChallengeCode` updated `attempts` and then
   threw from inside `withTransaction`, so the rollback erased the update. Five wrong guesses left
   `attempts = 0` — an unlimited-guess oracle behind a six-digit code. The service now returns an
   outcome from the transaction and throws after it commits.
2. **The PIN mail drain could never run.** Its claim query selected `q.consumed_at` /
   `q.verified_at` from `pin_verification_email_queue`, where those columns do not exist. Liveness
   now comes from the challenge.
3. **Every support-mode switch failed for a new customer.** `admin_support_sessions.customer_id`
   was still `varchar(6)`; the first nine-digit customer produced `22001`. Widened in 0085.
4. **A missing PIN key refused all registrations.** One unset environment variable took signup down
   platform-wide. Registration and admin creation now succeed and defer the PIN; the security card
   issues it lazily and "view PIN" answers 503 until a key exists.
5. **Per-route rate limits shared one counter.** `@fastify/rate-limit` keys by client IP only, so a
   5-per-10-minutes route consumed the global allowance for every other route — nine requests to
   "view PIN" also throttled login. The key is now `${ip}|${route}`.
6. **An invalid username was a 500, not a 400.** `validateUsernameFormat` accepted `dots..` and
   `trailing-`; the database check constraint rejected them. The two now share one pattern.
7. **A long email address aborted account creation.** The username backfill trigger derived an
   over-long value and overflowed `varchar(32)` inside the `INSERT`, failing the whole row. Both
   parts of the derived name are now hard-bounded (24 + 8 = 32).
8. **`char(12)` recovery references leaked padding** into API responses and email copy. Changed to
   `varchar(12)`.

### Degradation

| Missing | Behaviour |
| --- | --- |
| `SECURITY_PIN_HMAC_KEY` | signup works, PIN issued lazily, view PIN → 503 `SECURITY_PIN_UNAVAILABLE`; falls back to `CREDENTIAL_ENCRYPTION_KEY(S)` |
| `NOTIFICATION_EMAIL_WEBHOOK_URL` / `_TOKEN` | codes queue as `CONFIGURATION_REQUIRED`; the UI says email delivery is unconfigured and points at support |
| username on an inserted row | `BEFORE INSERT` trigger derives a unique one; the column is deliberately not `NOT NULL` |

Both variables are documented in `.env.example` and accepted by `src/config/env.ts`.

## Deliberate decisions

* **Resend cooldown is 3 seconds**, not the 30 the code originally shipped with. It exists to stop
  a double-click and scripted flooding, not to defend against guessing — that is capped separately
  by `verification_max_attempts` and `verification_max_resends` per challenge plus a per-route
  limit. Thirty seconds turned a mail filter into a half-minute dead end. Configurable without a
  deploy.
* **`users.username` is not `NOT NULL`.** A hard constraint turns one sloppy `INSERT` (an import, a
  fixture) into a 500 at a random call site. The trigger repairs the row instead.
* **No in-memory PIN escrow.** The AES-GCM envelope is the only recoverable copy, so a restart can
  never lose a PIN and a database dump alone reveals nothing.

## Not done / open

* The four pre-existing palette failures above, which need a decision on the current brand colour.
* Email **change** from account settings was already out of scope before this work and still is; a
  customer who cannot reach their mailbox uses account recovery.
