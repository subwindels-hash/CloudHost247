/**
 * Test-only scripted Cloudflare API (spec §66: mocks live ONLY in tests).
 *
 * Implements a small in-memory model of the v4 endpoints the integration uses — zones, DNS
 * records, settings, DNSSEC, IP access rules, subscription, purge, token verify — served
 * through a fetch-compatible function injected into the real CloudflareClient. This exercises
 * the genuine client/provisioning/sync code paths against realistic envelopes, including
 * failure scripting (auth failures, 429s, timeouts).
 */
import { randomUUID } from 'node:crypto';

interface MockZone {
  id: string;
  name: string;
  status: string;
  paused: boolean;
  name_servers: string[];
  plan: { legacy_id: string; name: string };
}

interface MockRecord {
  id: string;
  zoneId: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority?: number;
  comment?: string | null;
}

export class MockCloudflare {
  zones = new Map<string, MockZone>();
  records = new Map<string, MockRecord>();
  settings = new Map<string, Record<string, unknown>>();
  dnssec = new Map<string, string>();
  accessRules = new Map<string, { id: string; zoneId: string; mode: string; notes?: string; configuration: { target: string; value: string } }>();
  purges: Array<{ zoneId: string; body: unknown }> = [];
  planChanges: Array<{ zoneId: string; ratePlan: string }> = [];
  requests: Array<{ method: string; path: string }> = [];

  /** Scripted failures: next N requests matching a predicate fail with the given response. */
  failScript: Array<{ match: (method: string, path: string) => boolean; status: number; errors: Array<{ code: number; message: string }>; remaining: number }> = [];

  accountId = 'mock-account-id';
  validToken = 'mock-valid-token';
  zoneStatusForNew = 'pending';

  addZone(name: string, status = 'active'): MockZone {
    const zone: MockZone = {
      id: `z-${randomUUID().slice(0, 8)}`,
      name: name.toLowerCase(),
      status,
      paused: false,
      name_servers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      plan: { legacy_id: 'free', name: 'Free Website' },
    };
    this.zones.set(zone.id, zone);
    return zone;
  }

