# Product catalogue translations (partial rollout)

This phase supports **product names and descriptions** on the public Node catalogue APIs and
catalogue-driven React pages. It does not translate plan names/descriptions/features, product data
in cart or checkout, category names, blogs, notifications, legal text, dashboards, emails, WHMCS
pages or other dynamic content. No translations are seeded and no automatic translator is used.
All 12 non-English languages (`fr`, `de`, `es`, `pt`, `it`, `nl`, `pl`, `ru`, `ar`, `zh`, `ja`,
`ko`) require human-authored product translations; English is the current original source.
Regional variants are not stored separately. The wider site remains incomplete and may contain
mixed languages. See `website-translation-audit.md` for broader limitations.

## Deployment

Apply migration `0084_catalog_product_translations.sql` with the existing controlled migration
procedure before deploying the API. Catalogue requests in non-English languages need the new
translation table. Translation data stays in the application database; no text is sent to an
external provider. Migration creates an independent table and never changes existing product,
pricing, order or invoice data.

## Editor workflow (API)

The existing catalogue `super_admin` authorization applies to these endpoints. They are currently
API-only; there is no editor UI or automated translation. Keep brand names, identifiers and
technical terms intact, and have translations professionally reviewed before publication.

1. Read `GET /api/v1/admin/catalog/products/:id` to obtain the current product name and
   description; `GET /api/v1/admin/catalog/products/:id/translations` lists saved translations,
   their draft/published status and whether the source has changed. An absent locale is missing.
2. Submit `PUT /api/v1/admin/catalog/products/:id/translations/:locale` with JSON:
   `{"name":"...","description":"...","status":"draft","sourceName":"...","sourceDescription":"..."}`.
   Use actual reviewed content, not placeholders. `sourceName` and `sourceDescription` must
   exactly match the values read in step 1; use JSON null for a null description.
3. Review and resubmit with `status: "published"`. If the source has a description, a non-empty
   translated description is required. If the original changed since it was read, the write is
   rejected; reload and re-review. An existing published translation becomes stale and is no
   longer used whenever the original name or description changes. Republish only after review.
4. New products have no translations by default. Repeat this process for every supported locale.

Public endpoints `/api/v1/catalog`, `/api/v1/catalog/products`,
`/api/v1/catalog/products/:slug`, and `/api/v1/catalog/products/:slug/plans` accept a `lang`
query parameter. The catalogue React hook sends the active language and refetches on change.
Only published, complete, source-current product translations are applied. Missing, draft or
stale translations fall back to the original product copy; this is intentional and can create
mixed-language pages until content is translated. Slugs, prices, orderability, plan data and
visibility rules remain authoritative and unchanged. Locale query parameters separate cache keys;
clients that omit `lang` receive original English content. Unsupported locale codes return 400.
