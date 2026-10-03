/**
 * Tools Center — MAC address lookup and generation (spec §27, §28).
 *
 * Lookup uses the IEEE's public OUI registry (the authoritative source) fetched through the
 * operator-configurable provider registry and cached in-process. There is deliberately NO bundled
 * hard-coded vendor table: a stale or invented prefix→vendor mapping would be exactly the kind of
 * fabricated result this platform must not produce. When the registry cannot be reached, the lookup
 * reports UNKNOWN with the reason, while still reporting the bits that are knowable locally
 * (unicast/multicast, globally/locally administered).
 */
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Queryable } from '../../db/types';
import { invalidInput } from '../core/errors';
import { fetchWithGuard } from '../core/ssrf';
import { usableProviders } from '../core/providers';

export interface MacParseResult {
  input: string;
  normalized: string;
  octets: string[];
  oui: string;
  format: 'colon' | 'hyphen' | 'dot' | 'plain';
  isMulticast: boolean;
  isLocallyAdministered: boolean;
  isBroadcast: boolean;
}

const MAC_PATTERNS: Array<{ regex: RegExp; format: MacParseResult['format'] }> = [
  { regex: /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i, format: 'colon' },
  { regex: /^([0-9a-f]{2}-){5}[0-9a-f]{2}$/i, format: 'hyphen' },
  { regex: /^([0-9a-f]{4}\.){2}[0-9a-f]{4}$/i, format: 'dot' },
  { regex: /^[0-9a-f]{12}$/i, format: 'plain' },
];

export function parseMac(input: string): MacParseResult {
  const trimmed = input.trim();
  const pattern = MAC_PATTERNS.find((candidate) => candidate.regex.test(trimmed));
  if (!pattern) {
    throw invalidInput(
      'Enter a MAC address as 6 hex octets, for example AA:BB:CC:DD:EE:FF, AA-BB-CC-DD-EE-FF, AABB.CCDD.EEFF or AABBCCDDEEFF.'
    );
  }
  const hex = trimmed.replace(/[:.-]/g, '').toLowerCase();
  const octets = hex.match(/.{2}/g) ?? [];
  const first = Number.parseInt(octets[0] ?? '00', 16);
  return {
    input: trimmed,
    normalized: octets.join(':').toUpperCase(),
    octets,
    oui: octets.slice(0, 3).join('').toUpperCase(),
    format: pattern.format,
    isMulticast: (first & 0x01) === 1,
    isLocallyAdministered: (first & 0x02) === 2,
    isBroadcast: hex === 'ffffffffffff',
  };
}

interface OuiEntry {
  registry: string;
  assignment: string;
  organization: string;
  address: string;
}

interface OuiTable {
  entries: Map<string, OuiEntry>;
  loadedAt: number;
  source: string;
  rowCount: number;
}

const OUI_TTL_MS = 24 * 60 * 60 * 1000;
let cachedTable: OuiTable | null = null;

function parseOuiCsv(csv: string): Map<string, OuiEntry> {
  const entries = new Map<string, OuiEntry>();
  const lines = csv.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || /^Registry,/i.test(trimmed)) continue;
    // IEEE CSV columns: Registry,Assignment,Organization Name,Organization Address
    const parts = splitCsvLine(trimmed);
    const assignment = parts[1];
    const organization = parts[2];
    if (!assignment || !organization) continue;
    const prefix = assignment.replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (prefix.length !== 6) continue;
    entries.set(prefix, {
      registry: parts[0] ?? '',
      assignment,
      organization,
      address: (parts[3] ?? '').replace(/\s+/g, ' ').trim(),
    });
  }
  return entries;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (character === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  fields.push(current);
  return fields;
}

export interface MacLookupResult {
  mac: MacParseResult;
  vendor: { found: boolean; organization: string | null; registry: string | null; address: string | null };
  ouiSource: { provider: string | null; endpoint: string | null; rows: number | null; loadedAt: string | null; detail: string };
  bits: { multicast: boolean; locallyAdministered: boolean; broadcast: boolean; explanation: string[] };
  status: 'FOUND' | 'UNKNOWN' | 'SERVICE_UNAVAILABLE';
  durationMs: number;
}