  failNext(match: (method: string, path: string) => boolean, status: number, code: number, message: string, times = 1): void {
    this.failScript.push({ match, status, errors: [{ code, message }], remaining: times });
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/client\/v4/, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    this.requests.push({ method, path });

    const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '';
    if (auth !== `Bearer ${this.validToken}`) {
      return json(401, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] });
    }

    for (const script of this.failScript) {
      if (script.remaining > 0 && script.match(method, path)) {
        script.remaining -= 1;
        return json(script.status, { success: false, errors: script.errors });
      }
    }

    // ---- token & account
    if (method === 'GET' && path === '/user/tokens/verify') {
      return ok({ id: 'token-1', status: 'active', policies: [{ permission_groups: [{ name: 'Zone Read' }, { name: 'DNS Write' }] }] });
    }
    const accountMatch = /^\/accounts\/([^/]+)$/.exec(path);
    if (method === 'GET' && accountMatch) {
      return ok({ id: accountMatch[1], name: 'Mock Account' });
    }

    // ---- zones
    if (method === 'GET' && path === '/zones') {
      const name = url.searchParams.get('name');
      const list = [...this.zones.values()].filter((z) => !name || z.name === name.toLowerCase());
      return ok(list, { total_count: list.length });
    }
    if (method === 'POST' && path === '/zones') {
      const name = String(body['name']).toLowerCase();
      if ([...this.zones.values()].some((z) => z.name === name)) {
        return json(400, { success: false, errors: [{ code: 1061, message: 'Zone already exists' }] });
      }
      const zone = this.addZone(name, this.zoneStatusForNew);
      return ok(zone);
    }
    const zoneMatch = /^\/zones\/([^/]+)(.*)$/.exec(path);
    if (zoneMatch) {
      const zone = this.zones.get(zoneMatch[1] ?? '');
      const rest = zoneMatch[2] ?? '';
      if (!zone) return json(404, { success: false, errors: [{ code: 1001, message: 'Unknown zone' }] });

      if (rest === '' && method === 'GET') return ok(zone);
      if (rest === '' && method === 'PATCH') {
        if (typeof body['paused'] === 'boolean') zone.paused = body['paused'];
        return ok(zone);
      }
      if (rest === '' && method === 'DELETE') {
        this.zones.delete(zone.id);
        return ok({ id: zone.id });
      }

      // DNS records
      if (rest === '/dns_records' && method === 'GET') {
        const type = url.searchParams.get('type');
        const name = url.searchParams.get('name');
        const list = [...this.records.values()].filter(
          (r) => r.zoneId === zone.id && (!type || r.type === type) && (!name || r.name === name.toLowerCase())
        );
        return ok(list, { total_count: list.length });
      }
      if (rest === '/dns_records' && method === 'POST') {
        const record: MockRecord = {
          id: `r-${randomUUID().slice(0, 8)}`,
          zoneId: zone.id,
          type: String(body['type']),
          name: String(body['name']).toLowerCase(),
          content: String(body['content']),
          ttl: Number(body['ttl'] ?? 1),
          proxied: Boolean(body['proxied']),
          priority: body['priority'] as number | undefined,
          comment: (body['comment'] as string | undefined) ?? null,
        };
        this.records.set(record.id, record);
        return ok(record);
      }
      const recordMatch = /^\/dns_records\/([^/]+)$/.exec(rest);
      if (recordMatch) {
        const record = this.records.get(recordMatch[1] ?? '');
        if (!record || record.zoneId !== zone.id) {
          return json(404, { success: false, errors: [{ code: 81044, message: 'Record not found' }] });
        }
        if (method === 'PATCH') {
          Object.assign(record, {
            type: body['type'] ?? record.type,
            name: body['name'] ?? record.name,
            content: body['content'] ?? record.content,
            ttl: body['ttl'] ?? record.ttl,
            proxied: body['proxied'] ?? record.proxied,
            comment: body['comment'] ?? record.comment,
          });
          return ok(record);
        }
        if (method === 'DELETE') {
          this.records.delete(record.id);
          return ok({ id: record.id });
        }
      }

      // DNSSEC
      if (rest === '/dnssec' && method === 'GET') {
        return ok({ status: this.dnssec.get(zone.id) ?? 'disabled', ds: 'example. 3600 IN DS 2371 13 2 ABCD', key_tag: 2371, algorithm: '13' });
      }
      if (rest === '/dnssec' && method === 'PATCH') {
        this.dnssec.set(zone.id, String(body['status']));
        return ok({ status: body['status'] });
      }

      // settings
      const settingMatch = /^\/settings\/([^/]+)$/.exec(rest);
      if (settingMatch) {
        const settingId = settingMatch[1] ?? '';
        const zoneSettings = this.settings.get(zone.id) ?? {};
        if (method === 'GET') return ok({ id: settingId, value: zoneSettings[settingId] ?? defaultSetting(settingId), editable: true });
        if (method === 'PATCH') {
          zoneSettings[settingId] = body['value'];
          this.settings.set(zone.id, zoneSettings);
          return ok({ id: settingId, value: body['value'], editable: true });
        }
      }

      // access rules
      if (rest === '/firewall/access_rules/rules' && method === 'GET') {
        return ok([...this.accessRules.values()].filter((r) => r.zoneId === zone.id));
      }
      if (rest === '/firewall/access_rules/rules' && method === 'POST') {
        const rule = {
          id: `ar-${randomUUID().slice(0, 8)}`,
          zoneId: zone.id,
          mode: String(body['mode']),
          notes: body['notes'] as string | undefined,
          configuration: body['configuration'] as { target: string; value: string },
        };
        this.accessRules.set(rule.id, rule);
        return ok(rule);
      }
      const ruleMatch = /^\/firewall\/access_rules\/rules\/([^/]+)$/.exec(rest);
      if (ruleMatch) {
        const rule = this.accessRules.get(ruleMatch[1] ?? '');
        if (!rule || rule.zoneId !== zone.id) return json(404, { success: false, errors: [{ code: 10001, message: 'Rule not found' }] });
        if (method === 'PATCH') {
          if (body['mode']) rule.mode = String(body['mode']);
          if (body['notes'] !== undefined) rule.notes = body['notes'] as string;
          return ok(rule);
        }
        if (method === 'DELETE') {
          this.accessRules.delete(rule.id);
          return ok({ id: rule.id });
        }
      }

      // purge + subscription
      if (rest === '/purge_cache' && method === 'POST') {
        this.purges.push({ zoneId: zone.id, body });
        return ok({ id: zone.id });
      }
      if (rest === '/subscription' && method === 'PUT') {
        const ratePlan = (body['rate_plan'] as { id?: string })?.id ?? 'free';
        this.planChanges.push({ zoneId: zone.id, ratePlan });
        zone.plan = { legacy_id: ratePlan, name: ratePlan };
        return ok({ id: zone.id });
      }
    }

    // GraphQL analytics
    if (method === 'POST' && path === '/graphql') {
      return ok({
        data: {
          viewer: {
            zones: [
              {
                httpRequests1dGroups: [
                  { sum: { requests: 120, cachedRequests: 80, bytes: 1000, cachedBytes: 700, threats: 3, pageViews: 60 }, uniq: { uniques: 25 }, dimensions: { date: '2026-09-29' } },
                ],
              },
            ],
          },
        },
      });
    }

    return json(404, { success: false, errors: [{ code: 7000, message: `No route for ${method} ${path}` }] });
  };
}

function defaultSetting(id: string): unknown {
  const defaults: Record<string, unknown> = {
    ssl: 'full',
    min_tls_version: '1.2',
    tls_1_3: 'on',
    always_use_https: 'off',
    automatic_https_rewrites: 'on',
    security_level: 'medium',
    browser_check: 'on',
    challenge_ttl: 1800,
    rocket_loader: 'off',
    brotli: 'on',
    http3: 'on',
    early_hints: 'off',
    ip_geolocation: 'on',
    cache_level: 'aggressive',
    browser_cache_ttl: 14400,
    development_mode: 'off',
    email_obfuscation: 'on',
    server_side_exclude: 'on',
    hotlink_protection: 'off',
  };
  return defaults[id] ?? 'off';
}

function ok(result: unknown, resultInfo?: Record<string, unknown>): Response {
  return json(200, { success: true, errors: [], result, result_info: resultInfo });
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
