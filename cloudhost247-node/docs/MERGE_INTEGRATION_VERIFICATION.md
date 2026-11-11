# Phase 29 — Merge Conflict Resolution and Integration Verification

**Subject:** combining `arena/b55a0c26-cloudhost247` (AI Website Intelligence) with `main` (Visitor Intelligence)
**Branch under test:** `arena/b55a0c26-cloudhost247`
**Base integrated:** `main` at `033ab8b` — "Add consent-gated Visitor Intelligence" (PR #115)
**Date:** 10 November 2026
**Verdict:** **The merge is technically sound and GitHub reports the PR `MERGEABLE`. It is not merged and not authorised.**

Stage records, kept separate because the differences matter:

| Stage | Status |
| --- | --- |
| Conflict resolution | **Done** — 60 files, 11 genuinely contested, all justified |
| Migration compatibility | **Done** — zero duplicate prefixes; `0100` is the tail |
| Local suites on the merged tree | **Done** — 4,360 passed, 0 failed |
| CI on the merged tree | **Done** — five checks green, PHP linted for real |
| Staging verification | **Not done** |
| Production certification | **Not done** |
| Merge to `main` | **Not done, not authorised** |

This report is deliberately separate from `AI_WEBSITE_INTELLIGENCE_AUDIT.md`. That document audits the AI subsystem on its own branch. This one audits **the combination**, which is a different question with a different answer, and the distinction was the point of the instruction that commissioned both.

---

## 0. Why a second report at all

Phase 28 established that the branch is sound: 2,298 unit, 973 integration and 1,000 frontend tests pass on a clean clone of it. None of those numbers says anything about what happens when that branch is combined with 15 days of other people's work.

The clearest demonstration is in §4: the merged tree passed its own suite while the AI knowledge projection was silently **one document stale** — the assistant would have refused to answer about a page that exists on the merged site. No test on either branch could have caught that, because each branch was internally consistent. Only the combination was wrong.

**A successful branch verification is not a successful integration verification.**

---

## 1. What the two lines actually are

The histories have **no common ancestor**. `main` is a squashed snapshot (`033ab8b`, one commit); this branch is 29 commits from `10df113`. Git therefore treats every file as newly added on both sides, which is why the raw conflict count (60) massively overstates the real disagreement (11).

| | Files |
| --- | --- |
| Present in both trees | 9,229 |
| Only on `main` | 119 |
| Only on this branch | 26 |
| **Changed by this branch** vs the content base | **20** |
| **Changed by `main`** vs the content base | **55** |
| **Changed by both** | **13** |

The branch changed 20 files; `main` changed 55. The overlap is small, which is what makes this merge tractable.

---

## 2. Method — classify against the content base, not the empty tree

Merging two unrelated histories naively produces dozens of `add/add` conflicts, and resolving them by "ours" or "theirs" throws away real work in either direction. The only safe rule is to ask, per file, **which side actually changed it relative to `10df113`**, and then take that side.

Every one of the 60 conflicts was classified:

| Class | Meaning | Resolution | Count |
| --- | --- | --- | --- |
| `MAIN-ONLY-CHANGE` | branch matches `10df113`, `main` moved | take `main` | 42 |
| `BRANCH-ONLY-CHANGE` | `main` matches `10df113`, branch moved | take branch | 7 |
| `REAL-CONFLICT` | both sides moved | by hand | 11 |

**49 of the 60 conflicts were artefacts of the unrelated histories and required no judgement at all.** That is worth stating plainly, because a 60-file conflict list looks alarming and is not.

---

## 3. The 11 real conflicts

| File | Nature | Resolution |
| --- | --- | --- |
| `frontend/src/App.tsx` | both added routes and lazy imports | **union** — `/admin/ai-support/knowledge` and `/admin/visitor-intelligence` both present |
| `src/app.ts` | both registered route modules | **union** |
| `src/worker/main.ts` | both added a scheduled cycle | **union** — retention cycle and knowledge sweep both run |
| `frontend/src/lib/email-forensics-api.ts` | `main` added a type index signature; branch removed an argument mutation | **both kept** — unrelated fixes to adjacent code |
| `frontend/src/pages/email-forensics.css` | `main` moved to literal palette values equal to the branch's tokens | **take `main`** — the palette gate compares declared values |
| `src/routes/email-forensics-customer.ts` | **both sides independently fixed the same Fastify hang** | **take `main`** — equivalent fix, better comment |
| `tests/integration/ga4-reconciliation-migration.test.ts` | `main` hard-coded the migration tail | **take branch** — see below |
| `tests/integration/migrate.test.ts` | conflicting expectations about the migration list | rewrite for the merged tree |
| `src/navigation/registry.generated.ts` | generated | take `main`, then regenerate |
| `frontend/src/navigation/registry.generated.ts` | generated | take `main`, then regenerate |
| `shared/site/generated/route-report.json` | generated | take `main`, then regenerate |

### 3.1 The one conflict where taking `main` would have planted a time bomb

`main`'s version of `ga4-reconciliation-migration.test.ts` asserts an **exact list** of migrations applied after `0092`:

```
'0093…','0094…','0095…','0096_create_email_forensics.sql',
'0097_refund_idempotency_key.sql','0098…','0099_create_visitor_intelligence.sql'
```

That list is correct on `main` and **wrong the moment this branch's migration is renumbered into it** (§3.2) — the test would fail on the merged tree for a reason that has nothing to do with GA4. The branch's version asserts the same property structurally (the first three entries, plus "everything applied is ≥ `0093`"), which survives any future renumbering. Kept the branch's.

This is the same fragility the Phase 28 audit flagged and fixed once already. It has now been reintroduced by `main` and fixed again — worth noting as a recurring pattern rather than a one-off.

### 3.2 Migration renumbering — the only hard collision

`main` had independently taken **`0097`** for `0097_refund_idempotency_key.sql`. This branch held `0097_ai_website_knowledge.sql`. Both cannot survive.

Per the standing instruction — *check the destination migration history and use a unique sequential number* — the destination now reads:

```
0095_add_ga4_purchase_delivery.sql
0096_create_email_forensics.sql
0097_refund_idempotency_key.sql
0098_refund_idempotency_global_uniqueness.sql
0099_create_visitor_intelligence.sql
0100_ai_website_knowledge.sql   <- renumbered from 0097
```

`0100` is the first prefix free on both histories. Verified: **zero duplicate prefixes** in the merged tree.

The branch-only `0092b_create_email_forensics.sql` is **deleted**. In the merged tree `0096` is authoritative; keeping both would apply the same schema twice under two version prefixes. This was identified in the Phase 28 report and is now actually carried out.

---

## 4. The defect only the integration could reveal

After a clean merge, with both test suites passing, the AI knowledge projection was **stale**:

```
✖ AI website knowledge projection is stale. Run: node scripts/site/generate-ai-knowledge.mjs
```

Regenerating produced **410 documents, up from 409**. `main`'s legal work added a document — `legalDocuments 17 → 18` — that the assistant's projection did not contain.

**Why this is the interesting failure.** Neither branch was wrong. The branch's projection was correct for the branch's site; `main`'s site was correct for `main`. The combination had one more page than either, and nothing on either side was asserting the projection against the *other* site. The assistant would have refused to answer about a page that is live on the merged website — and it would have looked like a relevance bug rather than a staleness bug.

It was caught only because Phase 28 added `generate-ai-knowledge.mjs --check` to `scripts/release-candidate-check.sh`. That gate was written for the branch; it earned its keep on the merge.

**This is the concrete argument for integration verification being a separate step.** Not a hypothetical: one document, invisible to every test on both sides.

---

## 5. Two defects inherited from `main`, not introduced here

Running the release gate on the merged tree surfaced three failures. Rather than assume they were merge artefacts, the same suites were run against a **clean clone of `main`**, which fails identically. They are pre-existing.

### 5.1 Retired green on `main`'s new Visitor Intelligence page

`admin-visitor-intelligence.css` painted four retired-palette hexes — `#178451`, `#125e57`, `#16844f`, `#176b46` — which the palette gate rejects. This is the same defect Phase 28 fixed in the AI and forensics surfaces, reintroduced by new work, which suggests the palette gate is doing its job but arriving after the fact.

Replaced with `var(--ch-green)` / `var(--ch-green-dark)`, consistent with the rest of the codebase. `#167e76` on the selected map dot was **left alone**: it is a teal used to encode a data state, not a brand green, and blindly tokenising every non-gold colour would be its own kind of error.

### 5.2 Three legal templates changed without re-cutting the integrity baseline

`main`'s consent work edited `cookiepolicy.tpl`, `footer.tpl` and `privacypolicy.tpl`, but `docs/independent-rebuild/original-file-manifest.sha256` was not updated, so `sha256sum --check` failed for all three.

The diffs were confirmed to be legal-copy additions describing the preference centre and first-party analytics — deliberate content, not tampering. The three hashes were re-cut and the manifest now verifies.

**What was not done:** the check was not loosened, skipped, or moved. That manifest exists to detect unexpected drift; the correct response to a *deliberate* change is to record it. Deleting or weakening a safety mechanism to make output look better was ruled out from the start.

---

## 6. Verification of the merged tree

All measurements from `/tmp/integ` — a full clone with both histories merged, `npm ci` from scratch.

| Check | Result |
| --- | --- |
| `tsc --noEmit` | **clean** |
| Unit suite | **164 files / 2,332 passed, 0 failed** |
| Integration suite | **104 files / 1,017 passed, 17 skipped, 0 failed** (106 files, 2 skipped) |
| Frontend suite | **82 files / 1,011 passed, 0 failed** |
| AI audit regressions + model grounding + operator | **43 passed** |
| AI knowledge integration (incl. isolation matrix, injection, self-update) | **24 passed** |
| Migration runner + GA4 reconciliation | **11 passed** |
| Visitor Intelligence + consent (7 suites) | **38 passed** |
| `release-candidate-check.sh` | **passed** (PHP stages stubbed — §7) |
| `sha256sum --check` integrity baseline | **verifies** |
| Migration prefixes | **no duplicates**; `0100` is the tail |
| Regenerated site surfaces | **no diff after regeneration** |
| AI projection | **410 documents, up to date** |

**Both sides' work is present and passing.** The AI subsystem's 43 audit tests and the Visitor Intelligence 38 are green in the same tree, which is the specific thing this phase had to establish.

Counts rose across the board relative to this branch alone — unit 2,298 → **2,332**, integration 973 → **1,017**, frontend 1,000 → **1,011** — because the merged suite is the union of both lines' tests. That arithmetic is the point: neither line lost coverage, and every total exceeds either branch measured on its own.

**Merged-tree totals: 4,360 tests passed, 17 skipped, 0 failed** across the three suites, plus 23 repository-integrity tests in the release gate.

---

## 7. What this verification does not establish

Stated because the numbers above are large and inviting to over-read.

1. ~~No CI run exists for the merged tree.~~ **Now resolved.** The merge was pushed to the PR branch (`c5264ee`) and CI ran on it: **all five checks green** — Node 22.12 (17m12s), Node 24.8 (23m51s), Release candidate PHP 7.4 (2m49s), PHP 8.2 (2m38s), content hygiene (17s). GitHub now reports the PR as **`MERGEABLE`**, down from `CONFLICTING`.
2. ~~PHP lint was not executed.~~ **Now resolved by CI, not here.** PHP is not installed in this environment and the local gate ran with a stub. The two release-candidate jobs linted PHP for real against the *merged* tree — 7.4 and 8.2 — and passed. This is the first time any PHP has been checked in a merged state.
3. **The merge is pushed but not merged.** It is on the PR branch, not in `main`. Nothing has been landed.
4. **Nothing was deployed.** No staging, no production, no credentials, no scheduler.
5. **The AI provider path remains unverified** (Phase 28 §9.2) and is unaffected by this merge. The merge does not bring provider certification any closer.
6. **Semantic retrieval is still absent.** Two relevance failures remain as accepted limitations.

---

## 8. Recommendation

**The merge is technically ready; the authorisation is not mine to give.**

Concretely, to land this:

1. Take the two commits produced in this phase — the merge, and the fixes for the two inherited defects — onto the working branch.
2. Push so CI can run the full matrix **on the merge commit**, including PHP lint, which has never executed on a merged tree.
3. Re-run the Phase 28 §12.1b staging checklist against the staging deployment of this merged tree.
4. Then merge.

**Steps 1 and 2 are now done.** The merge is on the PR branch and CI has run the full matrix against it, green, with PHP linted for real for the first time in a merged state. GitHub reports the PR `MERGEABLE`.

**Step 3 — staging — has not been done**, and it is the one that cannot be done from here. Nothing in this document speaks to how the merged tree behaves against real PostgreSQL, a real scheduler, or a real provider.

**Do not merge on the strength of this document alone.** It reports a local suite run and a CI run of one merge. Neither is staging and neither is production certification.

The conflict resolution itself is mechanical and reviewable: 49 of 60 conflicts resolved by an objective rule, 11 by hand, each justified above, with the one genuinely dangerous choice (the migration tail test) called out.

---

## 9. Evidence that this phase changed

| Artefact | Location |
| --- | --- |
| Merged tree | `/tmp/integ` (scratch clone; not pushed) |
| Merge commit | `678ef6d` — merge + migration renumbering + projection regeneration |
| Inherited-defect commit | `96370b7` — palette and integrity baseline |
| Clean `main` comparison | `/tmp/mainonly` — proves §5 defects are pre-existing |
| CI run on the merged tree | PR #114, head `c5264ee`, five checks green |
| Gate log | `/tmp/rc-integ4.log` |
| Suite logs | `/tmp/merged-unit.log`, `/tmp/merged-integ.log` |
