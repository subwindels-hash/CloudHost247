/**
 * DNS Checker inventory gap tools: Minecraft colour codes, RAID calculator, local IPv6 (ULA)
 * generator and IPv6 compatibility checker.
 *
 * Expected values are computed by hand from the published definitions (Minecraft Wiki code table,
 * RFC 4193 layout, standard RAID capacity formulae), not by calling the code under test.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { isIPv6 } from 'node:net';
import { MINECRAFT_CODES, convertMinecraftCodes } from '../../src/tools/gaming/minecraft';
import { computeRaid, RaidInputError, RAID_BYTES } from '../../src/tools/productivity/raid';
import { classifyIpv6, generateUla } from '../../src/tools/ip/ipv6-tools';
import { TOOL_CATALOG } from '../../src/tools/catalog';
import { TOOL_HANDLERS, handlerFor } from '../../src/tools/handlers';
import { ToolError } from '../../src/tools/core/errors';

vi.mock('../../src/tools/dns/lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/dns/lookup')>();
  return { ...actual, dnsLookup: vi.fn() };
});

const ctx = { db: {} } as never;

describe('Minecraft colour codes', () => {
  it('lists the 16 colour codes and the 5 formats plus reset, each code once', () => {
    const colours = MINECRAFT_CODES.filter((c) => c.kind === 'colour');
    const formats = MINECRAFT_CODES.filter((c) => c.kind === 'format');
    expect(colours.map((c) => c.code).join('')).toBe('0123456789abcdef');
    expect(formats.map((c) => c.code).join('')).toBe('klmno');
    expect(MINECRAFT_CODES.filter((c) => c.kind === 'reset').map((c) => c.code)).toEqual(['r']);
    expect(new Set(MINECRAFT_CODES.map((c) => c.code)).size).toBe(MINECRAFT_CODES.length);
    expect(colours.find((c) => c.code === 'c')?.hex).toBe('#FF5555');
    expect(colours.find((c) => c.code === '0')?.hex).toBe('#000000');
  });

  it('converts ampersand codes to section-sign codes and counts them', () => {
    const result = convertMinecraftCodes('&aHello &lWorld &r&c!', 'ampersand-to-section');
    expect(result.output).toBe('\u00a7aHello \u00a7lWorld \u00a7r\u00a7c!');
    expect(result.codesProcessed).toBe(4);
    expect(result.byCode).toEqual({ a: 1, l: 1, r: 1, c: 1 });
  });

  it('accepts upper-case code characters and leaves unknown codes untouched', () => {
    const result = convertMinecraftCodes('&Ahi &zkeep &&a', 'ampersand-to-section');
    expect(result.output).toBe('\u00a7ahi &zkeep &\u00a7a');
    expect(result.codesProcessed).toBe(2);
  });

  it('converts section codes back to ampersand notation', () => {
    expect(convertMinecraftCodes('\u00a7eGold \u00a7lbold', 'section-to-ampersand').output).toBe('&eGold &lbold');
  });

  it('strips both notations', () => {
    const result = convertMinecraftCodes('&aA\u00a7bB&oC', 'strip');
    expect(result.output).toBe('ABC');
    expect(result.codesProcessed).toBe(3);
  });

  it('returns the table without conversion when no text is supplied', async () => {
    const out = (await handlerFor('minecraft-color-codes')!({}, ctx)) as { codes: unknown[]; conversion: unknown };
    expect(out.codes).toHaveLength(MINECRAFT_CODES.length);
    expect(out.conversion).toBeNull();
  });
});

describe('RAID calculator (standard layouts)', () => {
  it('RAID 5, 4 x 4 TB: usable is three drives, 25% overhead, one guaranteed failure', () => {
    const r = computeRaid({ level: '5', drives: 4, driveSizeTb: 4 });
    expect(r.rawTb).toBe(16);
    expect(r.usableTb).toBe(12);
    expect(r.overheadPct).toBe(25);
    expect(r.guaranteedFailures).toBe(1);
  });

  it('RAID 6, 6 x 2 TB: usable is four drives, two failures survivable', () => {
    const r = computeRaid({ level: '6', drives: 6, driveSizeTb: 2 });
    expect(r.usableTb).toBe(8);
    expect(r.guaranteedFailures).toBe(2);
  });

  it('RAID 10, 4 x 1 TB: half the raw capacity, up to two failures in the best case', () => {
    const r = computeRaid({ level: '10', drives: 4, driveSizeTb: 1 });
    expect(r.usableTb).toBe(2);
    expect(r.guaranteedFailures).toBe(1);
    expect(r.bestCaseFailures).toBe(2);
  });

  it('RAID 1 mirror: capacity of one drive; RAID 0: sum of all drives with no redundancy', () => {
    expect(computeRaid({ level: '1', drives: 2, driveSizeTb: 1 }).usableTb).toBe(1);
    const raid0 = computeRaid({ level: '0', drives: 3, driveSizeTb: 2 });
    expect(raid0.usableTb).toBe(6);
    expect(raid0.guaranteedFailures).toBe(0);
    expect(raid0.warnings.length).toBeGreaterThan(0);
  });

  it('reports the binary (TiB) equivalent of decimal terabytes', () => {
    const r = computeRaid({ level: '0', drives: 2, driveSizeTb: 1 });
    expect(r.usableTib).toBeCloseTo(2e12 / RAID_BYTES.BYTES_PER_TIB, 3);
    expect(r.usableTib).toBeCloseTo(1.819, 3);
  });

  it.each([
    [{ level: '7' as never, drives: 4, driveSizeTb: 1 }, 'Choose RAID'],
    [{ level: '5' as const, drives: 2, driveSizeTb: 1 }, 'at least 3'],
    [{ level: '6' as const, drives: 3, driveSizeTb: 1 }, 'at least 4'],
    [{ level: '10' as const, drives: 5, driveSizeTb: 1 }, 'even number'],
    [{ level: '0' as const, drives: 0, driveSizeTb: 1 }, 'whole number'],
    [{ level: '0' as const, drives: 2.5, driveSizeTb: 1 }, 'whole number'],
    [{ level: '0' as const, drives: 2, driveSizeTb: 0 }, 'Drive size'],
    [{ level: '0' as const, drives: 2, driveSizeTb: Number.NaN }, 'Drive size'],
  ])('rejects invalid input %#', (input, message) => {
    expect(() => computeRaid(input)).toThrow(RaidInputError);
    expect(() => computeRaid(input)).toThrow(message);
  });

  it('the handler maps invalid input to INVALID_INPUT, not a server error', async () => {
    const handler = handlerFor('raid-calculator')!;
    const error = await handler({ level: '10', drives: 3, driveSizeTb: 1 }, ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe('INVALID_INPUT');
  });
});

describe('Local IPv6 (RFC 4193 ULA) generator', () => {
  it('lays out the Global ID, subnet and sample address from the random bytes', () => {
    const result = generateUla('1A', () => Buffer.from([0xab, 0xcd, 0xef, 0x01, 0x23]));
    expect(result.prefix).toBe('fdab:cdef:0123::/48');
    expect(result.subnetPrefix).toBe('fdab:cdef:0123:001a::/64');
    expect(result.sampleAddress).toBe('fdab:cdef:0123:001a::1');
    expect(isIPv6(result.sampleAddress)).toBe(true);
  });

  it('defaults the subnet to 0000 and always produces an fd00::/8 address', () => {
    for (let i = 0; i < 25; i += 1) {
      const result = generateUla(undefined, randomBytes);
      expect(result.prefix).toMatch(/^fd[0-9a-f]{2}:[0-9a-f]{4}:[0-9a-f]{4}::\/48$/);
      expect(result.subnetId).toBe('0000');
      expect(isIPv6(result.sampleAddress)).toBe(true);
    }
  });

  it.each(['xyz', '12345', '-1', 'g000'])('rejects subnet ID %j', (subnet) => {
    expect(() => generateUla(subnet, () => Buffer.alloc(5))).toThrow();
  });

  it('treats a blank subnet ID as the default 0000', () => {
    expect(generateUla('', () => Buffer.alloc(5)).subnetId).toBe('0000');
  });

  it('the handler returns INVALID_INPUT for a bad subnet', async () => {
    const error = await handlerFor('ipv6-address-generator')!({ subnetId: 'zz' }, ctx).catch((e: unknown) => e);
    expect((error as ToolError).code).toBe('INVALID_INPUT');
  });
});

describe('IPv6 compatibility classification', () => {
  it('reports IPv6 when a valid AAAA record exists and ignores malformed values', () => {
    const r = classifyIpv6(['2001:db8::1', 'not-an-address'], ['203.0.113.5']);
    expect(r.verdict).toBe('IPV6_ADDRESSES_PUBLISHED');
    expect(r.ipv6Addresses).toEqual(['2001:db8::1']);
    expect(r.explanation).toMatch(/does not prove/);
  });

  it('reports IPv4-only when only A records exist', () => {
    expect(classifyIpv6([], ['203.0.113.5']).verdict).toBe('IPV4_ONLY');
  });

  it('reports no address records when neither type exists', () => {
    expect(classifyIpv6([], []).verdict).toBe('NO_ADDRESS_RECORDS');
  });
});

describe('IPv6 compatibility handler', () => {
  beforeEach(async () => {
    const lookup = await import('../../src/tools/dns/lookup');
    vi.mocked(lookup.dnsLookup).mockReset();
  });

  it('queries AAAA and A through the resolver layer and returns the verdict with evidence', async () => {
    const lookup = await import('../../src/tools/dns/lookup');
    const resolver = { id: 'r1', name: 'Test resolver' } as never;
    vi.mocked(lookup.dnsLookup).mockImplementation(async (_db, input) => ({
      query: { name: input.name, type: input.type },
      records: input.type === 'AAAA'
        ? [{ name: input.name, type: 'AAAA', ttl: 300, priority: null, value: '2001:db8::10', detail: {} }]
        : [{ name: input.name, type: 'A', ttl: 300, priority: null, value: '203.0.113.10', detail: {} }],
      resolver,
      durationMs: 12,
      rcode: 'NOERROR',
      authoritative: false,
      truncated: false,
      hasDnssecRecords: false,
      cnameChain: [],
      explanation: '',
      warnings: [],
    }));
    const out = (await TOOL_HANDLERS['ipv6-compatibility-checker']!({ domain: 'example.com' }, ctx)) as {
      verdict: string;
      domain: string;
      aQuery: { resolver: unknown };
    };
    expect(out.verdict).toBe('IPV6_ADDRESSES_PUBLISHED');
    expect(out.domain).toBe('example.com');
    expect(out.aQuery.resolver).toEqual(resolver);
    expect(vi.mocked(lookup.dnsLookup).mock.calls.map((c) => c[1].type).sort()).toEqual(['A', 'AAAA']);
  });

  it('propagates a resolver failure instead of reporting a successful result', async () => {
    const lookup = await import('../../src/tools/dns/lookup');
    vi.mocked(lookup.dnsLookup).mockRejectedValue(new ToolError('SERVICE_UNAVAILABLE', 'resolver down'));
    await expect(TOOL_HANDLERS['ipv6-compatibility-checker']!({ domain: 'example.com' }, ctx)).rejects.toBeInstanceOf(ToolError);
  });
});

describe('catalogue wiring for the gap tools', () => {
  it.each(['minecraft-color-codes', 'raid-calculator', 'ipv6-address-generator', 'ipv6-compatibility-checker'])(
    '%s is in the catalogue with a handler and a unique path',
    (slug) => {
      const entry = TOOL_CATALOG.find((t) => t.slug === slug);
      expect(entry).toBeDefined();
      expect(typeof TOOL_HANDLERS[slug]).toBe('function');
      expect(entry!.path.startsWith('/tools/')).toBe(true);
      expect(TOOL_CATALOG.filter((t) => t.path === entry!.path)).toHaveLength(1);
    }
  );
});
