/**
 * "What Is My IP" — the tool the menu bar's Tools → IP Tools entry opens.
 *
 * This service had no test coverage at all, and it did not use the deployment-verified boundary the
 * header's IP detector uses. It read Fastify's `request.ip`, which the app derives from
 * `X-Forwarded-For` under a global `trustProxy: true`, so:
 *
 *   • any caller could state their own address by sending a forwarding header, and
 *   • with no forwarding header — the normal case behind a reverse proxy — it reported the
 *     *server's own* peer address (reproduced: `127.0.0.1`) as the visitor's public IP.
 *
 * Both were presented in the same `detectedAddress`/`ipv4` fields as a real answer, with no
 * indication that nothing had been verified. These tests pin the replacement contract: one verified
 * answer, the same rule as the header, and an explicit reason when there is nothing to report.
 */
import { describe, expect, it } from 'vitest';
import { myIp } from '../../src/tools/ip/ip-service';
import { resolveVisitorIpDetail, type VisitorIpResolution } from '../../src/routes/visitor-ip';

const TRUSTED = '10.0.0.1';

function call(options: {
  peer: string;
  forwardedFor?: string;
  mode?: 'off' | 'direct' | 'trusted-proxy';
  proxyList?: string;
  headers?: Record<string, string>;
}) {
  const resolution: VisitorIpResolution = resolveVisitorIpDetail(
    options.peer,
    options.forwardedFor === undefined ? {} : { 'x-forwarded-for': options.forwardedFor },
    options.mode ?? 'trusted-proxy',
    options.proxyList ?? TRUSTED
  );
  const headers: Record<string, string | string[] | undefined> = {
    'user-agent': 'Mozilla/5.0 (test)',
    ...(options.forwardedFor ? { 'x-forwarded-for': options.forwardedFor } : {}),
    ...options.headers,
  };
  return myIp({ resolution, headers, protocol: 'https', socket: null });
}

