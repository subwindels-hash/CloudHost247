# Staging access handoff (C1.8)

**Purpose.** Everything needed to unblock the first real WHMCS discovery, written so that the handoff itself never
carries a secret.

> **Verified locally — not WHMCS-integrated in a live staging environment.** The tooling described here is tested locally; the
> environment it targets has never been contacted.

**The rule this document exists to keep:** credentials are never requested or supplied through GitHub issues, pull
requests, commits, chat messages, documentation, screenshots or email. This document lists *what* to provide, *how* it
must be delivered, and *who* is responsible for each part. It never contains a value, and it should never be edited to
contain one.

---

## 1. What must be provided

| # | Item | Shape | Why it is needed | Provided by |
| --- | --- | --- | --- | --- |
| 1 | Staging WHMCS base URL | `https://billing.staging.<domain>` — install root, no `/includes/api.php`, no query string | Every request is built from it; a pasted endpoint is reduced to the root and a non-https host is refused | Staging owner |
| 2 | API identifier | 4–191 chars, `A-Za-z0-9._-` | Authenticates the deployment to WHMCS | Staging owner |
| 3 | API secret | at least the minimum enforced length, high entropy | Same; never displayed or logged by any command in this repository | Staging owner |
| 4 | API role name | e.g. `cloudhost247-discovery` | Lets the reviewer confirm the permissions in §3 are the only ones granted | Staging owner |
| 5 | WHMCS version | e.g. `8.13.1` | Recorded so the discovery report can be checked against what the owner believes is running | Staging owner |
| 6 | System URL | *Setup → General Settings*, character-for-character | Must equal the base URL exactly or SSO hand-offs are refused by design (the `www`/apex mismatch is the common cause) | Staging owner |
| 7 | Egress IPs of the application host | one or more IPv4/IPv6 addresses | The install's API allow-list must include them; this is the only network change required | Platform operator |
| 8 | Named staging owner and named reviewer | names, not accounts | Someone is accountable for the environment and someone else approves the mapping | Project owner |

Items 2 and 3 are **values** and travel only through §2. Everything else is ordinary information and can be stated in a
ticket, a document or a call.

---

## 2. Approved credential-delivery mechanism

One of these, chosen by the staging owner — nothing else:

| Mechanism | Where the value lives | Notes |
| --- | --- | --- |
| Deployment environment variables (**preferred**) | The hosting panel's environment configuration for the Node application | The application reads `WHMCS_BASE_URL`, `WHMCS_API_IDENTIFIER`, `WHMCS_API_SECRET`, `WHMCS_MODE=read-only`; values are never printed by any command |
| Local, uncommitted `.env` file on the staging host | File permissions `0600`, owned by the application user, listed in `.gitignore` | Acceptable for a staging host; the repository ships only `.env.example` with empty values |
| Secret manager / password vault with a CLI the operator runs | The vault | The operator injects the values into the process environment; they are still never pasted into a document |

**Never:** GitHub issue, pull request, commit, wiki page, chat message, screenshot, ticket description, ordinary
documentation, build log, or an evidence pack. The evidence pack redacts credential-shaped strings as a second line of
defence, not as permission to include them.

**Rotation.** The credential is staging-only and should be rotated when this milestone closes, or immediately if it
was ever placed anywhere other than §2's mechanisms — including an accidental paste into a terminal that was
captured.

---

## 3. Required API permissions (read-only)

The API role must be able to read the catalogue and nothing else:

| Allowed | Why |
| --- | --- |
| `GetProducts` | The product list, prices, cycles, modules and visibility |
| `GetProductGroups` | Group ids and names, so every product's group resolves |
| `GetCurrencies` | The currency set and which one is the default |
| `WhmcsDetails` | Optional; the version, only when `WHMCS_DISCOVERY_VERSION=1` |

Explicitly **not** granted, and not needed at any point in C1:

