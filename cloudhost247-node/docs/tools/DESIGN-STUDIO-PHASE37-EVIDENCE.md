# Design Studio — Phase 37 evidence: recovery fencing and rejoin integrity

**Status: local investigation only. Nothing is deployed. Production certification is unchanged. The
Phase 33 split-brain blocker remains OPEN.**

Date: 2026-11-11. Environment: Patroni 4.1.5 (raft DCS, three nodes), PostgreSQL 16.2, disposable
clusters under `/tmp/ch247-p37`.

## The gap this phase addresses

Phase 36 proved `pre_promote` can veto a promotion, and measured exactly where that stops helping:

```python
# patroni/ha.py :: enforce_primary_role
if self.state_handler.is_primary():
    ...
    return message          # <-- no promote(), therefore no pre_promote
```

A fenced former primary restarted by its own coordinator returns through that branch. The gate never
runs. In Phase 36 the only thing preventing a second writer was an unwritable `pg_wal` — one `chmod`
away from being gone, and gone entirely if the disk is replaced, the directory is recreated, or the
fence is applied to the wrong path.

Recovery is where promotion controls can be bypassed. This phase gates recovery itself.

## Why the gate cannot be a callback

The obvious design — fence in `on_start` — cannot work, and the reason is in Patroni's source:

```python
# patroni/postgresql/__init__.py
def call_nowait(self, cb_type: CallbackAction) -> None:
    """pick a callback command and call it without waiting for it to finish"""
    ...
    self._callback_executor.call(cmd)
```

`on_start`, `on_stop`, `on_restart` and `on_role_change` are dispatched through `call_nowait`:
fire-and-forget, run after the fact, **exit code ignored**. A callback can report that a fenced node
started. It cannot stop it.

`pre_promote` is the only hook that can refuse anything, and it only covers promotion. Neither covers
recovery.

## What was built

### 1. Start gate — the recovery path, gated

`pgcommand('postgres')` resolves to `join(bin_dir, bin_name['postgres'])`, and `bin_name` is
configurable. So every start of a node's PostgreSQL — promotion, recovery restart by its own
coordinator, duplicate coordinator, manual `pg_ctl`, a supervisor script — can be made to pass through
a shim (`renderStartGateScript`).

The shim reads the node's fence state and:

| State | Decision |
| --- | --- |
| `CLEAN` | start |
| `REJOINED` | start |
| `REJOIN_PENDING` | **refuse** — awaiting rewind is not safe to serve |
| `FENCED` | **refuse** |
| `UNKNOWN` or unreadable | **refuse** — never default to "fine" |

Every decision is appended to a log with the node, state, verdict and pid, so a refusal is evidence
rather than an absence.

### 2. Fence record — append-only, survives restarts

`FenceStore` keeps `<node>.fence.jsonl` with `from`, `to`, timestamp, reason, actor and timeline. The
current state is derived from the last record; the history is never rewritten.

This exists because the alternative — a mutable `is_fenced` flag — has precisely the failure mode this
phase is meant to close. A restarted process writes `false`, and the record of why it was `true` is
gone. An append-only log cannot be cleared by starting a process; only an explicit, recorded recovery
decision moves a node forward.

### 3. Rejoin integrity

`judgeRejoin` requires all of:

- `pg_rewind` **or** a clean rebuild — and refuses when *both* are asserted, because that means one did
  not do what the operator believes;
- the candidate is in recovery (`pg_is_in_recovery()`), so it cannot serve writes;
- the candidate's **timeline matches the primary's**, read from the WAL file name rather than a role
  label.

Role labels are explicitly not evidence. A node can be labelled `replica` while replaying a timeline the
primary abandoned.

### 4. Fence acknowledgement

`interpretAck` treats these as **unsafe**: no acknowledgement, a timeout, a refusal. Only an explicit
`confirmed` passes — and the ack layer deliberately does not decide alone, because a fence command that
exits 0 while the node stays writable is the classic false positive (re-established here on the recovery
path, as Phase 35 established it on the promotion path).

## Test results

`TEST_RECOVERY_INTEGRATION=1 npm run test:recovery-integration` — see the run log quoted below.

| # | Criterion | What it shows |
| --- | --- | --- |
| 01 | 1 — recovery fencing | A fenced node killed and then restarted repeatedly by its own coordinator is refused **every time**, with each refusal recorded. Observed 22 consecutive `FENCED:false` decisions in one window. |
| 02 | 3 — timeline validation | A candidate on `timeline - 1` is refused with `timeline mismatch: candidate 0 is not on the primary's timeline 1`. |
| 03 | 2 — rejoin integrity | Each requirement is rejected on its own: no rewind, not in recovery, no readable primary, and rewind+rebuild together. The well-formed case passes, so the gate is a check rather than a blanket refusal. |
| 04 | 2, 3 — real rewind | A real `pg_rewind` against the live primary, then rejoin judged on the result. The rewound node came back `timeline: 1` (matching the primary) and `inRecovery: true`. The gate refused it while `REJOIN_PENDING` and permitted it only after the recorded `REJOINED` transition. |
| 05 | 4 — acknowledgement | Absent, timed-out and refused acknowledgements are all unsafe; only `confirmed` passes. |
| 06 | 4 — false positive | A no-op fence exiting 0 while the node stays writable. The ack alone must not be trusted. |
| 07 | 6 — restart supervision | Three simultaneous restart routes — a duplicate coordinator, `pg_ctl` directly, and the gate binary run as a supervisor would — all refused; the node stays unwritable and the record stays `FENCED`. |
| 08 | 5 — promotion recovery | The replacement is promoted and immediately failed. Result is an **outage**: zero writable nodes, and the old primary still `FENCED`. |
| 09 | 7 — negative test | The gate is deliberately bypassed, and the unsafe state is **observed**: the node reached `database system is ready to accept connections` and answered `writable: true` while its fence record still read `FENCED`. With the gate in place the same node is refused; with it removed the node serves. That contrast is what gives tests 01 and 07 their meaning. |
| 10 | 7 — negative test | A rewound node on the wrong timeline is rejected by the rejoin check. |
| 11 | auditability | Fence history is append-only and chains: observed `CLEAN -> FENCED -> REJOIN_PENDING -> REJOINED -> FENCED`, and every record's `from` is the previous record's `to`. |

