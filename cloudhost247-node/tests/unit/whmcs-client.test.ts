import { describe, expect, it, vi } from 'vitest';
import { WhmcsClient, CIRCUIT_FAILURE_THRESHOLD, type WhmcsLogger } from '../../src/whmcs/client';
import { loadWhmcsConfig, type WhmcsConfig } from '../../src/whmcs/config';
import {
  WhmcsApiError,
  WhmcsCircuitOpenError,
  WhmcsHttpError,
  WhmcsMalformedResponseError,
  WhmcsSchemaError,
  WhmcsTimeoutError,
  WhmcsInvalidConfigError,
} from '../../src/whmcs/errors';
import { getProductsSchema } from '../../src/whmcs/schemas';
import type { Transport, TransportRequest } from '../../src/whmcs/transport';
import { z } from 'zod';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Behaviour of the WHMCS client under each wire failure, plus the one property that matters most:
 * the API secret travels in the request body and appears nowhere else — not in a log line, not in an
 * error, not in the repository.
 */

const ENV = {
  WHMCS_BASE_URL: 'https://billing.example.com',
  WHMCS_API_IDENTIFIER: 'cloudhost247-site',
  WHMCS_API_SECRET: 'super-secret-value-that-must-not-leak',
} as NodeJS.ProcessEnv;

function config(overrides: Partial<WhmcsConfig> = {}): WhmcsConfig {
  const loaded = loadWhmcsConfig(ENV);
  if (!loaded.enabled) throw new Error('test env invalid');
  return { ...loaded.config, ...overrides };
}

class RecordingLogger implements WhmcsLogger {
  readonly lines: Array<{ level: string; event: string; fields: Record<string, unknown> }> = [];
  info(event: string, fields: Record<string, unknown>): void {
    this.lines.push({ level: 'info', event, fields });
  }
  warn(event: string, fields: Record<string, unknown>): void {
    this.lines.push({ level: 'warn', event, fields });
  }
  error(event: string, fields: Record<string, unknown>): void {
    this.lines.push({ level: 'error', event, fields });
  }
}

function transportOf(handler: (request: TransportRequest) => Promise<{ status: number; body: string }> | { status: number; body: string }): Transport & { requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  return {
    requests,
    async send(request) {
      requests.push(request);
      return handler(request);
    },
  };
}

function client(transport: Transport, overrides: Partial<WhmcsConfig> = {}, logger?: WhmcsLogger) {
  const sleeps: number[] = [];
  const instance = new WhmcsClient({
    config: config(overrides),
    transport,
    logger: logger ?? new RecordingLogger(),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    now: () => Date.now(),
  });
  return { instance, sleeps };
}

const SUCCESS_PRODUCTS = {
  result: 'success',
  products: [
    {
      pid: '3',
      gid: '1',
      name: 'Business Hosting',
      pricing: { USD: { prefix: '$', suffix: ' USD', monthly: '19.95', quarterly: '-1' } },
    },
  ],
};

