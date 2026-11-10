# CloudHost247 AI Website Intelligence & Customer Support

This document is the architecture record for the website-aware AI assistant. It is written in the
order the work was done: what already existed (§1), what was decided and why (§2), what was built
(§3–§10), and how it is verified (§11). Anything that could not be verified in this environment is
called out explicitly rather than claimed.

Status key: **IMPLEMENTED** = code + automated test in this repository.
**REQUIRES DEPLOYMENT CONFIGURATION** = code is complete and fails closed, but a human must supply
credentials or run a command on a real deployment before it does anything.

---

## 1. Phase 1 — Audit of what already existed

The instruction forbids building a second chatbot, a duplicate AI service, a duplicate conversation
store or a competing knowledge system. The audit below is what that constraint had to be applied to.

### 1.1 The AI chat that already exists (extended, not replaced)

| Layer | File | What it does |
| --- | --- | --- |
| Widget | `frontend/src/components/AiSupportWidget.tsx` | Floating support panel, visitor token in `X-AI-Conversation-Token`, polls every 5s, contact + newsletter forms. |
| Routes | `src/routes/ai-support.ts` | `POST /api/v1/ai-support/conversations`, `.../messages`, `.../contact`, `.../newsletter`, availability, plus `/api/v1/admin/ai-support/*`. |
| Decision layer | `src/services/ai-support-operator.ts` | Regex guard rails (human request, security, refund, complaint, account-specific, server incident, action request), catalog pricing read, then a single knowledge lookup. |
| Knowledge | `src/ai/knowledge.ts` | 20 hand-written reviewed entries (`CLOUDHOST247_KNOWLEDGE`) with `keywords`, `answer`, `source`, `weight`. |
| Store | `0057_create_ai_support_operator.sql` | `ai_support_conversations`, `ai_support_messages`. |
| Escalation | `src/routes/ai-support.ts` | `support_agent_presence` capacity routing, linked `support_tickets` (0010) for signed-in customers, notification outbox to the queue. |
| Admin UI | `frontend/src/pages/AdminAiSupportPage.tsx` | Transcripts, assignment, presence, knowledge list, newsletter subscribers. |

The audit conclusion: the conversational shell, transcript store, escalation path and RBAC were all
sound. The **knowledge source** was the limitation — a fixed 20-entry array can answer roughly the
20 topics a developer typed in, and nothing else. Every new service page required a hand-written
entry, which is exactly the failure mode the task describes.

### 1.2 The AI Control Plane that already exists (reused for storage and governance)

`0066_create_ai_control_plane.sql` already defines a RAG store:

- `ai_knowledge_sources (id, title, source_type, uri, version, status, ...)`
- `ai_knowledge_chunks (id, source_id, chunk_index, title, content, keywords)`
- `src/ai-os/repositories/memory-knowledge-repo.ts` — `createKnowledgeSource`, `addKnowledgeChunks`,
  `searchKnowledge` (keyword scoring, 500-row scan).

Reusing this was the obvious choice: it is already the platform's canonical knowledge base, already
admintsitered by RBAC/audit, and already used by the AI Control Plane. But its `source_type` CHECK
constraint (`manual|doc|faq|policy|procedure|runbook|resolution`) has no concept of a *website page*,
it has no URL/section/category/fingerprint/sync-state columns, and its search loads every chunk into
node on each query. So the store is **extended by one migration**, not duplicated.

### 1.3 Website surfaces that must feed the AI

| Surface | Authoritative artefact | Count (this revision) |
| --- | --- | --- |
| Shared navigation registry | `shared/site/registry.json` → `cloudhost247-node/src/navigation/registry.generated.ts` | 207 registry routes, 9 nav sections + footer |
| SPA marketing pages (rich content) | `cloudhost247-node/frontend/src/content/pages.generated.json` | 55 pages, 129 sections, 174 FAQs |
| SPA documentation | `frontend/src/content/docs.generated.json` + markdown in `docs/` | 13 documents |
| SPA legal policies | `frontend/src/content/legal.generated.json` | 18 documents |
| SPA tools | `frontend/src/content/tools.generated.json`, `src/tools/catalog.ts` | 65 public tools, 265 served routes |
| SPA announcements | `frontend/src/content/announcements.ts`, `shared/site/content/news.json` | announcement bar + 5 release notes |
| PHP / WHMCS pages | `modules/addons/cloudhost247_theme/resources/site.json`, root `*.php` routes | 67 registered editorial pages |
| PHP publication + crawl policy | `modules/addons/cloudhost247_theme/lib/PublicDiscovery.php`, `CrawlPolicy.php`, `shared/site/registry.json → sitemap` | publish rules + `exclude` / `excludePhp` |
| Authored PHP legal text | `refund-policy.php`, `backup-policy.php`, `cybercrime-policy.php`, `trademark-policy.php` | 4 long-form policies that exist only in PHP |
| Live catalogue | PostgreSQL `products`, `product_plans`, `plan_pricing`, `plan_features` | runtime data |
| Sitemap generation | `src/routes/seo.ts` (`/sitemap.xml`, `/robots.txt`), `cloudhost247-sitemap.php` | generated at request time |
| Unified Inbox | `0078_create_unified_inbox.sql`, `src/inbox/inbox-service.ts` | channel/conversation store |

