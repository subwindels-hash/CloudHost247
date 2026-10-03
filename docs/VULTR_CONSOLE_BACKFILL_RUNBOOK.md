# Vultr console capability backfill — staging runbook (inventory row A23(ii))

**Status: DATA BACKFILL — STAGING FIRST, OWNER-AUTHORIZED. The SQL below is proven against the
migrated schema, but it writes data and must not run against production before staging.**

**Why this exists.** Row A23 re-opened the Vultr console (the instance object's `kvm` field) and
flipped the provider profile to `console: true`. But `servers.capabilities` is **copied** onto each
server row from the product configuration's `configuration_metadata.capabilities` at order
acceptance (`server-order-service.ts`), so:

- a Vultr server — or a stored Vultr product configuration — cut while A13 said `console: false`
  keeps `console: false`, and the customer still sees no "Launch console" button for a console
  Vultr really serves;
- a configuration whose metadata carries no `capabilities` object at all has the same symptom.

Both converge on the current profile truth: **every Vultr server and stored Vultr configuration
should declare `console: true`**. (DigitalOcean must NOT be backfilled — its `console: false`
refusal was re-verified correct on 2026-10-03; the control case below pins that.)

**Proven, not assumed.** The statements below were executed on 2026-10-03 against a PGlite database
with all 70 migrations applied, on a fixture covering every state: `console: false`, absent
capabilities, `console: true`, and a DigitalOcean control. Results: diagnostics named exactly the
affected rows; the backfill changed exactly those; the control kept `console: false`; sibling
capability keys (e.g. `snapshot`) were preserved; a second run changed nothing (idempotent).

**Bug the proof caught:** `jsonb_set(metadata, '{capabilities,console}', …)` does NOT create the
intermediate `capabilities` object when it is absent — configurations with no capabilities key
would be silently skipped. The configuration statement below uses a merge that handles all three
states. Do not "simplify" it back to a nested-path `jsonb_set`.

---

## Step 1 — Diagnostics (read-only; run on staging and production, report both)

```sql
-- Vultr servers whose capabilities do not already declare console: true
SELECT s.id, s.name, s.capabilities
FROM servers s
JOIN infrastructure_providers p ON p.id = s.provider_id
WHERE p.adapter = 'vultr'
  AND COALESCE((s.capabilities->>'console')::boolean, false) IS NOT TRUE;

-- Stored Vultr product configurations in the same state (these feed FUTURE orders)
SELECT c.id, c.status, c.metadata->'capabilities' AS capabilities
FROM server_product_configurations c
JOIN infrastructure_providers p ON p.id = c.provider_id
WHERE p.adapter = 'vultr'
  AND COALESCE((c.metadata->'capabilities'->>'console')::boolean, false) IS NOT TRUE;
```

## Step 2 — Backfill (staging first, in one transaction)

```sql
BEGIN;

-- Existing Vultr servers: flip console to true, preserve every sibling capability key
UPDATE servers s
SET capabilities = jsonb_set(s.capabilities, '{console}', 'true'::jsonb),
    updated_at = now()
FROM infrastructure_providers p
WHERE p.id = s.provider_id
  AND p.adapter = 'vultr'
  AND COALESCE((s.capabilities->>'console')::boolean, false) IS NOT TRUE;

-- Stored Vultr configurations: the merge form handles absent/empty capabilities objects too
UPDATE server_product_configurations c
SET metadata = jsonb_set(
      c.metadata,
      '{capabilities}',
      COALESCE(c.metadata->'capabilities', '{}'::jsonb) || '{"console": true}'::jsonb
    ),
    updated_at = now()
FROM infrastructure_providers p
WHERE p.id = c.provider_id
  AND p.adapter = 'vultr'
  AND COALESCE((c.metadata->'capabilities'->>'console')::boolean, false) IS NOT TRUE;

COMMIT;
```

Notes:

- No date-window filter: the WHERE clause converges **every** Vultr row on the current profile
  truth. Rows that already say `console: true` (ordered before the A13 window) are untouched.
- Idempotent: a second run matches zero rows.
- Provider rows are identified by `infrastructure_providers.adapter = 'vultr'` (values pinned by
  migration 0047's CHECK constraint).

## Step 3 — Verification (must be zero / unchanged)

```sql
-- Both diagnostics from step 1: zero rows.
-- DigitalOcean control — must be unchanged (its refusal is a verified provider fact):
SELECT s.name, s.capabilities->>'console' AS console
FROM servers s JOIN infrastructure_providers p ON p.id = s.provider_id
WHERE p.adapter = 'digitalocean';
```

Then click-test on staging: a Vultr server detail page shows **Launch console**, and opening it
returns a fresh `kvm` URL (two openings, two different URLs — the adapter never caches).

## After execution

Record the executed run, the row counts from step 1, and the staging evidence as a dated note on
row A23 in `docs/UNFINISHED-MODULES.md` — the same way every other closure in that inventory is
recorded. Production data stays read-only in this repository either way.
