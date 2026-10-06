import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { EventEmitter } from 'node:events';
import { cacheKey } from '../../src/tools/core/cache';
import {
  blockedReason,
  parseIp,
  decompressBounded,
  fetchWithGuard,
} from '../../src/tools/core/ssrf';
import { resolveToolPage, toolPageHtml } from '../../src/tools/presentation';
import { TOOL_CATALOG, DISCOVERY_CATEGORIES } from '../../src/tools/catalog';
const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ default: { lookup: network.lookup } }));
vi.mock('node:http', () => ({ default: { request: network.request } }));
afterEach(() => vi.resetAllMocks());
describe('tools security boundaries', () => {
  it.each([
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '127.0.0.1',
    '10.2.3.4',
    '169.254.169.254',
    '192.168.1.1',
    '224.0.0.1',
  ])('refuses reserved target %s', (ip) =>
    expect(blockedReason(ip)).not.toBeNull()
  );
  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '1.1.1.1'])(
    'preserves public IP roundtrip %s',
    (ip) => {
      const parsed = parseIp(ip);
      expect(parsed).not.toBeNull();
      expect(blockedReason(ip)).toBeNull();
      expect(parseIp(parsed!.normalized)).toEqual(parsed);
    }
  );
  it('rejects a decompression bomb and malformed compression', () => {
    expect(() =>
      decompressBounded(gzipSync(Buffer.alloc(100000)), 'gzip', 1024)
    ).toThrow(/size limit/);
    expect(() =>
      decompressBounded(Buffer.from('not gzip'), 'gzip', 1024)
    ).toThrow();
    expect(
      decompressBounded(
        gzipSync(Buffer.from('actual response')),
        'gzip',
        1024
      ).toString()
    ).toBe('actual response');
  });
  it('does not normalize, truncate or publish private cache input', () => {
    const prefix = 'a'.repeat(4000);
    expect(cacheKey('example', [prefix + 'A'])).not.toBe(
      cacheKey('example', [prefix + 'B'])
    );
    expect(cacheKey('example', [' abc '])).not.toBe(
      cacheKey('example', ['abc'])
    );
    expect(cacheKey('example', ['Abc'])).not.toBe(cacheKey('example', ['abc']));
    expect(cacheKey('example', ['private@example.test'])).not.toContain(
      'private'
    );
  });
  it('rejects mixed public/private DNS answers before dialing', async () => {
    network.lookup.mockResolvedValue([
      { address: '1.1.1.1', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    await expect(fetchWithGuard('http://example.com')).rejects.toMatchObject({
      code: 'TARGET_BLOCKED',
    });
    expect(network.request).not.toHaveBeenCalled();
  });
  it('bounds a stalled DNS lookup', async () => {
    network.lookup.mockReturnValue(new Promise(() => {}));
    await expect(
      fetchWithGuard('http://example.com', { timeoutMs: 10 })
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  function response(
    options: {
      location?: string;
      oversize?: boolean;
      interrupted?: boolean;
    } = {}
  ) {
    network.request.mockImplementation((opts, callback) => {
      opts.lookup('example.com', {}, (_error: unknown, ip: string) =>
        expect(ip).toBe('1.1.1.1')
      );
      const req = new EventEmitter() as any;
      req.setTimeout = () => {};
      req.destroy = (err: Error) => {
        req.emit('error', err);
        req.emit('close');
      };
      req.end = () =>
        queueMicrotask(() => {
          const res = new EventEmitter() as any;
          res.headers = options.location ? { location: options.location } : {};
          res.statusCode = options.location ? 302 : 200;
          res.complete = !options.interrupted;
          res.destroy = () => res.emit('close');
          callback(res);
          res.emit(
            'data',
            Buffer.from(options.oversize ? 'a'.repeat(100) : 'real body')
          );
          res.emit(
            options.interrupted ? 'error' : 'end',
            new Error('interrupted')
          );
          res.emit('close');
          req.emit('close');
        });
      return req;
    });
  }
  it('pins the validated IP and blocks a redirect to metadata', async () => {
    network.lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]);
    response({ location: 'http://169.254.169.254/latest/meta-data' });
    await expect(fetchWithGuard('http://example.com')).rejects.toMatchObject({
      code: 'TARGET_BLOCKED',
    });
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it.each([{ oversize: true }, { interrupted: true }])(
    'never reports truncated/interrupted response as successful: %j',
    async (options) => {
      network.lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]);
      response(options);
      await expect(
        fetchWithGuard('http://example.com', { maxBytes: 12 })
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    }
  );
});
describe('registry routing and server metadata', () => {
  it('resolves every canonical route and alias without ambiguous collisions', () => {
    const paths = new Map<string, string>();
    for (const tool of TOOL_CATALOG)
      for (const path of [tool.path, ...(tool.legacyPaths ?? [])]) {
        expect(paths.get(path) ?? tool.slug).toBe(tool.slug);
        paths.set(path, tool.slug);
        expect(resolveToolPage(path)?.path).toBe(tool.path);
      }
    for (const slug of Object.keys(DISCOVERY_CATEGORIES))
      expect(resolveToolPage('/tools/category/' + slug)).not.toBeNull();
    expect(resolveToolPage('/tools/not-a-tool')).toBeNull();
  });
  it('renders distinct canonical and Open Graph metadata without trusting request Host', () => {
    const html = toolPageHtml(
      '<head><!-- example <title> is documentation --><title>Old</title><meta name="description" content="old"></head>',
      resolveToolPage('/tools/dns-lookup')!,
      'https://cloudhost247.test/platform'
    );
    expect(html).toContain('DNS Lookup');
    expect(html).toContain(
      'https://cloudhost247.test/platform/tools/dns-lookup'
    );
    expect(html).toContain('og:description');
  });
});
