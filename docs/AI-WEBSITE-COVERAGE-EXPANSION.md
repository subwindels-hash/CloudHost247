# Website AI coverage expansion

## Status

IMPLEMENTED and LOCALLY VERIFIED on `arena/1523d7fc-cloudhost247`, based on merged PR 123 (`398d38766e6eb33c959fc3e1dc12ac7158b7052f`). Not deployed, real-infrastructure verified, staging certified or production certified. No provider activation, paid calls, scheduled reporting, production data access or live migrations. No schema changes or new knowledge store. This is retrieval coverage work, not model fine-tuning or a guarantee that every possible customer question is answerable.

## Audit and root causes

The existing generated website projection, discovery, SQL index/sync, source-trust assessment, retriever, composer and support handoff are reused. Baseline architecture already included marketing pages, legal documents, published documentation, FAQs, public tools and release posts.

Two measurable extraction defects were found:

1. Eight custom storefronts render authored prose outside the generated page-content map. PHP source records held only a headline/summary (RDP 114 characters, SMM 83, SMTP 73), while their SPA navigation records were also summary-only. This omitted published guidance from retrieval.
2. The tool projection used a single-quote regex that stopped at an escaped apostrophe. SPF became `Parse and validate the domain\\` and DNSKEY became `Show the zone\\`. It also omitted the catalogue's longer descriptions, including technical details such as SPF RFC 7208 and DNS lookup limits.

## Changes

- `scripts/site/knowledge-extractors.mjs`: shared, dependency-free static literal extraction and the eight registered storefront/component mappings. No JavaScript, PHP or Smarty evaluation.
- `scripts/site/generate.mjs`: escaped-quote-aware catalogue parsing; retains existing short description and adds a detail field for the public knowledge projection.
- `scripts/site/generate-ai-knowledge.mjs`: reads registered PHP/SPA storefront prose and public tool details. Missing registered components/templates fail generation rather than silently reverting to summary-only. Provenance lists the new source paths. Existing source keys and sync pipeline retained.
- `cloudhost247-node/frontend/src/content/tools.generated.json` and `src/ai-website/content/website-knowledge.generated.json`: regenerated from actual sources, no synthetic product facts or FAQs.
- `cloudhost247-node/src/ai-website/query-understanding.ts`: vocabulary/route aliases for RDP, SMM and SMTP hosting. Aliases do not establish availability or price.
- `cloudhost247-node/tests/integration/ai-website-topic-coverage.test.ts`: real migrations, actual projection sync, SQL retrieval, deterministic composition and evidence assertions. Fifteen topic questions plus one unsupported-guarantee refusal. No mocked search or external model.
- `tests/site/knowledge-extractors.test.mjs`: literal parsing, runtime/conditional exclusions, eight storefront prose checks and retention of the SPA proxy coming-soon limitation.
- `scripts/release-candidate-check.sh`: runs the new extractor tests; no existing gate removed.
- `cloudhost247-node/docs/AI_WEBSITE_INTELLIGENCE.md`: corrects stale counts, the blanket "answers everything else" claim and the implication that publication proves runtime indexing.

## Safety retained

- Dynamic catalogue sections, mutually exclusive Smarty states, JSX conditional sections, variables, script/style content and private account data are not flattened into knowledge facts.
- Static source describes capabilities and prerequisites, not current inventory. Prices still use live facts. Provider results, catalogue stock, account state and credentials are not embedded.
- SPA proxy ordering remains explicitly unavailable; Google Workspace/Microsoft 365 prerequisites remain visible rather than being replaced by generic sales promises.
- No automatic human approval. Changed source fingerprints require re-review where previously approved; source freshness, conflict escalation, availability checks, no-match handling, privacy, auth and audit rules remain intact.
- Unsupported claims, invented URLs/prices, private-source retrieval and account-specific actions are not enabled by this work.

## Measured local coverage

The generated projection still has 430 documents; existing records gained more evidence rather than inflating the count with duplicate sources. Runtime discovery measured:

| Category | Count |
| --- | ---: |
| Website page records (includes navigation and PHP) | 165 |
| Public tool records | 53 |
| Legal records | 22 |
| Published documentation | 14 |
| FAQ records | 174 |
| Announcement/release-note records | 2 |
| Total projection records | 430 |
| Locally index-eligible | 418 |
| Thin/link-only, not answer evidence | 9 |
| Private and excluded at discovery | 3 |

The projection separately records 13 policy/visibility skips before discovery (12 customer-only tools and search). Surface counts: SPA 323, PHP 75, registry 32. There are 406 registered destinations, not 406 independently deployed/E2E-tested pages. These are local content metrics, not evidence of deployed synchronization or comprehensive question accuracy.

## Actual verification

- Full `npm test` completed its report: **3,602 passed, 50 skipped; 284 passing files and 5 skipped files (289 total)**, duration 2982.10 seconds. No skips added by this patch. The initial tool call timed out while the runner continued; the completed output was inspected rather than relaunching duplicate tests. No failure or unhandled-error summary was present. Because the original shell timed out, its final exit status was not captured; the final runner counts are the evidence, not an invented exit code.
- New topic suite run separately: **16/16 passed**, exit 0.
- New extractor suites: **3/3 passed**, exit 0; also run through the source gate.
- Server and frontend typechecks: passed before the broad suite.
- Production build, run separately after the full suite: exit 0.
- Complete release source gate: exit 0. Python groups: 468 run (2 existing skips), 6 run, and 247 run (8 existing skips), with no failures. New Node extraction tests pass.
- Pinned Smarty rendered-site audit: exit 0; every published hero parity and tool-resolution audit passed.
- Knowledge projection freshness and whitespace checks: passed.

Historical local attempts: the first topic command used repository-root cwd, so the relative migration directory was wrong and setup failed with a missing lease table; rerunning from the documented Node-project cwd passed all tests. The first source-gate run refused unstaged generated output. Staging the genuinely regenerated artefacts allowed the unchanged regeneration/diff check to run and pass. No checks were weakened to hide either result.

## Remaining limits and activation

The static extractor is deliberately bounded to eight registered storefronts, literal paragraphs/headings/list items and public catalogue string fields. It is not a universal JSX/PHP interpreter; dynamic feature arrays are not executed, and matching PHP static prose provides some feature coverage. Nested/dynamic new template shapes require extractor tests. Missing source guidance must be authored and human-reviewed, not invented by the assistant. Nine thin destinations remain navigation-only. Fifteen sampled topics are not exhaustive paraphrase, language or every-question certification.

Deployment and the existing authorized knowledge sync/reindex must occur before live customers see changed indexed prose. This session has not contacted a deployed index, triggered a production reindex, or proved current upstream content, provider availability or pricing. Existing reviewed support-procedure precedence remains unchanged. Real staging chat, permissions, source-review and sync verification remain required. The report does not authorize deployment, new providers or weekly automation.

Commit identity is recorded by Git and the completion message after final checks, not predicted here. No push, pull request or merge was performed for this follow-up.