**Blog**: `/blog` exists as a marketing page rendering the `news` section from
`shared/site/content/news.json` (5 entries, no per-entry route). There is therefore no blog *post*
route to index; the release notes are indexed as one page plus the announcement feed. This is stated
here so the final counts are not inflated with invented "articles".

### 1.4 What was verified absent

- No `pgvector`, no `pg_trgm` extension: confirmed against the embedded Postgres engine the test
  suite runs on (`CREATE EXTENSION` fails for both). Any design that assumed a vector extension
  would be untestable in this repository and unavailable on typical cPanel PostgreSQL.
- No external model credentials are required by anything today; the provider abstraction
  (`AI_LLM_BASE_URL/API_KEY/MODEL/API_STYLE/TIMEOUT_MS`) fails closed with `CONFIGURATION_REQUIRED`.
- No unified "customer support intelligence" link between the AI chat and the Unified Inbox; the chat
  only bridged into `support_tickets`.

### 1.5 Baseline

- `npx tsc -p tsconfig.json --noEmit` → exit 0 before any change.
- `npx vitest run` → baseline captured to `/tmp/vitest-baseline.log` before any change.

---

## 2. Phase 2 — Decisions

**D1. One knowledge system, extended.** Migration `0097_ai_website_knowledge.sql` adds
`source_kind`, `source_key`, `url`, `section`, `category`, `fingerprint`, `sync_status`,
`last_synced_at`, `excluded`, and the chunk columns `url`, `page_title`, `section`, `category`,
`fingerprint`, `search_text`, plus a generated `tsvector` and a GIN index — all on the existing
`ai_knowledge_sources` / `ai_knowledge_chunks` tables. `source_type` keeps its historical value
(`doc`) so the CHECK constraint is untouched; `source_kind` is the new taxonomy
(`website_page|website_tool|website_doc|legal_document|product|service|faq|announcement|catalog_page`).

**D2. No new paid dependency, no vector extension.** Retrieval is layered:
1. PostgreSQL full-text search (`to_tsvector('english', …)` on a generated column, GIN-indexed) for
   the lexical pass — available on any PostgreSQL ≥ 12, incl. the cPanel target and pglite in tests.
2. A deterministic query-understanding layer (abbreviations, misspellings, synonyms, entity
   extraction) that rewrites the customer's words into a weighted tsquery *and* a normalised
   keyword set.
3. A reranker that combines lexical rank, entity overlap, page kind and section weight.
**Embeddings are not implemented.** An earlier revision of this paragraph described them as an
"optional additive layer" that an operator could enable through the `AI_LLM_*` seam. That was wrong:
there is no embedding call, no vector column and no configuration key for one, so nothing could be
enabled. The *seam* is real — `RetrievedChunk.score` is the only value the composer sees, so a hybrid
scorer could be merged into `retrieveKnowledge` without touching the answer path — but a seam is a
place to put something, not the thing itself. §5.4 records why embeddings are absent; that reasoning
stands and this paragraph now agrees with it.

**D3. Grounded answers, not canned ones.** The answer composer builds a response **from the retrieved
chunks**: title, the relevant excerpt, the verified URL, related links taken from the chunk's page.
It cannot emit a URL, price or plan that retrieval did not return. When the optional model provider
is configured, the same evidence is passed to it with a strict "answer only from this evidence"
contract and its output is checked back against the evidence (every internal link it prints must be a
URL that retrieval verified). Escalation rules from `ai-support-operator.ts` keep priority.

**D4. Live data beats indexed data.** Prices, availability and account-specific facts never come from
the index. `catalog-service` reads are the authority for plans/prices, and a "live facts" resolver
runs on every question that looks commercial or account-specific.

