import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  DB_UUID_PATTERN,
  catalogIdSchema,
  dbUuidSchema,
  isCanonicalDbUuid,
  requireDbUuid,
} from '../../src/lib/identifier-contract';

/**
 * P0 regression (2026-11-07). The VPS ordering endpoint rejected EVERY seeded OS image because
 * zod 4 `z.uuid()` requires an RFC 4122 version/variant nibble while the deterministic catalogue
 * ids seeded by the migrations use version 0 — still perfectly valid PostgreSQL `uuid` values.
 *
 * These tests pin the chosen contract: strict canonical UUID *shape*, version-agnostic, lowercase
 * normalised. They also prove we did NOT "fix" the defect by relaxing validation to `z.string()`.
 */

const SEEDED_IDS = [
  '10000000-0000-0000-0000-000000000001', // AlmaLinux (operating_systems)
  '10000000-0000-0000-0000-000000000004', // Ubuntu
  '20000000-0000-0000-0000-000000000006', // Ubuntu 24.04 LTS (operating_system_versions)
  '20000000-0000-0000-0000-000000000099', // UNKNOWN backfill target
  '30000000-0000-0000-0000-000000000001', // cPanel & WHM (control_panels)
  '31000000-0000-0000-0000-000000000001', // control panel plan family
  '00000000-0000-0000-0000-000000000001', // seeded role
  '00000000-0000-0000-0000-000000000000', // nil UUID default
];

describe('canonical database UUID contract', () => {
  it('documents the root cause: zod 4 z.uuid() rejects the deterministic seeded ids', () => {
    // The all-zero "nil UUID" is explicitly allowed by zod as a special case, so it is the one
    // seeded value that passes. Every real catalogue id is rejected.
    const nilUuid = '00000000-0000-0000-0000-000000000000';
    expect(z.uuid().safeParse(nilUuid).success).toBe(true);
    for (const id of SEEDED_IDS.filter((value) => value !== nilUuid)) {
      expect(z.uuid().safeParse(id).success, id).toBe(false);
    }
  });

  it('accepts every seeded catalogue identifier', () => {
    for (const id of SEEDED_IDS) {
      expect(dbUuidSchema.safeParse(id).success).toBe(true);
      expect(catalogIdSchema.parse(id)).toBe(id);
    }
  });

  it('also accepts runtime-generated RFC 4122 v4 identifiers', () => {
    for (let i = 0; i < 5; i += 1) {
      const generated = randomUUID();
      expect(catalogIdSchema.parse(generated)).toBe(generated);
    }
  });

  it('normalises uppercase to lowercase for deterministic DB lookups', () => {
    expect(catalogIdSchema.parse('20000000-0000-0000-0000-00000000000A')).toBe(
      '20000000-0000-0000-0000-00000000000a'
    );
  });

  it('still rejects anything that is not a canonical UUID (validation was NOT weakened)', () => {
    const malformed = [
      '',
      'not-a-uuid',
      '20000000-0000-0000-0000-000000000006 ',
      ' 20000000-0000-0000-0000-000000000006',
      '20000000-0000-0000-0000-00000000000G',
      '20000000-0000-0000-0000-0000000000060',
      '20000000000000000000000000000006',
      '{20000000-0000-0000-0000-000000000006}',
      'urn:uuid:20000000-0000-0000-0000-000000000006',
      "20000000-0000-0000-0000-000000000006' OR 1=1--",
      null,
      42,
      {},
    ];
    for (const value of malformed) {
      expect(dbUuidSchema.safeParse(value).success).toBe(false);
    }
  });

  it('exposes helpers that fail loudly rather than coercing', () => {
    expect(isCanonicalDbUuid('20000000-0000-0000-0000-000000000006')).toBe(true);
    expect(isCanonicalDbUuid('20000000-0000-0000-0000-00000000000G')).toBe(false);
    expect(requireDbUuid('ABCDEF00-0000-0000-0000-0000000000AB')).toBe('abcdef00-0000-0000-0000-0000000000ab');
    expect(() => requireDbUuid('bogus', 'osVersionId')).toThrow(/osVersionId/);
  });

  it('guards the seed data itself: every UUID literal in the migrations satisfies the contract', () => {
    const dir = path.join(process.cwd(), 'database', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(80);
    let literals = 0;
    for (const file of files) {
      const sql = readFileSync(path.join(dir, file), 'utf8');
      const matches = sql.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g) ?? [];
      for (const literal of matches) {
        literals += 1;
        expect(DB_UUID_PATTERN.test(literal), `${file}: ${literal}`).toBe(true);
        expect(dbUuidSchema.safeParse(literal).success, `${file}: ${literal}`).toBe(true);
      }
    }
    expect(literals).toBeGreaterThan(100);
  });
});
