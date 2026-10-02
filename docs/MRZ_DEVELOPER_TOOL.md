# CloudHost247 — ePassport MRZ Calculator, Validator & Parser

## 1. Overview & Intended Use

The **CloudHost247 ePassport Machine Readable Zone (MRZ) Developer Tool** provides a native, privacy-first utility for:

- Software engineering and parser unit testing
- Document-format validation against **ICAO Doc 9303**
- Optical Character Recognition (OCR) pipeline calibration
- Integration testing with synthetic travel-document test specimens

### Scope & Safety Boundary

- This utility generates, validates, and parses **machine-readable text strings** only.
- It does **not** generate passport artwork, government seals, holographic overlays, or physical identity documents.
- It does **not** verify whether a physical or electronic passport is genuine, government-issued, or cryptographically signed (ICAO PKD / Passive Authentication / BAC / PACE).
- It must **never** be used to impersonate a person, alter an authentic document, or bypass identity verification / KYC systems.

---

## 2. Tool Locations & Navigation

| Surface | Route / Navigation Path | Description |
| --- | --- | --- |
| **Tools Directory** | `/tools` (`Tools → Developer / Document Tools`) | Entry point listing the MRZ Calculator & Validator and MRZ Parser |
| **MRZ Calculator & Validator** | `/tools/document/mrz` (`Tools → Developer / Document Tools → MRZ Calculator`) | Interactive TD3 MRZ generator, character normalization inspector, check-digit calculator, and structural validator |
| **MRZ Parser** | `/tools/document/mrz-parser` (`Tools → Developer / Document Tools → MRZ Parser`) | Structured TD3 MRZ field parser and check-digit verifier |
| **Super Admin Settings** | `/admin/settings/tools/mrz` (`Super Admin → Settings → Tools → MRZ`) | Runtime feature toggles, rate limits, operational log levels, and availability controls |

---

## 3. Supported Document Format: TD3 (ICAO Doc 9303 Part 4)

The tool implements the **TD3 (Machine Readable Passport)** specification defined in:

- **ICAO Doc 9303, Part 3**: *Specifications Common to all Machine Readable Travel Documents* (Eighth Edition) — Character set, transliteration of Latin diacritics, and modulo-10 check-digit algorithm.
- **ICAO Doc 9303, Part 4**: *Specifications for Machine Readable Passports (MRPs) and other TD3 Size MRTDs* — Two-line × 44-character (88 characters total) data layout.

### Line 1 Layout (Positions 1–44)

| Positions | Length | Field | Rules |
| --- | --- | --- | --- |
| `1–2` | 2 | **Document Type** | Begins with `P`; second character is `<` or an issuing-state sub-type letter `A–Z` (e.g., `P<`, `PO`, `PD`, `PS`, `PM`). |
| `3–5` | 3 | **Issuing State** | 3-letter uppercase ICAO country/organization code (`A–Z`, e.g., `UTO`, `USA`, `GBR`, or `D<<` for Germany). |
| `6–44` | 39 | **Name (Primary & Secondary Identifiers)** | `<SURNAME><<` followed by `<GIVEN<NAMES>`, padded on the right with `<` up to 39 characters. |

### Line 2 Layout (Positions 1–44)

| Positions | Length | Field | Rules |
| --- | --- | --- | --- |
| `1–9` | 9 | **Document Number** | 1–9 uppercase alphanumeric characters (`A–Z`, `0–9`), right-padded with `<`. |
| `10` | 1 | **Document Number Check Digit** | `0–9` check digit computed over positions `1–9`. |
| `11–13` | 3 | **Nationality** | 3-letter uppercase ICAO country/organization code (`A–Z` or `D<<`). |
| `14–19` | 6 | **Date of Birth** | `YYMMDD` numeric calendar date. |
| `20` | 1 | **Date of Birth Check Digit** | `0–9` check digit computed over positions `14–19`. |
| `21` | 1 | **Sex** | `M` (Male), `F` (Female), or `<` (Unspecified). |
| `22–27` | 6 | **Expiry Date** | `YYMMDD` numeric calendar date. |
| `28` | 1 | **Expiry Date Check Digit** | `0–9` check digit computed over positions `22–27`. |
| `29–42` | 14 | **Optional Data** | 0–14 characters (`A–Z`, `0–9`, `<`), right-padded with `<` to 14 characters. |
| `43` | 1 | **Optional Data Check Digit** | `0–9` (or `<` when positions `29–42` are all `<`) computed over positions `29–42`. |
| `44` | 1 | **Composite Check Digit** | `0–9` check digit computed across Line 2 positions `1–10`, `14–20`, and `22–43` (39 characters total). |

---

## 4. Character Normalization & Transliteration

Per **ICAO Doc 9303 Part 3 Section 6**, the MRZ permits only uppercase ASCII letters (`A–Z`), digits (`0–9`), and the filler character (`<`).