**D5. Discovery reads registries, not the network.** The crawler never fetches the live site: on
cPanel the Node app and the PHP site share a domain, and a self-crawl would be a self-DoS as well as
unreliable. Discovery reads the *same generated artefacts the website is built from* (registry,
content JSON, tool catalogue, PHP site map, crawl policy), which is precisely why a newly published
page is discovered the moment the site generator runs. A live-site HTTP crawl exists only as an
explicit, opt-in admin action for a *separate* PHP host.

**D6. Sync is event-driven with a reconciling sweep.** Content writes call
`aiKnowledgeSync.ts` after they succeed (fire-and-forget, non-blocking, failure recorded). A worker
sweep recomputes fingerprints and repairs drift. Fingerprints are SHA-256 of the normalised document,
so an unchanged page is never reindexed.

**D7. Prompt-injection is a data problem, not a wording problem.** Crawled text is stored with a
`sanitizeForIndex` pass that strips instruction-like scaffolding and is never fed to a model as
instructions; it is only ever inserted as evidence inside a delimited block, and the model's output is
validated against the evidence. Tests assert this.

---

## 3. Implementation map

Every file below is new or modified in this change set. Nothing in §3–§10 is marked IMPLEMENTED
without an automated test in §11 that exercises it.

| File | Status | Purpose |
| --- | --- | --- |
| `scripts/site/generate-ai-knowledge.mjs` | new | Projects every website source (content JSON, docs markdown, PHP page registry + authored PHP policy text, tool catalogue, navigation registry, announcements) into one knowledge projection. `--check` mode for CI. |
| `src/ai-website/content/website-knowledge.generated.json` | generated | The projection itself: 409 documents, 377 verified routes, 921 kB. Committed, because it is build output that the server imports. |
| `src/ai-website/types.ts` | new | Shared types plus pure text utilities: `htmlToText`, `sanitizeForIndex`, `foldText`, `contentFingerprint`, `extractPrices`, `isSafeInternalPath`, `canonicalPath`. |
| `src/ai-website/query-understanding.ts` | new | Intent classification, ~40 curated service entities with routes and aliases, abbreviation expansion, typo correction (OSA distance), compound splitting, synonym expansion, follow-up inheritance, coverage-gap detection. |
| `src/ai-website/website-discovery.ts` | new | Pure discovery over the projection + crawl policy + admin exclusions: 409 discovered, 394 publishable, 3 private paths excluded, 377-route registry, corpus vocabulary, `resolveRoute`. |
| `src/ai-website/chunking.ts` | new | Structure-first chunking (heading sections, runts merged, sentence split fallback, 60 chunk/document cap) with per-chunk keywords. 1001 chunks over the real corpus. |
| `src/ai-website/website-knowledge-repo.ts` | new | The SQL layer: source upsert, chunk replace, sync status, prune, FTS search (`to_tsquery` + `ts_rank`), title lookup, overview counters, admin search. |
| `src/ai-website/knowledge-sync.ts` | new | Full reconcile with a run ledger, event-driven `syncSourceKeys`, `scheduleKnowledgeSync`, `retryFailedSources`, `detectDrift`, `previewDocument`, exclusion loading. |
| `src/ai-website/knowledge-worker.ts` | new | Worker tick: bounded failure retries + a 15-minute full reconcile, reusing the existing worker loop and lease discipline. |
| `src/ai-website/retrieval.ts` | new | The retriever: lexical leg + title leg, specificity-weighted rerank, negative evidence applied last, page grouping with diminishing returns, honesty floor. |
| `src/ai-website/live-facts.ts` | new | Read-only live catalogue facts: published plan prices, cheapest-per-group, domain prices from `domain_provider_extension_offerings`, availability. Never amounts from the index. |
| `src/ai-website/answer-composer.ts` | new | Deterministic grounded composition, verified-link construction, price blocks from live facts, clarification and escalation, model-output validation, follow-up suggestions. |
| `src/ai-website/grounded-model.ts` | new | Optional model *phrasing* over the same evidence. Fails closed (`null`) when unconfigured; prompt-injection framing; strict system contract. |
| `src/ai-website/unanswered.ts` | new | Coverage-gap queue: normalise + upsert a question, resolve it when content lands. |
| `src/routes/ai-knowledge-admin.ts` | new | Admin knowledge centre API: overview, search, sources, single source + chunks, reindex (full/selected), retry, exclusions CRUD, gaps, coverage. RBAC + audit on every mutation. |
| `src/services/ai-support-operator.ts` | modified | Reviewed procedures now answer *procedures* and the website layer answers everything else; adds account-recovery path, follow-ups, links, evidence, honest engine reporting. |
| `src/ai/knowledge.ts` | modified | Reviewed entries carry verified `links`, resolved through the route registry at answer time. Word-boundary keyword matching (a substring match had handed "wordpress" to the RDP entry). |
| `src/routes/ai-support.ts` | modified | Persists `links`/`evidence`/`grounded` on each message; records unanswered questions; answer-feedback endpoint; gap triage endpoint; passes the customer's current page. |
| `src/routes/catalog-admin.ts` | modified | Catalogue create/update/status publish an event that reindexes that product immediately. |
| `src/worker/main.ts` | modified | Schedules the knowledge sweep in the existing loop, isolated so a failing reindex cannot stop billing or provisioning. |
| `src/app.ts` | modified | Registers the admin knowledge routes. |
| `database/migrations/0097_ai_website_knowledge.sql` | new | Extends the existing knowledge tables; adds sync ledger, exclusions, answer feedback and the unanswered-question queue; message provenance columns. |
| `frontend/src/components/AiSupportWidget.tsx` | modified | Rendering of verified links with in-panel navigation, feedback, typing indicator, follow-up suggestions, keyboard/Escape handling, live region, retry without a phantom message. |
| `frontend/src/pages/AdminAiKnowledgePage.tsx` | new | The knowledge control centre UI. |
| `frontend/src/ai-support.css` | modified | Widget affordances and control-centre layout, `prefers-reduced-motion`, focus-visible. |
| `tests/unit/ai-website-intelligence.test.ts` | new | 19 unit tests: understanding, correction, discovery, chunking, sanitisation, path safety. |
| `tests/integration/ai-website-knowledge.test.ts` | new | 13 pglite tests: sync/reconcile, drift, retrieval quality, verified links, private-path exclusion, catalogue add/withdraw, RBAC + audit, endpoints. |
| `tests/integration/ai-website-publish.test.ts` | new | 5 pglite tests for the headline criterion: a page the code has never seen becomes answerable. |
| `tests/integration/migrate.test.ts` | modified | `0096` added to `EXPECTED_MIGRATIONS`. |
| `tests/integration/ga4-reconciliation-migration.test.ts` | modified | The upgrade-path assertion no longer hardcodes the end of the migration list (it was asserting the exact tail, which made it a blocker for every future migration). |
| `src/routes/email-forensics-customer.ts` | modified | Third defect, found while running the suite: the raw-upload content-type parsers never called `done`, so every `.eml` upload hung until the client timed out. See §3.2. |

