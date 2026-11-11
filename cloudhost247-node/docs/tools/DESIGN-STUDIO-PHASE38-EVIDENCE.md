# Design Studio saved templates — Phase 38 evidence

**Startup boundary and independent fencing verification.**
Local verification only. No deployment, no staging, no provider operations, no production certification change.

**Verdict: eight criteria, four closed at the level they claim, four deliberately left open.** The most
important result in this phase is a defect this phase found in Phase 37's own design: **deleting one file
un-fenced a node.**

---

## 1. The gap Phase 38 was opened to close

Phase 37 ended with a start gate on `bin_name['postgres']` and described the recovery path as closed. Two
objections were correct and were the reason this phase exists:

> "The executable shim is not automatically a universal startup boundary."
>
> "Timeline equality is not sufficient proof of rejoin integrity."

There was a third problem, not named in advance, which measurement found. Phase 37's `FenceStore` derived
node state from the last line of `<node>.fence.jsonl`, and treated a missing or empty file as `CLEAN`. That
makes the durable record durable only until someone runs `rm`:

```
after fencing        : FENCED
after DELETING log   : CLEAN     <-- wrong
after TRUNCATING log : CLEAN     <-- wrong
after FORGING a file : CLEAN     <-- wrong
```

No coordinator restart was required. A single unlink un-fenced a node. This is the same mistake as a mutable
boolean wearing different clothes, and it is the kind of thing that only shows up when someone deliberately
tries to break it rather than when the happy path is exercised.

---

## 2. What was built

### 2.1 A sealed, hash-chained fence ledger — `tests/helpers/fencing/fence-ledger.ts`

- Every record carries `seq` and `hash = H(seq, prevHash, payload)`. Editing any record breaks every
  subsequent hash, so a forged record is detectable without trusting whoever wrote it.
- After every append a separate **seal** file records `{seq, hash}` — the high-water mark.
- The seal lives in a **different directory** from the log, so one careless `rm -rf` cannot remove both.
- **Absence is not cleanliness.** A seal with no log means deletion. A log shorter than its seal means
  truncation or rollback. A broken chain means editing. A log with no seal means the seal was deleted. All
  four produce `UNKNOWN`, and the start gate refuses `UNKNOWN`.
- Only a node with **neither log nor seal** is `CLEAN` — it has never been fenced, so there is no history to
  have been split-brained against.
- Appending onto a ledger that does not verify **throws**. Writing a new record on a tampered history would
  bless it; recovery has to be a deliberate act, not a side effect of the next write.

### 2.2 The shim now consults the seal — `renderStartGateScript`

The Phase 37 shim is unchanged in structure; its `state_of()` now cross-checks the log length and the sealed
hash. Measured against a real generated shim:

```
FENCED       -> exit 1 | start gate: refusing to start node2 in state FENCED
REJOINED     -> exit 0
log DELETED  -> exit 1 | start gate: refusing to start node2 in state UNKNOWN
```

### 2.3 Startup route enumeration as data — `tests/helpers/fencing/startup-boundary.ts`

Derived by reading Patroni 4.1.5 rather than by intuition:

| Route | Mediated by the shim? | Serves traffic | Mechanism |
| --- | --- | --- | --- |
| `patroni-start` | yes | yes | `PostmasterProcess.start(pgcommand('postgres'))` |
| `patroni-promote` | yes | yes | same call, via `promote()` |
| `patroni-recovery` | yes | yes | same call on the path that bypasses `pre_promote` |
| `pgrewind-single-user` | yes (allowed) | no | `postgres --single` — permitting it is required for rewind to work |
| `pgctl-start` | **no** | yes | `pg_ctl` from PATH or an absolute path |
| `direct-configured` | yes | yes | the shim invoked directly |
| `direct-real-binary` | **no** | yes | the real binary by absolute path |
| `supervisor` | **no** | yes | systemd/init `ExecStart` — outside Patroni entirely |

`PostmasterProcess.start(` appears **exactly once** in `postgresql/__init__.py`, which is what makes the
mediation claim about paths rather than about "the one path we happened to test". `pg_ctl` is invoked only
for `reload`, `promote` and `kill` — never `start`.

### 2.4 An independent detection control — `observeCluster()`

The shim enforces where we own the path. It cannot enforce where we do not. So the second control asks a
different question, of a different source: *is any node writable while the ledger says it may not serve?*
It does not ask the coordinator, does not depend on the shim having run, and reports on nodes the shim never
touched. It **cannot prevent** a start, and is not described as if it could.

### 2.5 Rejoin judged on four facts — `assessRejoin()`

