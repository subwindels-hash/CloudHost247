# CloudHost247 — ePassport MRZ Calculator, Validator & Parser

See the canonical documentation in [`../../docs/MRZ_DEVELOPER_TOOL.md`](../../docs/MRZ_DEVELOPER_TOOL.md).

## Quick Reference

- **UI Routes**:
  - `/tools` — Developer & Document Tools Hub
  - `/tools/document/mrz` — TD3 ePassport MRZ Calculator & Validator
  - `/tools/document/mrz-parser` — TD3 ePassport MRZ Parser
  - `/admin/settings/tools/mrz` — Super Admin → Settings → Tools → MRZ
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