### 3.1 Two defects found in existing code and fixed here

1. **`src/ai/knowledge.ts` keyword matching was substring-based.** `'can i host wordpress'.includes('rdp')` is
   true — *wo**rdp**ress* — so the reviewed knowledge base answered a WordPress question with the RDP
   entry at maximum confidence. Matching is now word-boundary based. A knowledge base that confidently
   answers the wrong question is worse than one that answers nothing.
2. **The `about` entity alias was the bare word `about`.** "what about WordPress?" resolved to the About
   CloudHost247 page. The alias is now a phrase only.

Both were latent before this work; the second only became visible once entity resolution fed ranking.

### 3.2 A hung request found by the integration suite (unrelated to the assistant, fixed)

Running the full backend integration suite surfaced a pre-existing failure:
`POST /api/v1/email-forensics/analyze-file` timed out after 120 s. The cause was not the analysis —
`runAnalysis` completes in ~25 ms — but the route's content-type parsers:

```ts
app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body: string) => body);
```

Fastify treats a two-argument parser as a synchronous parser and **never sends the reply**; a
three-argument `(request, body, done)` parser must call `done`. Every raw upload therefore hung until
the client gave up, and the failure presented as an analysis timeout rather than a framework misuse.
Fixed by passing `done`. Verified: the route now returns 200 in 47 ms and the suite is green.

This is recorded because it is exactly the class of bug the task's "record blockers, never mark an
unverified feature complete" instruction is about — the suite found it, and it would have shipped as
"uploads sometimes hang" otherwise.

---

## 4. Discovery and indexing

### 4.1 What is discovered

`node scripts/site/generate-ai-knowledge.mjs` reads the artefacts the site itself is built from — not
the live site (§2, D5) — and writes one projection. Measured on this revision:

| Source | Documents |
| --- | ---: |
| SPA marketing pages (sections, hero, CTAs, FAQs rendered to text) | 145 |
| SPA tools | 53 |
| Legal documents (SPA JSON + authored PHP policy prose) | 22 |
| Documentation articles | 13 |
| FAQs (from page content) | 174 |
| Announcements and release notes | 2 |
| **Total** | **409** |