The engine transforms names through a deterministic pipeline:

```text
Normal name
  ↓
Transliterated ASCII representation (ICAO Doc 9303 Table A)
  ↓
MRZ-compatible representation (component separator < and << between surname and given names)
  ↓
Fixed-width 39-character field with trailing < fillers
```

### Key Transliteration Mappings

- `Ä`, `Æ` → `AE`
- `Ö`, `Œ`, `Ø` → `OE`
- `Ü` → `UE`
- `ß`, `ẞ` → `SS`
- `Å` → `AA`
- `Þ` → `TH`
- `Ĳ` → `IJ`
- Accented Latin characters (`Á`, `À`, `Â`, `Ã`, `Ç`, `Č`, `Ď`, `Đ`, `É`, `È`, `Ê`, `Ë`, `Ł`, `Ñ`, `Ń`, `Ó`, `Ò`, `Ô`, `Ř`, `Ś`, `Š`, `Ť`, `Ú`, `Ù`, `Û`, `Ý`, `Ź`, `Ż`, `Ž`, etc.) → corresponding base ASCII letter `A–Z`.
- Spaces and hyphens (`-`) → single `<` component separator.
- Apostrophes (`'`, `’`) → omitted within name tokens (`O'CONNOR` → `OCONNOR`).

### Fail-Closed Validation

- Unsupported characters (digits in names, punctuation like `@`, `$`, `<`, `>`, HTML/script tags, or non-Latin alphabets not covered by ICAO Latin transliteration) are **never silently stripped**. They produce an explicit validation error.
- Combined normalized names (`SURNAME<<GIVEN<NAMES`) exceeding 39 characters are rejected with `NAME_FIELD_OVERFLOW` rather than silently producing an unexpected truncation.

---

## 5. Check-Digit Algorithm

Check digits follow **ICAO Doc 9303 Part 3 Section 4.9**:

1. **Character Value Mapping**:
   - `<` → `0`
   - `0`–`9` → `0`–`9`
   - `A`–`Z` → `10`–`35` (`A = 10`, `B = 11`, …, `Z = 35`)
2. **Weighting Sequence**:
   - Multiply each character value by the repeating weights `7, 3, 1` (`weight = [7, 3, 1][index % 3]`).
3. **Modulo 10**:
   - Sum all weighted products and take `sum % 10`.

---

## 6. Parser & Validator Behavior

### Validator (`/tools/document/mrz` & `POST /api/tools/mrz/validate`)

Evaluates:
- Number of lines (must be 2 lines)
- Line length (44 characters per line)
- Character set validity (`A–Z`, `0–9`, `<` and field-specific character restrictions)
- Document type (`P<` or `P[A–Z]`)
- Issuing state and nationality format (`[A–Z]{3}` or `D<<`)
- Calendar date validity for Date of Birth and Expiry Date (`YYMMDD`, including leap-year February validation)
- All 5 check digits (Document number, Date of birth, Expiry date, Optional data, Composite)
- Structural validity (`<<` separator between primary and secondary identifiers)

### Parser (`/tools/document/mrz-parser` & `POST /api/tools/mrz/parse`)

Extracts structured fields and **explicitly distinguishes** between:
- **`parsedStatus: "Successfully parsed"`** — The two-line TD3 string was decomposed into fields.
- **`structureValid: true | false`** — Whether all ICAO Doc 9303 format and check-digit rules passed.
- **`authenticityVerified: false`** — Always `false`. Mathematical MRZ validation never verifies physical or cryptographic passport authenticity.

---

## 7. Privacy & Stateless Architecture

By default, the CloudHost247 MRZ tool is **stateless and privacy-first**:

- **Client-side execution first**: Calculation, validation, parsing, synthetic test generation, and AI explanations execute directly in the browser without requiring external third-party APIs.
- **Zero PII persistence**: Submitted MRZ lines, passport numbers, dates of birth, expiry dates, nationalities, surnames, given names, and optional data are **never** stored in the database or browser storage (`localStorage` / `sessionStorage`).
- **Response minimization**: `POST /api/tools/mrz/generate` returns only the generated MRZ lines, check digits, and validation flags without echoing personal input fields.
- **No-store headers**: All `/api/tools/mrz/*` responses set `Cache-Control: no-store, no-cache, must-revalidate, private` and `X-Robots-Tag: noindex, nofollow`.
- **Log redaction**: `src/lib/logger.ts` and `redactMrzSensitiveData()` redact MRZ and identity fields across application logs.
- **Operational audit records**: When an administrator sets `tools.mrz.logging_level` to `errors_only` or `minimal_operational`, `audit_logs` records **only**:
  - `tool`
  - `actor_id` (user/account ID if authenticated)
  - `timestamp`
  - `operation` (`generate`, `validate`, `parse`, `test_data`, `explain`)
  - `success` (`true` / `false`)
  - `errorCategory`