## The recurring failure mode: tests that pass for the wrong reason

Fourteen attempts were needed, and the failures are worth recording because each one looked like a
fencing result and was not. Every entry below was found by reproducing the problem outside the suite
rather than by loosening an assertion:

1. **A no-op fence counted as confirmation.** The gate skipped fencing when the probe found the node
   *unreachable*, then accepted the default `fenceSucceeded = true`. Two writable primaries appeared
   (Phase 36, test 08). Fencing now happens on **writable or unreachable**.
2. **A test that measured quorum loss, not fencing.** Killing two of three coordinators leaves no
   primary — correctly, but for a reason unrelated to the gate, which never ran. Fixed by restoring
   quorum and requiring gate invocations in the same window.
3. **`chmod 400 pg_wal/*` also matched a directory**, removing its execute bit. The fence worked; the
   consequences were that `pg_rewind` could not inspect the target and cleanup failed with `EACCES`.
   Now files-only, with directories left traversable.
4. **`pg_rewind` on a running node.** It requires a stopped target and runs `postgres --single`; against
   a live node the error is "single-user mode failed", which reads like a rewind defect.
5. **Data directory mode 0755.** PostgreSQL refuses to start with
   `data directory ... has invalid permissions; Permissions should be u=rwx (0700)`.
   `pg_basebackup` leaves 0755. This was arguably the most misleading failure of the phase: it looked
   like a fencing refusal.
6. **`standby.signal` in the target.** `postgres --single` refuses
   `standby mode is not supported by single-user servers`. It must be set aside for the rewind; `-R`
   writes the recovery configuration back.
7. **Timeline reads that fail on a standby.** `pg_current_wal_lsn()` errors with
   `recovery is in progress`, so every candidate read as unreachable — indistinguishable from a node
   being down. The fix is not merely to switch functions: **`pg_walfile_name()` also fails on a
   standby**, even when given `pg_last_wal_replay_lsn()`. Measured on PostgreSQL 16.2:

   | Expression | Standby |
   | --- | --- |
   | `pg_current_wal_lsn()` | `ERROR: recovery is in progress` |
   | `pg_walfile_name(pg_last_wal_replay_lsn())` | `ERROR: recovery is in progress` |
   | `pg_control_checkpoint().timeline_id` | works |

   The timeline is therefore read from the WAL file name on a primary and from the control file on a
   standby, and every reading records which route produced it (`source: 'wal-file' \| 'control-file'`).
   The control-file route is the weaker one — its checkpoint timeline can lag a promotion until the
   first checkpoint — so a test that cannot say how it learned the timeline cannot be trusted about it.

The general lesson: on this path, "the node is not available" has at least seven innocent causes.
A fencing test that treats unavailability as evidence will produce confident, wrong results.

## A test that could not have failed

One version of test 09 asserted only that the fence record still said `FENCED` after a bypass, and logged
whether the node was writable without checking it. It would have passed whatever happened. The assertion
now requires the unsafe state to be **present**: `expect(unsafe).toBe(true)`, where `unsafe` is the
postmaster actually running on a node the coordinator was told never to start.

The same principle applied to the refusals. "The node is not writable" is not evidence of a gate — a dead
node is not writable either. Every refusal test therefore also asserts that the *gate ran* and recorded a
refusal, in the same window. Phase 36's false pass (killing two coordinators, losing raft quorum, and
calling the resulting outage a fencing success) was the same mistake in a different costume.

## Honest limits

- **The fence is local.** Withdrawing write permission on `pg_wal` demonstrates that a particular
  PostgreSQL process on a particular directory cannot commit. It does **not** establish that an
  independent failure domain can fence a real host, a storage device, or a VM. Power fencing (IPMI/PDU),
  LUN masking and read-only mounts remain untested — as Phase 34 established, none is reachable here.
- **The start gate is a shim on the binary.** It covers every path that resolves `postgres` through
  Patroni's `bin_dir`. It does not cover an operator invoking the real binary by absolute path, which is
  exactly what the negative tests do to prove detection works.
- **Requirement 7 of Phase 36 is still unmet.** No VIP can be assigned (`ip addr add` →
  `Operation not permitted`), so routing is verified through a listener at best.
- **Rejoin still depends on WAL availability.** A node rewound past the point where the primary retains
  the needed WAL cannot catch up; without a replication slot or a WAL archive it stalls in recovery. That
  is a real operational prerequisite, not a gate failure, and this phase does not solve it.
- **No staging or production verification.** Everything is a disposable local cluster.

## Verdict

Recovery is now gated: a fenced node does not serve, and the state survives restarts, duplicate
coordinators and supervisor scripts. Rejoin requires a rewind or rebuild, recovery mode, and a matching
timeline.

**The blocker is not closed.** `pre_promote` still only covers promotion, the start gate is still local
machinery on one host, and no storage- or power-level fence has been demonstrated. What changed is that
the recovery path — the one Phase 36 measured as ungated — is now gated and its refusals are recorded.