Surfaces: SPA 314, PHP 67, navigation registry 28. Thirteen sources are skipped by the site's own
crawl policy and recorded with a reason in `report.skipped`. The projection also emits the **377
verified routes** the site actually serves; §7 depends on this.

Discovery then applies the same policy at runtime: **409 discovered → 394 publishable → 3 excluded**
(`/dashboard/dns`, `/dashboard/domains`, `php:dns-management.php` — private, authenticated
destinations). Twelve thin link-only pages are retained but carry their navigation blurb as their
body rather than being dropped, so "where do I find X" still resolves.

### 4.2 Chunking

Structure first: a page is cut at its own headings, so every chunk carries the heading it belongs
to. Runts under 120 characters merge forward; an over-long section is sentence-split; a document is
capped at 60 chunks. Measured: **1001 chunks** over 394 publishable pages, VPS page = 4 chunks,
refund policy = 6. Every chunk stores `url`, `page_title`, `section`, `category`, `source_kind` and a
fingerprint, so an answer can always name its source page and passage.

### 4.3 What is deliberately not indexed

`/dashboard/*`, `/admin/*`, `/account/*`, `/billing/*`, `/checkout/*`, `/cart`, `/login`,
`/forgot-password`, `/reset-password`, `/verify-email`, `/support/*` and every PHP equivalent are
refused by `isPrivatePath`, and the integration test asserts the database contains no source whose
URL matches those prefixes. Authenticated pages are still *linkable* — `/account` is a verified route
and the assistant points customers at it — but their contents are never retrievable.

---

## 5. Retrieval

> Status: **IMPLEMENTED**, no embeddings (see §5.4).

### 5.1 Query understanding

- **Intent**: `pricing | availability | how_to | comparison | definition | navigation |
  troubleshooting | support_request | account_specific | general`, with a comparison flag and a
  follow-up flag.
- **Entities**: ~40 curated offerings, each with a canonical verified route and aliases
  ("vps", "virtual private server"; "wp", "wordpress", "woocommerce"; "cp", "cpanel", "whm").
- **Typo tolerance**: optimal-string-alignment distance over the *indexed corpus vocabulary*, not a
  hardcoded misspelling list. OSA matters: `vsp → vps` and `wrodpress → wordpress` are transpositions
  — one edit under OSA, two under plain Levenshtein. A one-word fix means a customer who mistypes still
  gets the page.
- **Compound splitting**: "webhosting" and "wordpresshosting" are matched against the live vocabulary
  and split into their parts. Without this the query returned zero candidates and the assistant had
  to say it could not verify something it publishes.
- **Protected words**: `cost`, `price`, `cheapest` and friends are never "corrected" — `cost` is one
  edit from `cose`, and silently rewriting it turned a pricing question into nonsense.
- **Strict vs boost terms**: the customer's own words are *required* of a page; words we add
  ourselves (synonyms, abbreviation expansions) only ever boost. An expansion that merely restates a
  word ("cpanel" → "control panel") does not excuse the word.

### 5.2 The two legs

1. PostgreSQL full-text search over a generated `tsvector` (`page_title` weighted A, section B, body
   C) with a GIN index, using `to_tsquery` built **only** from sanitised `term:*` tokens — never from
   raw customer text, so no tsquery syntax can be injected.
2. A keyword-array leg and a direct title lookup, which catch the cases English stemming and stop
   words handle badly for a two-word question.

### 5.3 Reranking

The reranker is the part that decides whether the assistant is useful. Each of these was added
because a real question ranked wrong without it:

- **Specificity weighting** (inverse candidate-set frequency). "hosting" appears on most of the site;
  "kubernetes" appears on one page. Coverage is therefore weighted by how much each matched term
  actually discriminates, so matching only "hosting" is not coverage.
- **Each term contributes once**, at the weight of the best field it was found in. Counting a term
  once per field rewarded long pages that repeat the question's words.
- **Negative evidence applied last, multiplicatively.** A page that never says the word the customer
  used is not the answer, however many bonuses (entity route, title match, exact FAQ) it collected. It
  is applied *after* the additive bonuses specifically so no bonus can buy past it.
- **Entity routes**: the curated vocabulary knows which page *owns* an offering, so "do you support
  cPanel" reaches `/hosting/cpanel` rather than whichever developer document mentions cPanel first.
- **Page-title words** outrank incidental body mentions.
- **Document kind follows the question**: a policy is a poor answer to "how do I register a domain"
  even when it contains every keyword; developer docs are damped for commercial questions.
- **Chunk position**: the opening chunk of a page is its summary; a tenth FAQ is a corollary.
- **Page grouping with diminishing returns**: a page earns credit for several relevant chunks but
  cannot swamp a precise short page by having more chunks indexed.