describe('my-ip tool', () => {
  it('reports the one address the trusted boundary verified, in its own family slot', () => {
    const v4 = call({ peer: TRUSTED, forwardedFor: '102.89.234.5' });
    expect(v4.detectedAddress).toBe('102.89.234.5');
    expect(v4.ipv4).toBe('102.89.234.5');
    expect(v4.ipv6).toBeNull();
    expect(v4.detection).toMatchObject({ status: 'detected', reason: 'detected' });

    const v6 = call({ peer: TRUSTED, forwardedFor: '2606:4700:4700::1111' });
    expect(v6.ipv6).toBe('2606:4700:4700::1111');
    expect(v6.ipv4).toBeNull();
  });

  it('walks a multi-hop chain from the trusted side, ignoring what the visitor prepended', () => {
    const result = call({ peer: TRUSTED, forwardedFor: '1.2.3.4, 102.89.234.5' });
    // 1.2.3.4 is caller-supplied and sits to the left of the hop the trusted proxy observed.
    expect(result.detectedAddress).toBe('102.89.234.5');
    expect(result.forwardedFor).toEqual(['1.2.3.4', '102.89.234.5']);
  });

  it('never accepts a caller-stated address from an untrusted peer', () => {
    const result = call({ peer: '203.0.113.9', forwardedFor: '8.8.8.8' });
    expect(result.detectedAddress).toBeNull();
    expect(result.ipv4).toBeNull();
    expect(result.ipv6).toBeNull();
    expect(result.detection.status).toBe('unavailable');
    expect(result.detection.reason).toBe('unverified');
    // The unverified chain is still shown as the diagnostic it is — just never as the answer.
    expect(result.forwardedFor).toEqual(['8.8.8.8']);
  });

  /**
   * The regression that made the tool useless-and-wrong: behind a reverse proxy with no forwarding
   * header, the socket peer is the proxy, and this used to be returned as the visitor's public IP.
   */
  it('never presents the server, a proxy or a loopback address as the visitor’s IP', () => {
    for (const peer of ['127.0.0.1', '::1', '10.0.0.2', '192.168.1.1', '172.16.0.9', 'fd00::1', '169.254.1.1']) {
      const direct = call({ peer, mode: 'direct' });
      expect(direct.detectedAddress, `direct mode from ${peer}`).toBeNull();
      expect(direct.ipv4).toBeNull();
      expect(direct.ipv6).toBeNull();
      expect(direct.detection.reason).toBe('not_public');
    }

    // A trusted proxy forwarding a private address is still not a public visitor IP.
    const forwardedPrivate = call({ peer: TRUSTED, forwardedFor: '192.168.1.5' });
    expect(forwardedPrivate.detectedAddress).toBeNull();
    expect(forwardedPrivate.detection.reason).toBe('not_public');
  });

  it('says detection is switched off rather than implying a network fault', () => {
    const result = call({ peer: '8.8.8.8', mode: 'off' });
    expect(result.detectedAddress).toBeNull();
    expect(result.detection).toMatchObject({ status: 'unavailable', reason: 'disabled' });
    expect(result.detection.explanation).toMatch(/switched off/i);
    expect(result.note).toMatch(/never substitutes/i);
  });

  it('gives every non-detected outcome a plain-language explanation', () => {
    for (const result of [
      call({ peer: '203.0.113.9', forwardedFor: '8.8.8.8' }),
      call({ peer: TRUSTED }),
      call({ peer: TRUSTED, forwardedFor: 'junk, 8.8.8.8' }),
      call({ peer: '8.8.8.8', mode: 'off' }),
      call({ peer: '127.0.0.1', mode: 'direct' }),
    ]) {
      expect(result.detection.status).toBe('unavailable');
      expect(result.detection.explanation.length).toBeGreaterThan(20);
      expect(result.detectedAddress).toBeNull();
    }
  });

  /**
   * The tool echoes the headers the browser sent — but an HttpOnly session cookie or a bearer token
   * repeated inside a readable JSON body is handed to any script on the page, defeating the
   * protection that made it unreadable. The key stays visible; the value does not.
   */
  it('echoes request headers but withholds credential values', () => {
    const result = call({
      peer: TRUSTED,
      forwardedFor: '102.89.234.5',
      headers: {
        cookie: 'cloudhost247_session=super-secret-value',
        authorization: 'Bearer eyJhbGciOi.signed.token',
        'x-api-key': 'k_live_12345',
        'set-cookie': 'sid=abc; HttpOnly',
        accept: 'application/json',
        'accept-language': 'en-NG',
      },
    });
    expect(result.headers['cookie']).toBe('«redacted»');
    expect(result.headers['authorization']).toBe('«redacted»');
    expect(result.headers['x-api-key']).toBe('«redacted»');
    expect(result.headers['set-cookie']).toBe('«redacted»');
    expect(JSON.stringify(result.headers)).not.toContain('super-secret-value');
    expect(JSON.stringify(result.headers)).not.toContain('signed.token');
    expect(JSON.stringify(result.headers)).not.toContain('k_live_12345');
    // Non-credential headers are still shown, which is the point of the tool.
    expect(result.headers['accept']).toBe('application/json');
    expect(result.headers['accept-language']).toBe('en-NG');
    expect(result.userAgent).toBe('Mozilla/5.0 (test)');
  });

  it('reports TLS only when the socket really is encrypted', () => {
    expect(call({ peer: TRUSTED, forwardedFor: '102.89.234.5' }).connection.tls).toBeNull();
    const encrypted = myIp({
      resolution: resolveVisitorIpDetail(TRUSTED, { 'x-forwarded-for': '102.89.234.5' }, 'trusted-proxy', TRUSTED),
      headers: {},
      protocol: 'https',
      socket: {
        encrypted: true,
        getProtocol: () => 'TLSv1.3',
        getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384' }),
        getPeerCertificate: () => ({ subject: { CN: 'example.com' } }),
      },
    });
    expect(encrypted.connection.tls).toEqual({ protocol: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384', authorized: true });
  });
});
