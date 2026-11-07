# Website functionality audit — 7 November 2026

## Status and scope

**Partial audit, not a sign-off of every interactive element.** The repository contains a large React application, PHP pages, and a WHMCS theme. The source inventory below is a starting point for a complete audit; it is not a list of controls proven functional. No production/staging customer account, WHMCS instance, payment gateway, registrar, server provider, or deployed backend was available for end-to-end verification. External sites were not reachable from this environment. Do not interpret fixture screenshots or tests as real orders, payments, or support conversations.

## Findings corrected

| Surface | Observed problem | Correction and evidence |
| --- | --- | --- |
| Catalogue plan “Add to cart” | Link supplied only a plan slug; cart ignored it. A plan slug is not globally unique. | Links carry product slug, plan slug and selected billing period. New authenticated `POST /api/v1/cart/catalog-items` resolves public, active product and plan on the server and uses existing server-side price and eligibility checks. Chromium fixture test and PGlite commerce tests pass. |
| Homepage pricing “Choose plan” | Each card linked to a generic product page, losing the selected plan; price always had `/mo` even for other periods. | Card uses its product, plan and actual USD billing period for cart selection; correct period label. If there is no orderable USD price, it links to contact rather than promising an order. The homepage layout was not rebuilt. Chromium fixture verifies the link. |
| Cart selected-plan continuation | Cart intent was read outside router state and could fail for navigation while mounted. | Consume either catalogue or platform selection after initial cart load; preserve other query parameters and hash; remove consumed intent before sending so reload does not repeat it; show API failures. Tests cover login continuation, reload, failure and a second platform intent while mounted. |
| Expert service selection | Preselection read `window.location.search` instead of router state; an unknown offering could silently select an unrelated service. | Read router query parameters, ignore stale requests, show loading errors or unavailable-service message and require an explicit alternative. Chromium fixtures exercise selected and unavailable offerings. |
| Published website links | Website builder's “View published” links opened the JSON API rather than the published website. | Both point to `/sites/:slug`; the list link is checked in Chromium with fixtures. The actual published site/backend was not exercised end-to-end. |
| Cart Remove | In Chromium, white ghost-button text was effectively invisible on the white cart surface. | Use the existing light-surface outline style; browser checks rendered color and DELETE request using a fixture. Other ghost buttons outside this cart remain to be reviewed on their actual backgrounds. |
| Route / fragment position | Client-side route transitions retained the previous page's scroll position; screenshot showed cart landing at the footer. | Scroll new routes to top and wait for lazily rendered fragment targets with sticky-header offset. Chromium checks cart landing and homepage `#pricing`; back/forward restoration and every fragment remain unverified. |
| Support message failure | The UI optimistically displayed an unsent customer message as though delivered and cleared the draft on an API error. | Append the message only after a successful response; restore the draft on failure. Chromium fixtures exercise success, failure and panel close. Real support delivery is unverified. |

## Runtime-tested controls in this audit

The 12 tests in `cloudhost247-node/e2e/functionality-audit.spec.ts` exercise these specific controls and contexts only:

1. Catalogue product's **View plans → Add to cart**, login form, cart **Place order**, invoice link, reload and JS page-error capture for that flow.
2. Mobile quick-navigation **Pricing** link at 390×844.
3. Homepage **See plans** fragment and pricing position.
4. Homepage **Choose plan** link's product, plan and period.
5. Expert request **Service**, title, description and **Send request**, plus unavailable-service validation.
6. AI Support **open → Start conversation → Send → Close**, including failed-send draft recovery.
7. Builder **View published** URL for a published fixture.
8. Cart **Remove** button, visible text color and DELETE request.
9. Failed catalogue add: visible error, unrelated query retention and no retry on reload.
10. Two platform plan intents handled in succession while the cart remains mounted, without a duplicate on reload.

**All these browser API responses are synthetic fixtures.** The production build was tested in Chromium; other engines and device sizes were not tested. The two unmocked navigation tests generated Vite proxy connection-refused logs for optional catalogue/navigation/currency requests because no backend was listening. Those tests verify only the stated navigation/scroll behavior. Captured page errors are checked in the catalogue flow, not exhaustively across the site.

## Automated test results