- any client, contact, user or credit-card permission;
- any order, invoice, transaction or payment permission;
- any product-modification, pricing or configuration-write permission;
- any module, server, provisioning or service-lifecycle permission;
- staff, administrator or configuration-write permissions.

If the role cannot be restricted to reads, **do not proceed** — the discovery code would still only issue reads
(a test asserts the action list), but the credential would carry powers the project has not been authorised to use.

---

## 4. Network requirements

| Requirement | Detail |
| --- | --- |
| Outbound route | The application host must reach the install over TCP 443 |
| Allow-list | The install's API allow-list must include the egress IPs from §1 item 7; do not disable the allow-list to make a test pass |
| DNS | The base URL host must resolve from the application host |
| TLS | A publicly valid certificate; the client does not disable verification, and no exception will be added |
| Inbound | Nothing. The application never accepts connections from WHMCS |
| Loopback exception | `http://localhost`/`127.0.0.1` is allowed by configuration **for local development only**; it is not a route to staging |

`npm run whmcs:readiness` probes exactly this: an unauthenticated TCP connect, no request, no credential. It reports
`READY` / `MISSING` / `INVALID` / `UNREACHABLE` / `NOT CHECKED` per item so a failure is a fact to fix rather than a
guess.

---

## 5. Responsibilities

| Role | Owns | Does not do |
| --- | --- | --- |
| Staging owner | The environment, the credential, the role, the allow-list, the version and System URL, revocation | Does not run discovery, and does not paste the secret anywhere outside §2 |
| Platform operator | Setting the environment variables, egress IPs, confirming the app answers with the right mode | Does not read or echo the secret |
| Developer / operator running discovery | `whmcs:readiness` → `whmcs:doctor` → `whmcs:discover` → `whmcs:validate` → `whmcs:review` → `whmcs:evidence`, and stopping when any step fails | Does not ask for a secret in chat, does not bind products, does not enable C2 |
| Reviewer / project owner | Reads the evidence pack, approves or rejects specific service-to-product rows | Does not approve a pack that is missing validation or provenance |

---

## 6. Evidence and approval

Whoever runs discovery produces the pack with `npm run whmcs:evidence` (see the runbook §8). It records the capture
time, the installation fingerprint, the artifact's sha256, the validation verdict and every unverified capability;
the reviewer approves **named services**, not the document as a whole.

| Approval | What it authorises |
| --- | --- |
| Readiness + doctor accepted | Permission to capture the catalogue (still read-only) |
| Discovery + validation accepted | Permission to propose mappings; still nothing bound |
| Mapping proposal approved, service by service | Permission to run `whmcs:map -- bind` for those services only |
| A separate, explicit authorisation | Any order, invoice, payment, provisioning test, customer migration or production change — none of which is implied by the approvals above |

An approval is only meaningful against a specific evidence pack: if the artifact changes afterwards, the pack's
digest chain reports the review as invalidated and the approval must be re-taken.

---

## 7. Sequence once access exists

```bash
npm run whmcs:readiness     # what would stop a run, without sending a request
npm run whmcs:doctor        # read-only preflight against the install
npm run whmcs:discover      # capture the catalogue
npm run whmcs:validate      # is the captured file evidence at all?
npm run whmcs:review        # classify all 59 services against it
npm run whmcs:evidence      # assemble the pack for the owner
```

Then stop. Binding is a separate, reviewed command per service, and C2 does not begin without an approved proposal.

---

## 8. Current state of this handoff

| Item | State |
| --- | --- |
| Items §1.1–§1.8 | **OUTSTANDING** — none has been provided |
| `npm run whmcs:readiness` | **DONE** — reports `MISSING` for configuration, credentials, identity; route `NOT CHECKED` |
| Discovery, validation, review, evidence tooling | **DONE** — waiting on access, not on code |
| Product bindings | **0** — unchanged by this phase |
| C2, checkout, payments, migration, provisioning | **NOT AUTHORISED** |
