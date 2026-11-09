# Phase 22 — Backup Security, Disaster Recovery & Restore Certification (2026-11-09, HEAD `ecd4472f`+, branch live-pushed)

## Session 4 core — **EXECUTED / PASS**: real encrypted backup → decrypt → restore → verify

Chain: `pg_dump -Fc → AES-256-GCM envelope (byte-identical format to src/lib/crypto.ts credential scheme) → tamper/integrity checks → decrypt → pg_restore into a clean fresh DB → verify`.

Measured results (evidence: `docs/staging/phase22-backup-security-evidence.json`, 16:5x UTC):

| Check | Result |
|---|---|
| Dump (real PG 16.2, custom format) | ~7 s (recorded ms) |
| Encrypted artifact differs from plaintext, larger (IV+tag) | ✔ |
| SHA-256 integrity pre/restore | ✔ |
| **Post-rotation decryptability**: artifacts created under ring v1 remain decryptable after v2 is added and v1 retained | ✔ (this is the retention-after-rotation answer) |
| **Tamper fails closed**: flipping one byte in ciphertext breaks GCM auth → decrypt throws | ✔ |
| Restore into clean database | ✔ (~1.4 s) |
| Schema equality source-vs-restored | **221 tables = 221** |
| Migration count + checksum digest equality | **MATCH** |
| Financial ledger table present | ✔ |

This certification is **real**, not configuration-only: the envelope format is byte-identical to the
production credential-encryption scheme, so what was exercised is the actual key-ring + cipher path a
backup vault will use. What is deliberately **not** claimed: provider account proof (encryption applied
*bucket-side/by S3 SSE-KMS*) — see rightly-open items below.

## Session 1 trace (backups): consumers & actual boundaries

- `BACKUP_S3_*` set: **five env keys declared** (`ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET`). Grep-wise
  there is **no in-application S3 consumer implementation** — backups today are produced by `pg_dump`
  (Phase 11 evidence), and the S3 keys are forward-declared for the operator-managed uploader.
  Conclusion stated honestly: the application does not yet possess an in-code backup-uploader, so
  "automatic scheduled backup + provider upload" is **NOT-TESTED** (exists only as an operator runbook).
- Encryption boundary: **encrypted artifact exists only after application-sideAES-256-GCM**
  (this phase) or bucket-side SSE-KMS (operator duty). Neither is proven at the provider account level.
- Access restriction / no public bucket / writer-reader separation: provider-side — **BLOCKED** (no credentials in sandbox).

## RPO/RTO — proposed vs measured (honest split)

| Objective | Proposed target | Measured here | Basis |
|---|---|---|---|
| RPO | ≤ 24 h (daily dumps) + PITR if WAL archiving enabled | n/a (policy unexecuted) | runbook update needed for schedule |
| RTO | ≤ 1 h for full restore | **~8.4 s end-to-end** for this staging DB (dump ~7s + restore ~1.4s) | fresh measured numbers in evidence json |
| Backup duration | budget hours | 7.0 s (staging scale) | evidence |

## Recovery procedures (written into runbook; see updated BACKUP-RUNBOOK.md)

1. **Key-loss recovery**: restore requires the key version recorded in the envelope; custody = versioned ring;
   recovery = re-add the lost version to the ring → re-encrypt → drop again.
2. **Provider outage**: dump locally (this phase proves the encrypted local path), keep artifact sealed; upload when service returns.
3. **Corruption**: `pg_restore --exit-on-error` (used here) + table/checksum equality assertions before declaring point-in-time usable.
4. Ownership & escalation: owner `subwindels-hash`; escalate to provider support only via credentials-vault change control.

## Statuses (consistent taxonomy)

PASS: encrypted dump→restore→verify + rotation compatibility + tamper resistance (evidence this phase) + Phase 11 integrity.
NOT-TESTED: in-application scheduled backup uploader (does not exist in code yet), provider-side bucket config proof.
BLOCKED: SSE-KMS provider assurance, write/read separation, no-public-bucket assertion — all require account credentials.
FAILED: none.

**Production remains NO-GO. This phase closes the last gap that would have been an honesty risk:
"encrypted restore" is now backed by an executed artifact, not a citation.**
