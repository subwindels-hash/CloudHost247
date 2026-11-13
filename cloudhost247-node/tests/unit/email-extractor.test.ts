import { describe, expect, it } from 'vitest';
import { extractAddresses } from '../../src/tools/productivity/extractor';
import { TOOL_CATALOG } from '../../src/tools/catalog';
import { TOOL_HANDLERS } from '../../src/tools/handlers';

const SAMPLE = `Contact Ada <ada@example.com>, bob.smith+news@mail.example.org or ADA@EXAMPLE.COM.
Not an address: user@localhost, @nobody, a@b.
See https://example.com/docs?page=2, http://example.org/a_b) and www.example.net.`;

describe('extractAddresses', () => {
  it('extracts unique email addresses, comma separated by default', () => {
    const result = extractAddresses({ text: SAMPLE });
    expect(result.addresses).toEqual(['ada@example.com', 'bob.smith+news@mail.example.org']);
    expect(result.output).toBe('ada@example.com, bob.smith+news@mail.example.org');
    expect(result).toMatchObject({ type: 'email', count: 2, found: 3, duplicatesRemoved: 1, filteredOut: 0 });
  });

  it('extracts web addresses without trailing sentence punctuation', () => {
    const result = extractAddresses({ text: SAMPLE, type: 'web', separator: 'new-line' });
    expect(result.addresses).toEqual(['https://example.com/docs?page=2', 'http://example.org/a_b', 'www.example.net']);
    expect(result.output.split('\n')).toHaveLength(3);
  });

  it('applies separators, including a custom one', () => {
    expect(extractAddresses({ text: 'a@x.io b@x.io', separator: 'pipe' }).output).toBe('a@x.io | b@x.io');
    expect(extractAddresses({ text: 'a@x.io b@x.io', separator: 'colon' }).output).toBe('a@x.io : b@x.io');
    expect(extractAddresses({ text: 'a@x.io b@x.io', separator: 'other', customSeparator: ';' }).output).toBe('a@x.io;b@x.io');
    expect(() => extractAddresses({ text: 'a@x.io', separator: 'other' })).toThrow(/custom separator/);
  });

  it('groups, sorts and filters', () => {
    const text = 'c@x.io a@y.io b@x.io d@y.io';
    expect(extractAddresses({ text, sort: true, groupSize: 2 }).output).toBe('a@y.io, b@x.io\nc@x.io, d@y.io');
    expect(extractAddresses({ text, filter: '@X.io' }).addresses).toEqual(['c@x.io', 'b@x.io']);
    const excluded = extractAddresses({ text, filter: '@x.io', filterMode: 'exclude' });
    expect(excluded.addresses).toEqual(['a@y.io', 'd@y.io']);
    expect(excluded.filteredOut).toBe(2);
  });

  it('reports an empty result honestly and rejects empty input', () => {
    const result = extractAddresses({ text: 'nothing to see here' });
    expect(result.count).toBe(0);
    expect(result.output).toBe('');
    expect(result.notes.join(' ')).toMatch(/No email addresses were found/);
    expect(() => extractAddresses({ text: '   ' })).toThrow();
  });
});

describe('catalogue wiring for the email extractor', () => {
  it('is in the catalogue with a handler and a unique path', async () => {
    const entry = TOOL_CATALOG.find((tool) => tool.slug === 'email-extractor');
    expect(entry).toBeDefined();
    expect(entry!.path).toBe('/tools/email-extractor');
    expect(TOOL_CATALOG.filter((tool) => tool.path === entry!.path)).toHaveLength(1);
    const handler = TOOL_HANDLERS['email-extractor']!;
    const out = (await handler({ text: 'x@example.com', sort: 'true' }, {} as never)) as { count: number };
    expect(out.count).toBe(1);
  });

  it('publishes Extractor Pro as its own tool on the same handler', async () => {
    const entry = TOOL_CATALOG.find((tool) => tool.slug === 'email-extractor-pro');
    expect(entry?.path).toBe('/tools/email-extractor-pro');
    const out = (await TOOL_HANDLERS['email-extractor-pro']!({ text: 'a@example.com b@example.com', separator: 'new-line' }, {} as never)) as { addresses: string[] };
    expect(out.addresses).toEqual(['a@example.com', 'b@example.com']);
  });
});