describe('WHMCS client', () => {
  it('authenticates in the body and returns the validated payload', async () => {
    const transport = transportOf(() => ({ status: 200, body: JSON.stringify(SUCCESS_PRODUCTS) }));
    const { instance } = client(transport);

    const payload = await instance.call('GetProducts', { limitnum: 50 }, getProductsSchema);

    expect(payload.products).toHaveLength(1);
    expect(transport.requests).toHaveLength(1);
    const body = new URLSearchParams(transport.requests[0]!.body);
    expect(body.get('identifier')).toBe('cloudhost247-site');
    expect(body.get('secret')).toBe('super-secret-value-that-must-not-leak');
    expect(body.get('action')).toBe('GetProducts');
    expect(body.get('responsetype')).toBe('json');
    expect(body.get('limitnum')).toBe('50');
    expect(transport.requests[0]!.url).toBe('https://billing.example.com/includes/api.php');
  });

  it('never writes the secret or identifier into a log line', async () => {
    const logger = new RecordingLogger();
    const transport = transportOf((request) => {
      // Echo the request body back in a failing payload — the nastiest realistic case.
      return { status: 500, body: request.body };
    });
    const { instance } = client(transport, { maxAttempts: 1 }, logger);

    await expect(instance.call('GetProducts', {}, getProductsSchema)).rejects.toBeInstanceOf(WhmcsHttpError);

    const logged = JSON.stringify(logger.lines);
    expect(logged).not.toContain('super-secret-value-that-must-not-leak');
    expect(logged).not.toContain('cloudhost247-site');
  });

  it('retries a timed-out read, then reports a typed timeout', async () => {
    const transport = transportOf(() => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    });
    const { instance, sleeps } = client(transport);

    await expect(instance.call('GetProducts', {}, getProductsSchema)).rejects.toBeInstanceOf(WhmcsTimeoutError);
    expect(transport.requests).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it('recovers when a transient 500 is followed by a success', async () => {
    let calls = 0;
    const transport = transportOf(() => {
      calls += 1;
      return calls === 1 ? { status: 503, body: 'unavailable' } : { status: 200, body: JSON.stringify(SUCCESS_PRODUCTS) };
    });
    const { instance } = client(transport);
    const payload = await instance.call('GetProducts', {}, getProductsSchema);
    expect(payload.result).toBe('success');
    expect(transport.requests).toHaveLength(2);
  });

  it('does not follow a redirect and does not retry a 302 sign-in wall', async () => {
    const transport = transportOf(() => ({ status: 302, body: '<html>login</html>' }));
    const { instance } = client(transport);
    await expect(instance.call('GetProducts', {}, getProductsSchema)).rejects.toBeInstanceOf(WhmcsHttpError);
    expect(transport.requests).toHaveLength(1);
  });

  it('rejects an HTML error page as a malformed response without retrying', async () => {
    const transport = transportOf(() => ({ status: 200, body: '<html>Fatal error</html>' }));
    const { instance } = client(transport);
    await expect(instance.call('GetProducts', {}, getProductsSchema)).rejects.toBeInstanceOf(
      WhmcsMalformedResponseError,
    );
    expect(transport.requests).toHaveLength(1);
  });

  it('surfaces a WHMCS result=error as an API error', async () => {
    const transport = transportOf(() => ({ status: 200, body: JSON.stringify({ result: 'error', message: 'Invalid IP 203.0.113.9' }) }));
    const { instance } = client(transport);
    const error = await instance.call('GetProducts', {}, getProductsSchema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhmcsApiError);
    expect((error as Error).message).toContain('Invalid IP');
    expect(transport.requests).toHaveLength(1);
  });

  it('rejects a payload that does not match the schema', async () => {
    const transport = transportOf(() => ({ status: 200, body: JSON.stringify({ result: 'success', products: [{ nope: true }] }) }));
    const { instance } = client(transport);
    await expect(
      instance.call('GetProducts', {}, z.looseObject({ result: z.literal('success'), products: z.array(z.looseObject({ pid: z.string() })) })),
    ).rejects.toBeInstanceOf(WhmcsSchemaError);
  });

  it('refuses a write action in read-only mode before contacting WHMCS', async () => {
    const transport = transportOf(() => ({ status: 200, body: JSON.stringify({ result: 'success' }) }));
    const { instance } = client(transport);
    await expect(
      instance.call('AddOrder', { clientid: 1 }, z.looseObject({ result: z.literal('success') }), { write: true }),
    ).rejects.toBeInstanceOf(WhmcsInvalidConfigError);
    expect(transport.requests).toHaveLength(0);
  });

  it('never retries a write action, even on a timeout', async () => {
    const transport = transportOf(() => {
      const error = new Error('socket hang up');
      error.name = 'AbortError';
      throw error;
    });
    const { instance } = client(transport, { mode: 'full' });
    await expect(
      instance.call('AddOrder', { clientid: 1 }, z.looseObject({ result: z.literal('success') }), { write: true }),
    ).rejects.toBeInstanceOf(WhmcsTimeoutError);
    expect(transport.requests).toHaveLength(1);
  });

  it('opens the circuit after repeated failures and stops calling WHMCS', async () => {
    let now = 1_000_000;
    const transport = transportOf(() => ({ status: 500, body: 'down' }));
    const instance = new WhmcsClient({
      config: config({ maxAttempts: 1 }),
      transport,
      logger: new RecordingLogger(),
      sleep: async () => undefined,
      now: () => now,
    });

    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      await expect(instance.call('GetProducts', {}, getProductsSchema)).rejects.toBeInstanceOf(WhmcsHttpError);
    }
    const requestsBefore = transport.requests.length;
    await expect(instance.call('GetProducts', {}, getProductsSchema)).rejects.toBeInstanceOf(WhmcsCircuitOpenError);
    expect(transport.requests).toHaveLength(requestsBefore);
    expect(instance.isCircuitOpen()).toBe(true);

    // After the cooldown the next attempt is allowed again.
    now += 31_000;
    await expect(instance.call('GetProducts', {}, getProductsSchema)).rejects.toBeInstanceOf(WhmcsHttpError);
    expect(transport.requests.length).toBeGreaterThan(requestsBefore);
  });

  it('keeps no credential anywhere in the source tree', () => {
    const roots = ['src/whmcs', 'src/config'];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of readdirSync(root)) {
        const full = path.join(root, file);
        if (!statSync(full).isFile()) continue;
        const text = readFileSync(full, 'utf8');
        // The only place these variable names may be *read* is config.ts; no literal may be assigned.
        if (/WHMCS_API_SECRET\s*[:=]\s*['"][^'"]+['"]/.test(text)) offenders.push(full);
      }
    }
    expect(offenders).toEqual([]);
  });
});