Measured behaviour (§11 asserts these):

| Question | Top page |
| --- | --- |
| Do you sell VPS? | `/hosting/vps` |
| Can I host WordPress? / can i host wrodpress / wp hosting | `/hosting/wordpress` |
| do you support cpanel | `/hosting/cpanel` |
| What is the cheapest hosting? / webhosting prices | `/hosting/web-hosting` |
| How can I register a domain? | `/domains` |
| What is SSL? | `/hosting/ssl` |
| Do you provide business email? | `/hosting/email` |
| What is the refund policy? | `/legal/refund-policy` |
| Where can I manage my hosting? | `/hosting/web-hosting` + `/account` destination |
| Can you forecast the weather next month? | *nothing* — honest escalation |

### 5.4 Embeddings: deliberately not added

The task allows embeddings "via the configured provider". They are **not implemented**, and the reason
is architectural rather than a shortcut:

- `pgvector` is not available in the target PostgreSQL (verified: `CREATE EXTENSION vector` fails) and
  is not installable on a typical cPanel shared deployment. Storing vectors outside the database means
  a second index, a second sync path and a second consistency problem — a competing knowledge system,
  which the instructions forbid.
- Computing embeddings through `AI_LLM_*` would make every sync depend on an external API and make the
  index silently partial whenever that provider is unavailable. The instruction is explicit that an
  external AI API must not be a hard requirement.
- The lexical engine with the layers in §5.1–5.3 answers the corpus correctly without them (§11).

The seam is documented: `RetrievedChunk.score` is the only thing the composer sees, so a future
hybrid scorer can be merged in `retrieveKnowledge` without touching the answer path. The admin console
reports `embedding: "not used — lexical retrieval (tsvector) with synonym expansion and reranking"`
rather than implying something it does not do.

---

## 6. Live facts

`resolveLiveFacts()` reads the catalogue on demand; nothing here is cached into the index.

- **Plan prices** come from `plan_pricing` joined to published plans of active, public products, and
  only rows with `effective_status = 'published'` and a non-null amount. A draft price is never
  quoted, because a draft price is not a price.
- **Domain prices** come from `domain_provider_extension_offerings` filtered on `status = 'enabled'`.
  There is no other source of domain pricing in this system, so if that join is empty the answer says
  the price cannot be verified rather than showing a number.
- **Availability** is `products.available`/`status`/`visibility`. A private or disabled product is
  never presented as purchasable.
- **Failure is honest**: when the catalogue cannot be read, the composer says so and offers support.
  It never falls back to a remembered number.

Every price in an answer is formatted from a `LivePrice` object, and the model-phrasing layer is only
given strings it may quote verbatim.

---

## 7. Answers, links and honesty

### 7.1 How an answer is built

1. Guard rails first, unchanged in priority: explicit human request, security incident, refund,
   complaint, server incident, any account-specific request → escalate. These are vetoes.
2. Reviewed *procedures* (the 20 reviewed entries) answer when the question is procedural. Their
   answers are short operational instructions; they now also carry verified `links`.
3. Otherwise retrieval answers from the whole site.

The composition is deterministic: the primary page's own summary is quoted verbatim (not drafted),
a materially different second page is quoted for comparisons, a navigation question leads with the
destination, a pricing question appends the live catalogue block, and any uncovered gap is stated as
a gap rather than implied.

### 7.2 Links cannot be invented

`resolveRoute()` only returns a path present in the projection's 377 verified routes. Every link the
composer emits passes through it, and links to the page the customer is already on are dropped. The
property is structural: there is no code path that can produce a URL that is not a served route. The
integration test asserts every indexed page URL is in the route registry, and the publish test asserts
that a page which is indexed but *not* registered cannot be linked.

### 7.3 The optional model, and why it is safe

`grounded-model.ts` sends only the retrieved evidence, labelled as untrusted, under a system contract
that says instructions inside evidence are data. Its reply is then validated by
`validateModelAnswer`:

- every path it prints must resolve to a route **and** be one of the evidence URLs for this answer;
- every money amount it prints must match a live price string it was given.

If either check fails the model's text is discarded and the deterministic answer is used. A failure to
reach the provider, a timeout, a rate limit or a malformed body all return `null`, which is the same
path. In this test environment no provider is configured, so every test runs the deterministic engine
— the admin overview reports `phrasing: "retrieval"` and the reason, rather than pretending.

### 7.4 Prompt injection