async function loadOuiTable(db: Queryable, force = false): Promise<{ table: OuiTable | null; detail: string }> {
  if (cachedTable && !force && Date.now() - cachedTable.loadedAt < OUI_TTL_MS) {
    return { table: cachedTable, detail: `Loaded ${cachedTable.rowCount} OUI prefixes from ${cachedTable.source}.` };
  }
  const ouiProviders = await usableProviders(db, 'OTHER');
  const candidates = [...ouiProviders, ...(await usableProviders(db, 'WHOIS'))];
  const preferred = candidates.find((provider) => provider.configuration.format === 'ieee-csv') ?? candidates.find((provider) => Boolean(provider.endpoint));
  if (!preferred?.endpoint) {
    return {
      table: null,
      detail:
        'No OUI data source is configured or reachable. A Super Admin can enable the IEEE OUI provider under Admin → Tools → Providers (kind: OTHER, format: ieee-csv).',
    };
  }

  try {
    const response = await fetchWithGuard(preferred.endpoint, {
      timeoutMs: Math.max(preferred.timeoutMs, 8000),
      maxBytes: 8 * 1024 * 1024,
      userAgent: 'CloudHost247-ToolsCenter/1.0 (IEEE OUI registry lookup)',
    });
    if (response.status !== 200) {
      return { table: null, detail: `The OUI source (${preferred.name}) answered HTTP ${response.status}.` };
    }
    const entries = parseOuiCsv(response.bodyText);
    if (entries.size === 0) {
      return { table: null, detail: `The OUI source (${preferred.name}) returned no parseable rows.` };
    }
    cachedTable = { entries, loadedAt: Date.now(), source: preferred.name, rowCount: entries.size };
    return { table: cachedTable, detail: `Loaded ${entries.size} OUI prefixes from ${preferred.name}.` };
  } catch (error) {
    return { table: null, detail: `The OUI source could not be reached: ${error instanceof Error ? error.message : 'unknown error'}` };
  }
}

export async function macLookup(db: Queryable, input: { mac: string }): Promise<MacLookupResult> {
  const startedAt = performance.now();
  const mac = parseMac(input.mac);
  const { table, detail } = await loadOuiTable(db);

  const entry = table?.entries.get(mac.oui) ?? null;
  const explanations: string[] = [];
  explanations.push(
    mac.isMulticast
      ? 'The least-significant bit of the first octet is 1, so this is a multicast (group) address rather than an individual interface.'
      : 'The least-significant bit of the first octet is 0, so this is a unicast address for one interface.'
  );
  explanations.push(
    mac.isLocallyAdministered
      ? 'The second-least-significant bit of the first octet is 1, so the address is locally administered — it was assigned by software, not by the manufacturer. Its OUI prefix does not reliably identify a vendor.'
      : 'The second-least-significant bit of the first octet is 0, so the address is globally administered and its OUI prefix is assigned by the IEEE registry.'
  );
  if (mac.isBroadcast) explanations.push('FF:FF:FF:FF:FF:FF is the broadcast address and has no vendor.');

  const found = entry !== null;
  return {
    mac,
    vendor: {
      found,
      organization: entry?.organization ?? null,
      registry: entry?.registry ?? null,
      address: entry?.address && entry.address.length > 0 ? entry.address : null,
    },
    ouiSource: {
      provider: table ? table.source : null,
      endpoint: null,
      rows: table?.rowCount ?? null,
      loadedAt: table ? new Date(table.loadedAt).toISOString() : null,
      detail,
    },
    bits: { multicast: mac.isMulticast, locallyAdministered: mac.isLocallyAdministered, broadcast: mac.isBroadcast, explanation: explanations },
    status: found ? 'FOUND' : table ? 'UNKNOWN' : 'SERVICE_UNAVAILABLE',
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export type MacGenerationMode = 'random' | 'locally-administered' | 'universally-administered';

export interface MacGenerationResult {
  macs: string[];
  mode: MacGenerationMode;
  explanation: string;
  notes: string[];
}

/** Section §28 — generates valid MAC addresses with the correct U/L and I/G bits. */
export function generateMac(input: { count?: number; mode?: MacGenerationMode }): MacGenerationResult {
  const count = Math.min(Math.max(input.count ?? 5, 1), 50);
  const mode = input.mode ?? 'random';
  const macs: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const bytes = randomBytes(6);
    // Always produce a unicast address; a multicast MAC is almost never what a user wants.
    bytes[0] = (bytes[0] ?? 0) & 0xfe;
    if (mode !== 'universally-administered') {
      // Locally administered: set bit 1. "random" uses a locally administered address too, because a
      // random global address could collide with a real vendor's assignment.
      bytes[0] = (bytes[0] ?? 0) | 0x02;
    } else {
      bytes[0] = (bytes[0] ?? 0) & 0xfd;
    }
    macs.push(Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(':'));
  }

  return {
    macs,
    mode,
    explanation:
      mode === 'universally-administered'
        ? 'Globally administered addresses are normally assigned by the hardware vendor from an IEEE-registered OUI block. A randomly generated one will use an unassigned prefix that could later be allocated to a vendor.'
        : mode === 'locally-administered'
          ? 'Locally administered addresses (second-least-significant bit set) are reserved for use by software on your own network; they never collide with a vendor-assigned address.'
          : 'Random mode generates unicast, locally administered addresses, which are safe to use on a private network because they cannot collide with a real vendor assignment.',
    notes: [
      'Every generated address is unicast (the multicast bit is cleared) unless you deliberately build a group address.',
      'These addresses are generated with the platform\'s cryptographic random source.',
    ],
  };
}

/** Test hook: clears the in-process OUI cache. */
export function resetOuiCache(): void {
  cachedTable = null;
}