The user's objection encoded directly. Timeline equality is one check among four, and is neither necessary
nor sufficient:

1. **Timeline history** — `pg_wal/0000000N.history` must exist for every timeline up to the primary's.
2. **Recovery state** — must be in recovery, and replay must not be paused.
3. **Replay progress** — `pg_last_wal_replay_lsn()` must reach `pg_current_wal_lsn()` within tolerance, so
   "in recovery" is not mistaken for "caught up".
4. **Divergence** — a node replayed *beyond* the primary is refused, which is worse than being behind.

### 2.6 WAL availability after rewind — `assessWalAvailability()`

Gives the exact condition Phase 37 could not state. A rewound node must replay from the fork point; those
segments must still exist on the primary, in a replication slot, or in an archive. If not, the node starts,
requests WAL, and waits forever — indistinguishable from a node that is merely slow, which is precisely what
looked like a fencing failure during Phase 37.

---

## 3. Test results

`TEST_BOUNDARY_INTEGRATION=1 npx vitest run tests/integration/design-studio-templates-startup-boundary.test.ts`
— three PostgreSQL 16 cluster nodes under a real 3-node Patroni/raft quorum, root `/tmp/ch247-p38`.

| # | Criterion | Evidence | Result |
| --- | --- | --- | --- |
| 01 | enumerate startup paths | 5 mediated, 3 not: `pgctl-start`, `direct-real-binary`, `supervisor` | pass |
| 02 | mediated path refuses a fenced node | **22 `FENCED:false` refusals**, `writable: false` | pass |
| 03 | one interception point for promotion and recovery | `PostmasterProcess.start` call sites: **1** | pass |
| 04 | deliberate bypass is detected | real binary → `writable: true`; sentinel `violation: true` | pass |
| 05 | detection does not cry wolf | legitimate primary `writable: true`, `violation: false` | pass |
| 06 | log deletion does not un-fence | `UNKNOWN` — "log is MISSING but a seal records 1 records" | pass |
| 07 | truncation and rollback are detected | `UNKNOWN` for both zero-truncate and 1-of-2 rollback | pass |
| 08 | forging and seal deletion are detected | "record 1 fails its own hash"; "log has 1 records but no seal" | pass |
| 09 | restart cannot reset; append onto broken ledger refused | append throws, state stays `UNKNOWN` | pass |
| 10 | rejoin beyond timeline equality | behind / paused / no-history / divergent all refused; good case passes | pass |
| 11 | real standby on replay LSN | primary `0/4026DA0`, replica `0/4024BE0`, `lagBytes: 8640` | pass |
| 12 | missing WAL conditions | 5 segments present; absent segment → unrecoverable + remedy named | pass |
| 13 | independent fencing and VIP stay unmet | VIP `RTNETLINK answers: Operation not permitted` | pass |
| 14 | the limitation is structural | shim and ledger on one device: `65024` / `65024` | pass |

**14/14 twice** (runs 5 and 6, 64.8 s and 66.3 s), and **14 skipped / exit 0** without the env var.

---

## 4. The recurring failure mode: tests that pass for the wrong reason

Phase 37 documented seven instances. Phase 38 produced four more, and they are the reason the suite is
trustworthy rather than merely green.

### 4.1 A test that deleted a file that did not exist

Tests 06–08 were written against `<node>.jsonl`. When the ledger was aligned to Phase 37's shim, which reads
`<node>.fence.jsonl`, those tests kept calling `rmSync` on a path that no longer existed — with `force: true`,
which silently succeeds on a missing file — and then asserted the node was still `FENCED`. It was. Nothing
had been deleted.

The fix is not a corrected filename but a corrected dependency: the ledger now exposes `logPath()` and
`sealPath()`, the tests assert `existsSync(...) === true` **before** tampering and `false` **after**, and a
hardcoded path can no longer drift away from the implementation. Caught by the log line reading
`after deleting the log: FENCED | verified 1 records` — a "detection" that had not detected anything.

### 4.2 A refusal for the wrong reason

Test 02 initially passed with 20 refusals that all read `UNKNOWN:false`. That would also stop a restart, but
for entirely the wrong reason: it meant the shim could not read the durable record at all. The assertion now
requires `state === 'FENCED'` specifically, so a refusal caused by an unreadable ledger cannot masquerade as
fencing. (Two real bugs sat behind that log line: a filename mismatch between the ledger and the shim, and a
`'\\n'` in the generated Python that wrote a literal backslash-n instead of a newline, corrupting the JSONL
after the first record.)

### 4.3 A test that tested the test

