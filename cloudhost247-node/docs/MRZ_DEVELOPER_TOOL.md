# CloudHost247 — ePassport MRZ Calculator, Validator & Parser

See the canonical documentation in [`../../docs/MRZ_DEVELOPER_TOOL.md`](../../docs/MRZ_DEVELOPER_TOOL.md).

## Quick Reference

- **UI Routes**:
  - `/tools/mrz-generator` — canonical public route (catalogue slug `mrz-generator`), linked from the Tools mega menu, the Tools directory/Developer category, site search, the footer Tools column and `tools-sitemap.php`
  - `/tools` — Tools Center; `/tools/document` — Developer & Document Tools hub
  - `/tools/document/mrz` — retained URL: TD3 ePassport MRZ Calculator & Validator
  - `/tools/document/mrz-parser` — retained URL: TD3 ePassport MRZ Parser
  - `/tools/mrz-parser` — retained URL alias for the parser tab
  - `/admin/settings/tools/mrz` — Super Admin → Settings → Tools → MRZ
- **Tools Center API**: `POST /api/tools/mrz-generator` (mode `generate` | `validate` | `parse`) runs the same engine through the standard executor: no cache, no history target, and reports/tickets are refused for this slug.
- **Privacy**: the shipped forms (PHP catalogue, theme resources, React bundle) carry shape-only placeholders (`AB1234567`, `YYMMDD`, `SURNAME`); the ICAO specimen is generated in the visitor's browser. Canonical doc §7 records the rule and the two suites that pin it.
- **API Endpoints**:
  - `GET /api/tools/mrz/config`
  - `POST /api/tools/mrz/generate`
  - `POST /api/tools/mrz/validate`
  - `POST /api/tools/mrz/parse`
  - `POST /api/tools/mrz/test-data`
  - `POST /api/tools/mrz/explain`
  - `GET /api/v1/admin/tools/mrz/settings`
  - `PUT /api/v1/admin/tools/mrz/settings`
- **Engine Source**:
  - `src/tools/mrz/mrz-engine.ts`
  - `frontend/src/lib/mrz-engine.ts`
  - `src/routes/mrz-tools.ts`
