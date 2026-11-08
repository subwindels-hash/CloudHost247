/**
 * The cross-stack service register (`config/whmcs/service-register.csv`), parsed once and typed.
 *
 * The register is the list of services *the website advertises* — it is shared with the PHP/WHMCS
 * side, so it is the only honest inventory to review the catalogue against. Everything that needs
 * "every advertised service" (the completeness gate, the mapping review) reads it through here
 * rather than re-parsing CSV in three places.
 *
 * Parsing notes:
 *   - RFC 4180 quoting, including doubled quotes and embedded commas — several rows carry prose with
 *     commas and quoted `"Choose <cycle>"` fragments.
 *   - `\r\n` and `\n` both work.
 *   - Blank lines and wholly empty cells are tolerated; a row with no `service_key` is skipped rather
 *     than becoming a phantom service.
 */

import { readFileSync } from 'node:fs';

export interface ServiceRegisterEntry {
  serviceKey: string;
  service: string;
  category: string;
  /** SPA route a customer reaches this service on (`/hosting/vps`), when it has one. */
  spaRoute: string;
  /** PHP template/page on the WHMCS side, when it has one. */
  phpPage: string;
  advertised: boolean;
  catalogueSlug: string;
  /** Where the page's prices come from today. Used as evidence, never as a price source. */
  priceSource: string;
  orderPath: string;
  /** Bound in the register by a human, not by this codebase. Evidence only — bindings live in the map. */
  registerProductGroupId: string;
  registerProductId: string;
  registerProvisioningModule: string;
  status: string;
  evidence: string;
}

/** RFC 4180 reader. Returns one record per row, keyed by the header row. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((key) => key.trim());
  return body
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => {
      const record: Record<string, string> = {};
      keys.forEach((key, index) => {
        record[key] = (cells[index] ?? '').trim();
      });
      return record;
    });
}

function yes(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === 'yes' || normalized === 'true' || normalized === '1';
}

/** Parses the register text into typed entries, skipping rows without a service key. */
export function parseServiceRegister(text: string): ServiceRegisterEntry[] {
  return parseCsv(text)
    .filter((row) => (row.service_key ?? '') !== '')
    .map((row) => ({
      serviceKey: row.service_key!,
      service: row.service ?? row.service_key!,
      category: row.category ?? '',
      spaRoute: row.spa_route ?? '',
      phpPage: row.php_page ?? '',
      advertised: yes(row.advertised),
      catalogueSlug: row.catalogue_slug ?? '',
      priceSource: row.price_source ?? '',
      orderPath: row.order_path ?? '',
      registerProductGroupId: row.product_group_id ?? '',
      registerProductId: row.product_id ?? '',
      registerProvisioningModule: row.provisioning_module ?? '',
      status: row.status ?? '',
      evidence: row.evidence ?? '',
    }));
}

export function readServiceRegister(filePath: string): ServiceRegisterEntry[] {
  return parseServiceRegister(readFileSync(filePath, 'utf8'));
}