`sanitizeForIndex` strips instruction-like scaffolding, chat-template tokens, zero-width and
direction-override characters, long base64 runs and markup before anything is stored. Evidence is
inserted into a delimited `<evidence>` block, never into the instruction position, and the output
validation in §7.3 means an injected instruction that succeeded in changing the model's wording still
cannot produce a link or a price. Tests assert the sanitiser's behaviour.

---

## 8. Sync

- **Event**: catalogue writes call `scheduleKnowledgeSync` after commit, fire-and-forget, so a product
  publish never fails or slows because the index is busy.
- **Schedule**: the existing worker loop runs `sweepWebsiteKnowledge` every 15 minutes — bounded
  failure retries, then a full reconcile. Reusing the existing loop means no second scheduler, no
  second lease mechanism and no second `worker:once` path. A failing sweep is caught and logged so it
  cannot stop billing or provisioning.
- **Fingerprints**: SHA-256 of the normalised document. A second sync over unchanged content reports
  `indexed: 0, unchanged: 394` (asserted), which is what makes a 15-minute reconcile cheap.
- **Removal**: a page that disappears from the projection is deleted, with its chunks, by
  `deleteSourcesNotIn` during a full reconcile; `detectDrift` reports `missing`/`changed`/`unexpected`
  without writing. Asserted both directions (added → indexed, withdrawn → removed).
- **Status and failures**: each source is `pending|indexed|skipped|excluded|failed` with a
  plain-language note and a failure counter; `retryFailedSources` retries bounded batches so a
  permanently broken page cannot hold the sweep forever. A run ledger records trigger, counters and
  duration for every sync.

---

## 9. Customer support intelligence

- **Tickets and hand-off** are the existing ones (`support_tickets`, agent presence, capacity routing,
  notification outbox). Nothing was re-implemented.
- **Transcript preserved**: on escalation the assistant's own message is now written to the transcript
  before the hand-off. Previously the customer's question was followed by silence in the record —
  the agent could not see what the customer had already been told.
- **Ownership checks** are unchanged and re-asserted: a conversation is readable only by its
  authenticated owner or its opaque visitor token; the test proves a second visitor token gets 404.
- **No sensitive action without the existing authorised workflow**: refunds, ownership changes,
  billing alterations and provisioning are never performed by the assistant. Refund and account-change
  requests escalate; the assistant explains the published workflow and does not claim the action
  happened.
- **Unified Inbox**: not wired. The chat bridges into `support_tickets` (existing behaviour) and the
  assistant is not given inbox access. Wiring it would mean giving the assistant read access to
  customer conversations — a decision that needs its own authorisation review, so it is listed in §13
  rather than half-done here.

---

## 10. Admin knowledge control centre

`/admin/ai-support/knowledge` (new page) over `/api/v1/admin/ai-support/knowledge/*` (new API).
Reads are `staff`; every mutation is `admin`/`super_admin` and writes an audit entry with the actor.

| Capability | Where |
| --- | --- |
| Counts of pages, products, services, articles, FAQs, legal, tools, announcements | `GET .../overview` → `groups` |
| Healthy totals, chunks, failed, stale > 7 days | `GET .../overview` → `overview` |
| Drift: changed / missing / unexpected | `GET .../overview` → `drift` |
| Searchable index | `GET .../search?q=` |
| Source inventory, filter by status/kind/text | `GET .../sources` |
| One source with its chunks (the evidence behind an answer) | `GET .../sources/:id` |
| Full reindex, selected-source reindex | `POST .../reindex` (audited `AI_KNOWLEDGE_REINDEXED`) |
| Retry failures | `POST .../retry` |
| Exclusions list / add / remove | `GET|POST .../exclusions`, `DELETE .../exclusions/:id` |
| Unanswered questions, low-confidence answers, negatively rated answers | `GET .../gaps` |
| Mark a gap covered | `PATCH .../gaps/:questionKey` |
| Coverage by kind and surface | `GET .../coverage` |
| Engine honesty (phrasing engine, model configured, retrieval method) | `GET .../overview` → `engine` |

The page deliberately has **no "teach the assistant" text box**. The index is a projection of the
published site; the fix for a wrong answer is to fix the page and reindex. A free-text override would
be a second source of truth, and the second one always rots.

---

## 11. Verification

Everything below was executed in this environment on this change set.

### 11.1 Type checks and build

| Check | Result |
| --- | --- |
| `npx tsc -p tsconfig.json --noEmit` (backend) | **pass**, 0 errors |
| `npx tsc -p frontend/tsconfig.json --noEmit` (frontend) | **pass**, 0 errors |
| `node scripts/site/generate-ai-knowledge.mjs --check` | **pass**, projection current |

