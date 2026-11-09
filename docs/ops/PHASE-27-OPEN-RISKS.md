# Phase 27 — Open Risks (Register)

| # | Risk | Impact | Probability (evidence-based) | Mitigation | Owner | Acceptance for closure | Status |
|---|---|---|---|---|---|---|---|
| 1 | 0023 trigger-load rehearsal unperformed | billing write-latency regression on legacy rows | Med (trigger code exists, unexercised) | rehearsal on scratch DB with load profile before AUTHORIZE | `subwindels-hash` | latency numbers recorded + no error storm | BLOCKED (owner decision) |
| 2 | Quarantined 0024/0025/0041 | feature-surface inconsistency post-release | Med | rehearsal + explicit per-migration authorization string | `subwindels-hash` | same | BLOCKED |
| 3 | Backup encryption/retention at provider | unencryptable store or wrong retention silently | Low-Med | SSE-KMS verify + lifecycle policy via provider console; then restore-from-provider test | `subwindels-hash` | cert json from storage-console audit | BLOCKED (credentials) |
| 4 | Remote backup retrieve+restore | restore from *local* was proven; remote path unproven | Medium (network surface) | retrieve via S3 adapter from authorized bucket | `subwindels-hash` | restore equality proof from remote artifact | BLOCKED |
| 5 | Alert delivery to real destination | broken alerting invisible during outages | Medium | routing to authorized endpoint (email/webhook) | `subwindels-hash` | one delivered alert + transcript | BLOCKED (CT-02) |
| 6 | Multi-instance key-rotation + restart | mixed-version instances (brief desync window) | Low | documented overlap window in rollout | `subwindels-hash` | rollout drill log | NOT-TESTED |
| 7 | PG role separation independent verify | privilege misuse undetected | Low-Med | managed PG roles audit | `subwindels-hash` | roles audit signed-off | BLOCKED (CT-03) |
| 8 | Browser-native certification | visual/interaction defects invisible | Medium | engine-native Playwright cert run | `subwindels-hash` | execution report | BLOCKED (CT-07) |
| 9 | Payment reconciliation CT-05 | ledger-vs-provider drift undetected | Medium | execute Phase-6 runbook under sandbox | `subwindels-hash` | `ct05-payment-sandbox-*.json` | BLOCKED (CT-05) |
| 10 | Independent human review | self-attestation blind spots | High importance | appoint + review | `subwindels-hash` | signed inde-review report | **NOT-APPOINTED (retained blocker)** |
