# Website-wide translation audit

Status: **incomplete**. Selecting a language does not currently translate every page.
The selector stores the chosen locale in browser storage; it updates document `lang` and `dir`
(including RTL for Arabic), and translated React components update without reloading. Header,
primary navigation, the homepage hero and some pricing labels use the chosen locale. Currency
estimates and the homepage price use locale-aware formatting. The available message catalogues
are not evidence of complete page translation, and translations require professional review.

## Coverage and reporting

Run `node scripts/audit-localization.cjs` to inventory probable hard-coded JSX copy,
`--details` for locations, and `--check` to fail while findings exist. On this audit the
script reported 3,969 potential literals across 168 files. This is a heuristic, not an exact
count: it misses content defined in constants, generated registries, APIs, database records,
notifications, backend pages, emails, attributes beyond those it scans, and can flag technical
or brand text. Do not use it as a 100% coverage certificate.

The existing translator records missing registered catalogue keys when a component actually
requests them; `getMissingTranslationKeys()` and `clearMissingTranslationKeys()` in
`frontend/src/i18n/catalogue.ts` expose a per-page-session report for diagnostics. It records
only known key names and locale codes, not interpolation values, translated strings, API data,
or customer content. It does not scan untranslated JSX, custom `site-text` dictionaries,
server-rendered text, or unvisited pages. English fallback remains visible on missing keys, so
this mechanism reports mixed-language risks but does not prevent them.

## Gaps and requirements

* Extract and translate all application-owned copy, navigation entries, errors, accessibility
  labels, checkout, dashboards, notifications, emails, legal pages and backend templates into
  versioned catalogues. Review every locale and protect placeholders, identifiers and brands.
* Model localized product, blog, FAQ and other database records, including locale-aware API
  responses, publication status, source revisions, fallback and coverage reports. Existing APIs
  return original text and do not provide those fields. Customer/vendor-generated content needs
  an explicit translation and privacy policy; a static catalogue cannot translate future content.
* Migrate date, number and currency presentation across all pages without changing underlying
  financial values, historical invoices or technical identifiers. Add locale-aware accessible
  error messages, server-side locale selection and cross-device preferences where required.
* Test real routes, API-loaded records, checkout, authenticated dashboards and mobile navigation
  in every supported language, including RTL and switching back to the source language. Current
  unit tests cover only the existing catalogues and selected components; they do not establish
  website-wide coverage or translation quality.

The selected approach is built-in translations. No visitor, vendor, or database content is sent
to a translation service by this implementation. Comprehensive automatic translation of newly
created content is not possible with the current static dictionaries alone; it requires a
separate translation workflow or an explicitly approved machine-translation integration.
