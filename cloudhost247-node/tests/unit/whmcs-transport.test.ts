import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchTransport, MAX_RESPONSE_BYTES } from '../../src/whmcs/transport';

const transport = new FetchTransport();
const request = { url: 'https://billing.example.test/includes/api.php', body: 'secret=private-secret', timeoutMs: 2000 };
let server: Server | undefined;
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe('WHMCS fetch transport response boundary', () => {
  it('decodes split UTF-8 chunks and preserves the byte limit', async () => {
    const bytes = new TextEncoder().encode('hello € world');
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 7)); c.enqueue(bytes.slice(7)); c.close(); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    const result = await transport.send(request);
    expect(result.body).toBe('hello € world');
    expect(result.status).toBe(200);
  });

  it('rejects oversized declared lengths and cancels without reading', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } })));
    await expect(transport.send(request)).rejects.toMatchObject({ code: 'WHMCS_UNREACHABLE' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('counts bytes rather than characters and stops a lying chunked response', async () => {
    const cancel = vi.fn();
    const chunk = new TextEncoder().encode('é'.repeat(16_384));
    let pushed = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pushed++; c.enqueue(chunk); }, cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-length': '12' } })));
    await expect(transport.send(request)).rejects.toMatchObject({ code: 'WHMCS_UNREACHABLE' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pushed).toBeLessThan(40);
  });

  it('accepts exactly the byte cap and rejects an additional byte', async () => {
    const exact = new Uint8Array(MAX_RESPONSE_BYTES).fill(65);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(exact)).mockResolvedValueOnce(new Response(new Uint8Array(MAX_RESPONSE_BYTES + 1).fill(65))));
    expect((await transport.send(request)).body.length).toBe(MAX_RESPONSE_BYTES);
    await expect(transport.send(request)).rejects.toMatchObject({ code: 'WHMCS_UNREACHABLE' });
  });

  it('normalizes stream errors without preserving untrusted error text', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error('private-secret-stream')); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    const error = await transport.send(request).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'WHMCS_UNREACHABLE' });
    expect(JSON.stringify(error)).not.toContain('private-secret');
  });

  it('rejects an over-limit chunked response from a real local HTTP server', async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'transfer-encoding': 'chunked' });
      res.end(Buffer.alloc(MAX_RESPONSE_BYTES + 1, 65));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    await expect(transport.send({ ...request, url: `http://127.0.0.1:${port}/test` })).rejects.toMatchObject({ code: 'WHMCS_UNREACHABLE' });
  });

  it('times out while a real local HTTP response body stalls after headers', async () => {
    server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const started = Date.now();
    const error = await transport.send({ ...request, url: `http://127.0.0.1:${port}/test`, timeoutMs: 150 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'WHMCS_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(JSON.stringify(error)).not.toContain('private-secret');
  });
});