| Check | Result | Limits |
| --- | --- | --- |
| `e2e/functionality-audit.spec.ts` | 12 passed | Chromium with synthetic API responses except the two navigation tests noted above. |
| `e2e/inner-page-spacing.spec.ts` | 8 passed | Chromium at 375px and 1440px; checks gutters and homepage styling isolation, not backend functionality. Optional backend requests logged connection refusals. |
| `tests/integration/commerce-api.test.ts` | 21 passed | Real Node route/service code with PGlite test DB, including authentication, cross-customer ownership, product-specific slugs, published pricing, tamper resistance and checkout. Not a deployed backend or payment gateway. |
| `tests/integration/admin-customers-api.test.ts` | 11 passed | PGlite: customer/admin/super-admin authorization, forged claims, account status and ownership for this customer-management API. Not every admin endpoint. |
| `tests/integration/payment-authorization-matrix.test.ts` | 2 passed | PGlite financial authorization matrix; no live financial transactions. |
| Frontend unit suite: contextual navigation, marketing pages, homepage, RequireAuth, admin RBAC | 361 passed | Unit/React tests, not evidence every rendered action works. |
| `npm run typecheck`, `npm run build:frontend`, `git diff --check` | Passed | Compilation/build and whitespace only. |
| `node scripts/site/check-links.mjs` | Passed: 2,224 source surfaces, 975 internal, 1,019 PHP, 19 anchors; 5 external-link notes | Static resolution only; 722 vendor/dev hrefs excluded. External URLs, runtime behavior and semantic destination correctness are not verified. |
| `python3 scripts/verify-website.py` | Source checks passed | Its WHMCS HTTP check explicitly reports **not run; WHMCS staging required**. |

Frontend unit tests produce existing React server-render warnings. Browser fixtures do not confirm payment capture, fulfilment, provider availability or email delivery.

## Inventory and reproducibility

[`interactive-elements.jsonl`](interactive-elements.jsonl) contains **2,160 static source declarations**, each explicitly marked `verification: not established by source inventory`. It records source file/line or JSON pointer, tag, label where statically recoverable, destination/action expressions, and disabled/type attributes. It covers React TSX, `templates/cloudhost247` Smarty templates, root and non-admin tools PHP, and shared site registry/content JSON. One declaration may render many items; conditional, dynamic and generated controls, custom components without recognized props, external/vendor modules, runtime CMS content, and WHMCS-generated controls may be absent. PHP/Smarty extraction is approximate and may include false positives. This is **not a complete inventory of live instances and not an audited-controls checklist**.

Regenerate from the installed Node project:

```sh
cd cloudhost247-node
node scripts/audit-interactions.cjs > ../docs/functionality-audit/interactive-elements.jsonl
npm run build:frontend
CH247_AUDIT_EVIDENCE_DIR=../docs/functionality-audit/screenshots npx playwright test e2e/functionality-audit.spec.ts --workers=1
npx vitest run tests/integration/commerce-api.test.ts tests/integration/admin-customers-api.test.ts tests/integration/payment-authorization-matrix.test.ts --maxWorkers=1
```

Install Playwright Chromium normally (`npx playwright install chromium`); `CH247_CHROMIUM_PATH` can point at an existing binary. Screenshot files are fixture evidence:

- [Selected plan in cart](screenshots/catalog-cart-fixture.png)
- [Fixture order and invoice link](screenshots/order-fixture.png)
- [Selected expert offering](screenshots/expert-request-fixture.png)
- [Fixture support conversation](screenshots/support-conversation-fixture.png)
- [Mobile navigation](screenshots/mobile-navigation.png)

## Known gaps and next actions

- A web contact form is explicitly unavailable; the contact page offers department email instead. Outbound contact-form/SMTP delivery is not implemented by that page. No claim is made about the completeness of all other endpoints.
- Registrar, monitoring, email transport, payment providers, domain provisioning, server provisioning, live chat handoff and other deployment-specific integrations depend on configuration and were not exercised against providers. Verify their actual configured/unconfigured and error states in staging.
- Review every rendered inventory entry on real customer and admin accounts, including modals, footer, all dynamic rows, keyboard access, responsive layouts, destructive confirmations and negative authorization cases. Check the remaining ghost-button uses on their actual backgrounds. The inventory and passing tests do not establish these.
- Run real staging registration/auth recovery, checkout, payments/webhooks/refunds, account ownership and provisioning with safe test data; verify no unauthorized side effects, price tampering or fabricated success. Include concurrent requests and refresh/back navigation.
- Run WHMCS/PHP staging HTTP and authenticated workflows, including purchased/legacy theme and module surfaces excluded from the static scan. Test the five external legal links independently from a network that can reach them.
- Re-run cross-browser and additional mobile breakpoints, automated accessibility/contrast tests, and page-error checks on every route. Verify all fragments, back/forward scroll restoration and published-site links with a real publication snapshot.