---

## 8. Security Controls

- **Strict input validation**: Zod schema validation with `.strict()` mode and field length ceilings.
- **Request-size limit**: `4096` bytes (`4 KB`) maximum body size on all `/api/tools/mrz/*` endpoints (`413 PAYLOAD_TOO_LARGE`).
- **XSS & injection defense**: Rejects HTML/script tags, event handlers, `javascript:` URIs, and control characters before processing; React escapes all rendered output; Content-Security-Policy is enforced via `@fastify/helmet`.
- **Rate limiting**: Dynamic per-IP sliding window limiter enforcing `tools.mrz.rate_limit_per_minute` (default `60` requests/minute, configurable `1–600`).
- **RBAC & Availability**: Enforces `tools.mrz.availability` (`public`, `authenticated`, or `admin_only`) on every API call.

---

## 9. API Endpoints

All endpoints are available under `/api/tools/mrz/*` (and aliased under `/api/v1/tools/mrz/*`):

### `POST /api/tools/mrz/generate`

Request:
```json
{
  "documentType": "P<",
  "issuingState": "UTO",
  "surname": "ERIKSSON",
  "givenNames": "ANNA MARIA",
  "nationality": "UTO",
  "dateOfBirth": "740812",
  "sex": "Female",
  "documentNumber": "L898902C3",
  "expiryDate": "120415",
  "optionalData": "ZE184226B"
}
```

Response (`200 OK`):
```json
{
  "success": true,
  "documentType": "TD3",
  "mrz": {
    "line1": "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
    "line2": "L898902C36UTO7408122F1204159ZE184226B<<<<<10"
  },
  "validation": {
    "structure": true,
    "checkDigits": true
  },
  "checkDigits": {
    "documentNumber": "6",
    "dateOfBirth": "2",
    "expiryDate": "9",
    "optionalData": "1",
    "composite": "0"
  },
  "authenticityNotice": "Mathematical and structural MRZ validation only confirms ICAO Doc 9303 formatting and check digits for software testing. It does NOT verify that a physical or electronic passport is genuine or government-issued."
}
```

### `POST /api/tools/mrz/validate`

Validates `{ "mrz": "LINE1\nLINE2" }` or `{ "line1": "...", "line2": "..." }` and returns `valid`, `status` (`VALID` | `INVALID`), `summary`, `reasons`, `checks`, and `checkDigitDetails`.

### `POST /api/tools/mrz/parse`

Parses `{ "mrz": "LINE1\nLINE2" }` into structured fields alongside `parsedStatus: "Successfully parsed"` and `authenticityVerified: false`.

### `POST /api/tools/mrz/test-data`

Returns a clearly labeled synthetic test specimen using ICAO reserved test codes (`UTO`, `XXA`).

### `POST /api/tools/mrz/explain`

Returns a deterministic CloudHost247 AI explanation of the MRZ fields, check-digit arithmetic, or input validation errors.

---

## 10. Super Admin Settings (`Super Admin → Settings → Tools → MRZ`)

Accessible at `/admin/settings/tools/mrz` and via `GET / PUT /api/v1/admin/tools/mrz/settings`:

- `calculatorEnabled` (`boolean`, default `true`)
- `parserEnabled` (`boolean`, default `true`)
- `testDataEnabled` (`boolean`, default `true`)
- `rateLimitPerMinute` (`1–600`, default `60`)
- `loggingLevel` (`none` | `errors_only` | `minimal_operational`, default `none`)
- `availability` (`public` | `authenticated` | `admin_only`, default `public`)

Privacy protections (`privacyProtectionLocked: true`, `persistSubmittedData: false`, `logSensitiveMrzData: false`) are permanently locked on; any request attempting to disable privacy protections is rejected with `400 VALIDATION_ERROR`.

---

## 11. Automated Test Coverage

- `cloudhost247-node/tests/unit/mrz-engine.test.ts`: Check-digit weights (`7, 3, 1`), ICAO Doc 9303 Part 4 reference vectors, valid/invalid MRZ detection, Latin diacritic transliteration, overflow/special-character rejection, parser non-authenticity guarantees, synthetic test data, AI explanation, and log redaction.
- `cloudhost247-node/tests/integration/mrz-tools-api.test.ts`: End-to-end API testing (`generate`, `validate`, `parse`, `test-data`, `explain`), XSS/oversized/malformed payload rejection, dynamic rate limiting (`429`), RBAC/availability enforcement, Super Admin privacy lock, and database audit redaction verification.
- `cloudhost247-node/frontend/tests/unit/mrz-tools-pages.test.tsx`: React UI tests for `/tools/document/mrz`, `/tools/document/mrz-parser`, and `/admin/settings/tools/mrz`.