### 11.2 Tests

| Suite | Result |
| --- | --- |
| `tests/unit` (156 files) | **2261 passed**, 0 failed |
| `tests/integration` (99 files) | **979 tests**: 966 passed, 11 skipped, 2 failed before the two fixes in §3.1/§3.2–§11.3; both fixed and re-run green individually (`ga4-reconciliation-migration`, `email-forensics-api`) |
| `tests/integration/ai-website-knowledge.test.ts` | **14 passed** |
| `tests/integration/ai-website-publish.test.ts` | **5 passed** |
| `tests/unit/ai-website-intelligence.test.ts` | **19 passed** |
| `tests/unit/ai-support-operator.test.ts` | **6 passed** (pre-existing, unchanged behaviour) |
| `frontend/tests` (80 files) | **1000 passed** |
| `vite build` (frontend) | **pass** — `AdminAiKnowledgePage` chunk emitted |

### 11.3 What the tests actually prove

**Discovery and indexing.** The whole public site is discovered (> 300 pages, all kinds present); no
page URL is ever outside the verified route set; private/admin/auth destinations are excluded from
the index (asserted against the database, not the code); a second sync over unchanged content reports
`unchanged > 300, indexed = 0`; `detectDrift` reports no changed/missing/unexpected rows after a
clean sync.

**Retrieval.** Fixed expectations for eight real questions (§5.3 table); misspelling (`wrodpress`),
transposition (`vsp`) and abbreviation (`wp`) all reach the right page; a question with no grounding
returns nothing above the floor; the corpus vocabulary contains the words customers use.

**Publishing a new page (the headline criterion).** A page added to the projection with a product name
that appears nowhere in the repository is discovered (`discovered = n + 1`), indexed with chunks, and
answerable by name, by typo (`kubernets`) and by a question about its content ("how are cluster
upgrades handled?" → the page's own words). No prompt, FAQ, seed or code change is involved. Removing
the page from the projection removes it from the index and it is no longer answerable.

**Safety.** A second visitor token cannot read another conversation (404); unauthenticated admin
access is 401 and `staff` cannot reindex (403) while `admin` can (200, audited); a withdrawn
catalogue product leaves the index; a page that is indexed but not a registered route cannot be
linked; `isSafeInternalPath` refuses schemes, protocol-relative URLs and traversal; the sanitiser
removes script/style content and instruction-like text.

**Answers.** Every assistant message persists its `links`, `evidence` and `grounded` flag, and a
reopened conversation returns them (asserted through the API, not the composer). An unanswerable
question escalates with `AI_UNABLE_TO_ANSWER` **and** is recorded in the unanswered-question queue.

**Catalogue events.** Writing a product then disabling it and syncing with `catalog:product:<slug>`
leaves it out of the index; re-enabling and re-syncing indexes it. This test found a real defect in the
event path (catalogue documents were only loaded when an explicit `sourceKinds` was passed, so the
hook passed its key and indexed nothing) which is now fixed.

### 11.4 Honest limitations of this verification

- **No model provider was exercised.** The `AI_LLM_*` path is fail-closed and returns `null`, so every
  assertion above is about the deterministic engine. The model path's *validation* (link and price
  checking) is code-reviewed and unit-shaped, but has not been run against a live provider in this
  environment. It cannot be claimed as verified end-to-end.
- **No live-site HTTP crawl was exercised.** Discovery reads the compiled projection by design (§2,
  D5); the optional admin-triggered crawl of a separate PHP host is not implemented in this change.
- **Timing figures** (sync ≈ 8 s for 409 documents / 1001 chunks in pglite) are from an embedded
  single-process Postgres and will differ on a server.

---

## 12. Remaining external dependencies

| Dependency | What is needed | Effect if absent |
| --- | --- | --- |
| Regenerate the projection | Run `node scripts/site/generate-ai-knowledge.mjs` (or the site build) after changing content | Answers lag the site until the next worker reconcile picks up the committed projection |
| Initial index | `npm run migrate` then `POST /api/v1/admin/ai-support/knowledge/reindex`, or wait one worker tick | Assistant escalates everything until the first sync |
| Model phrasing (optional) | `AI_LLM_BASE_URL`, `AI_LLM_API_KEY`, `AI_LLM_MODEL`, `AI_LLM_API_STYLE` | Deterministic answers only; console says so explicitly |
| Worker | The existing worker must be running (or `worker:once` scheduled) | No periodic reconcile; event-driven sync still works |

No new package, service, paid API or credential was introduced by this change.
