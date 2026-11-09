# CloudHost247 Backup & Disaster-Recovery Runbook (updated Phase 22, 2026-11-09)

## Backup creation

1. `pg_dump -h <host> -U <user> -d <db> -Fc > backup.dump`
2. Encrypt in-process via the credential key ring (env `CREDENTIAL_ENCRYPTION_KEYS`) — envelope =
   `iv(12) | tag(16) | ciphertext`, AES-256-GCM, version pinned inside (proved compatible after rotation).
3. Capture `sha256` of both dump and encrypted artifact into `backup-manifest.json`.
4. Upload to object storage (operator or future in-app uploader; S3 env keys declared for it).
5. Verify manifest checksums before marking success.

## Key rotation compatibility

Retained backups stay decryptable as long as their recording key version remains in the ring (Phase-22
evidence: v1-created artifact still decrypts after v2 added). Rotation procedure: add new version →
re-encrypt writable ciphertexts with newest → keep old versions until every artifact is re-issued → then drop.

## Restore

1. Verify artifact checksum against manifest. (Phase 22: ✔)
2. Decrypt under the ring (includes the recording version). (Phase 22: ✔)
3. `createdb <fresh-target>`; `pg_restore --exit-on-error -d <fresh-target>`. (Phase 22: ✔ ~1.4 s)
4. Assertions before declaring usable: table count equal, `schema_migrations` name+checksum digest
   equal, financial invariants present. (Phase 22: all ✔)

## Escalation

Owner: `subwindels-hash`. Provider account access, retention windows, write/read separation, and
SSE-KMS assurance remain BLOCKED pending credentials (see PHASE-22 certification report).