Test 11 originally picked "the first node that is not the leader" and asserted it was a healthy standby. It
failed whenever that node was the one the suite had just fenced. Picking by observation instead of by
position is the difference between testing standby verification and testing bookkeeping — and it found a
second problem: tests 02 and 04 fence `node1` and never returned it, so every later test ran against a
degraded two-node cluster.

### 4.4 An assertion stricter than the property

Test 05 asserted the healthy primary's ledger state was exactly `CLEAN`. After the restore path in 4.3, a
node that had been fenced and returned reads `REJOINED` — which also permits serving, and is the state the
design is supposed to produce. Requiring `CLEAN` was testing test ordering. The assertion is now "state
permits serving, and is not flagged", which is the property that matters.

---

## 5. Criterion-by-criterion verdict

| # | Criterion | Verdict |
| --- | --- | --- |
| 1 | Enumerate every startup path | **Met.** Eight routes, derived from Patroni 4.1.5, three explicitly unmediated. |
| 2 | Prove every path checks the durable record before becoming writable | **Not met, and the claim is withdrawn.** Every *mediated* path checks it, proven on the recovery path with 22 refusals. The three unmediated routes are startable and test 04 proves a fenced node becomes writable that way. |
| 3 | Bypasses detected and rejected by an independent control | **Detected: met. Rejected: not met.** The sentinel detects reliably and does not cry wolf. It cannot prevent the start, and it shares the host with what it watches. |
| 4 | Records cannot be silently reset, truncated or replaced | **Met within its threat model.** Deletion, truncation, rollback, single-record forgery and seal deletion all fail closed. A consistent whole-history forgery by an attacker with write access to both directories still succeeds — same host, same filesystem. |
| 5 | Rejoin on timeline history, recovery status, replay progress, authoritative comparison | **Met.** Four independent facts, all four refusals exercised, and the clean case passes against a live replica. |
| 6 | Missing WAL after rewind, exact conditions | **Met.** The condition is named and detected, with the remedy stated. |
| 7 | Independent fencing stays open until genuinely independent | **Open, as required.** Same device id (`65024`) for shim and ledger. No power, no storage-device, no second failure domain. |
| 8 | Real-interface VIP stays unmet; no TCP-listener substitute | **Unmet, as required.** `ip addr add` → `Operation not permitted`. No substitute was introduced. |

**HA verdict unchanged: NO-GO.** Two writable primaries remain an unresolved production blocker. Production
certification is unchanged by this phase.

---

## 6. Honest limits

- **The shim is not a universal boundary, and this phase no longer claims it is.** Three of the eight routes
  are outside it. A supervisor or an operator with the real binary defeats it, and test 04 does exactly that.
- **The independent control detects; it does not prevent.** It is a tripwire, not a fence. The thing that
  actually prevented harm in every fenced-node experiment remains the WAL permission fence, which is also
  same-host.
- **The ledger raises the bar, it does not make tampering impossible.** Going from "delete one file" to
  "forge a consistent hash chain and seal together" is a real improvement against accident and casual error.
  It is not a defence against an adversary with write access to both directories on the same host.
- **`assessRejoin` tolerance is a policy constant.** 16 MB by default, 256 MB in the live test. A node within
  tolerance is judged caught up; that is a judgement about acceptable divergence, not a proof of zero loss.
- **Test 02 observes the refusal, not the cause.** It proves the node does not start and that the shim named
  `FENCED`; it does not prove the coordinator then elected elsewhere for the right reason.
- **The enumeration is a snapshot of Patroni 4.1.5.** A future release adding a launch site would need the
  table re-checked. Test 03 pins the single call site, which would fail loudly if that changed.
- **No deployment was attempted.** Nothing here has run in an environment with more than one host.

---

## 7. Files

| File | Change |
| --- | --- |
| `tests/helpers/fencing/fence-ledger.ts` | New — sealed hash-chained ledger, four tamper classes fail closed |
| `tests/helpers/fencing/startup-boundary.ts` | New — route enumeration, independent sentinel, rejoin assessment, WAL availability |
| `tests/helpers/fencing/recovery-gate.ts` | Shim `state_of()` cross-checks the seal; JSONL newline bug fixed; `sealRoot` option |
| `tests/integration/design-studio-templates-startup-boundary.test.ts` | New — 14 tests covering criteria 1–8 |
| `package.json` | `test:boundary-integration` |
| `docs/tools/DESIGN-STUDIO.md` | Phase 38 section and limitations |

No changes under `src/`. The design-studio templates repository is untouched, as it has been since Phase 30.
