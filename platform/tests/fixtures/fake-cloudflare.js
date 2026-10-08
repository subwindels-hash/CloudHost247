/**
 * A fake Cloudflare API v4, served over real loopback HTTP.
 *
 * The Cloudflare client is verified against this rather than against a stubbed `fetch`, for the same
 * reason `tests/provider-adapters.test.js` drives the infrastructure adapters over a loopback socket:
 * the things worth pinning are the *wire* facts — which URL, which method, which bearer header, which
 * JSON body, and what the client does with each shape of answer — and a function-level mock hides
 * exactly those. Every request is recorded, so a test can also assert that a fail-closed path made
 * **no** request at all.
 *
 * It implements only the surface the platform calls, and it implements it honestly: pagination is
 * real, `result_info.total_pages` is computed, error envelopes carry Cloudflare's documented numeric
 * codes, and the GraphQL endpoint answers HTTP 200 with an `errors` array the way Cloudflare does.
 */
'use strict';

const http = require('node:http');

function startFakeCloudflare(options = {}) {
  const state = {
    token: options.token ?? 'cf-test-token-abcdefghijklmnop',
    zones: new Map(),
    records: new Map(), // zoneId -> array of records
    settings: new Map(), // zoneId -> { id: value }
    rules: new Map(), // zoneId -> array of rules
    dnssec: new Map(), // zoneId -> object
    purges: [],
    requests: [],
    sequence: 0,
    /** `{ '<method> <path-prefix>': { status, body } }` — forced failures for classification tests. */
    failures: options.failures ?? {},
    /** Milliseconds to hold a response, for the timeout test. */
    delayMs: options.delayMs ?? 0,
    /** When set, `/user/tokens/verify` reports this status instead of `active`. */
    tokenStatus: options.tokenStatus ?? 'active',
  };

  const envelope = (result, resultInfo) => JSON.stringify({
    success: true,
    errors: [],
    messages: [],
    result,
    ...(resultInfo ? { result_info: resultInfo } : {}),
  });
  const failure = (status, code, message) => JSON.stringify({
    success: false,
    errors: [{ code, message }],
    messages: [],
    result: null,
  });

  function seedZone({ id, name, status = 'pending', type = 'full', nameservers = ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'] }) {
    const zone = { id, name, status, type, paused: false, name_servers: nameservers, account: { id: 'acct-1' }, plan: { name: 'Free' }, created_on: '2026-01-01T00:00:00.000Z' };
    state.zones.set(id, zone);
    return zone;
  }

  function nextId(prefix) {
    state.sequence += 1;
    return `${prefix}-${String(state.sequence).padStart(4, '0')}`;
  }

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://127.0.0.1');
    let body = null;
    if (raw.length > 0) { try { body = JSON.parse(raw); } catch { body = raw; } }

    const record = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
      authorization: req.headers.authorization ?? null,
      contentType: req.headers['content-type'] ?? null,
    };
    state.requests.push(record);

    const send = (status, payload) => {
      const write = () => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(payload);
      };
      if (state.delayMs > 0) setTimeout(write, state.delayMs);
      else write();
    };

    const forced = state.failures[`${req.method} ${url.pathname}`];
    if (forced) return send(forced.status, forced.body ?? failure(forced.status, forced.code ?? 1000, forced.message ?? 'forced failure'));

    const path = url.pathname;
    const zoneMatch = /^\/zones\/([^/]+)$/.exec(path);
    const dnsCollection = /^\/zones\/([^/]+)\/dns_records$/.exec(path);
    const dnsItem = /^\/zones\/([^/]+)\/dns_records\/([^/]+)$/.exec(path);
    const settingsCollection = /^\/zones\/([^/]+)\/settings$/.exec(path);
    const settingsItem = /^\/zones\/([^/]+)\/settings\/([^/]+)$/.exec(path);
    const ruleCollection = /^\/zones\/([^/]+)\/firewall\/access_rules\/rules$/.exec(path);
    const ruleItem = /^\/zones\/([^/]+)\/firewall\/access_rules\/rules\/([^/]+)$/.exec(path);
    const dnssecItem = /^\/zones\/([^/]+)\/dnssec$/.exec(path);
    const purge = /^\/zones\/([^/]+)\/purge_cache$/.exec(path);

    // Auth: everything except a deliberately unauthenticated probe requires the right bearer token.
    if (path !== '/__probe' && req.headers.authorization !== `Bearer ${state.token}`) {
      return send(400, failure(400, 10000, 'Authentication error'));
    }

    if (path === '/user/tokens/verify' && req.method === 'GET') {
      return send(200, envelope({ id: 'token-id-1', status: state.tokenStatus }));
    }

    if (path === '/zones' && req.method === 'GET') {
      const name = url.searchParams.get('name');
      const zones = [...state.zones.values()].filter((z) => (name ? z.name === name : true));
      return send(200, envelope(zones, { page: 1, per_page: 100, count: zones.length, total_count: zones.length, total_pages: 1 }));
    }

    if (path === '/zones' && req.method === 'POST') {
      const zone = seedZone({ id: nextId('zone'), name: body.name, status: 'pending', type: body.type });
      return send(200, envelope(zone));
    }

    if (zoneMatch) {
      const zone = state.zones.get(zoneMatch[1]);
      if (!zone) return send(404, failure(404, 1049, 'zone not found'));
      if (req.method === 'GET') return send(200, envelope(zone));
      if (req.method === 'PATCH') {
        if (body.paused !== undefined && zone.type !== 'partial') {
          return send(400, failure(400, 1220, 'Setting paused is not available for this zone type'));
        }
        Object.assign(zone, body);
        return send(200, envelope(zone));
      }
      if (req.method === 'DELETE') {
        state.zones.delete(zoneMatch[1]);
        return send(200, envelope({ id: zoneMatch[1] }));
      }
    }

    if (dnsCollection) {
      const zoneId = dnsCollection[1];
      const list = state.records.get(zoneId) ?? [];
      if (req.method === 'GET') {
        const perPage = Number(url.searchParams.get('per_page') ?? 100);
        const page = Number(url.searchParams.get('page') ?? 1);
        const start = (page - 1) * perPage;
        const slice = list.slice(start, start + perPage);
        return send(200, envelope(slice, {
          page, per_page: perPage, count: slice.length, total_count: list.length,
          total_pages: Math.max(1, Math.ceil(list.length / perPage)),
        }));
      }
      if (req.method === 'POST') {
        if (list.some((r) => r.type === body.type && r.name === body.name && r.content === body.content)) {
          return send(400, failure(400, 81057, 'The record already exists.'));
        }
        const created = {
          id: nextId('rec'), type: body.type, name: body.name, content: body.content,
          ttl: body.ttl ?? 1, proxied: body.proxied ?? false, priority: body.priority ?? null,
          comment: body.comment ?? null, source: body.source ?? 'user',
          ...(body.source === 'cloudflare' ? { meta: { managed_by_apps: true } } : {}),
        };
        list.push(created);
        state.records.set(zoneId, list);
        return send(200, envelope(created));
      }
    }

    if (dnsItem) {
      const list = state.records.get(dnsItem[1]) ?? [];
      const index = list.findIndex((r) => r.id === dnsItem[2]);
      if (index === -1) return send(404, failure(404, 81044, 'Record does not exist.'));
      if (req.method === 'PATCH') {
        list[index] = { ...list[index], ...body };
        return send(200, envelope(list[index]));
      }
      if (req.method === 'DELETE') {
        list.splice(index, 1);
        return send(200, envelope({ id: dnsItem[2] }));
      }
    }

    if (settingsCollection && req.method === 'GET') {
      const entries = Object.entries(state.settings.get(settingsCollection[1]) ?? {})
        .map(([id, value]) => ({ id, value, editable: true }));
      return send(200, envelope(entries, { page: 1, per_page: 100, count: entries.length, total_count: entries.length, total_pages: 1 }));
    }

    if (settingsItem && req.method === 'PATCH') {
      const zoneSettings = state.settings.get(settingsItem[1]) ?? {};
      zoneSettings[settingsItem[2]] = body.value;
      state.settings.set(settingsItem[1], zoneSettings);
      return send(200, envelope({ id: settingsItem[2], value: body.value, editable: true }));
    }

    if (ruleCollection) {
      const zoneId = ruleCollection[1];
      const list = state.rules.get(zoneId) ?? [];
      if (req.method === 'GET') {
        return send(200, envelope(list, { page: 1, per_page: 100, count: list.length, total_count: list.length, total_pages: 1 }));
      }
      if (req.method === 'POST') {
        const created = {
          id: nextId('rule'), mode: body.mode, notes: body.notes ?? null,
          configuration: body.configuration, created_on: '2026-01-01T00:00:00.000Z',
        };
        list.push(created);
        state.rules.set(zoneId, list);
        return send(200, envelope(created));
      }
    }

    if (ruleItem) {
      const list = state.rules.get(ruleItem[1]) ?? [];
      const index = list.findIndex((r) => r.id === ruleItem[2]);
      if (index === -1) return send(404, failure(404, 1002, 'rule not found'));
      if (req.method === 'PATCH') {
        list[index] = { ...list[index], ...(body.mode ? { mode: body.mode } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}) };
        return send(200, envelope(list[index]));
      }
      if (req.method === 'DELETE') {
        list.splice(index, 1);
        return send(200, envelope({ id: ruleItem[2] }));
      }
    }

    if (dnssecItem) {
      const zoneId = dnssecItem[1];
      if (req.method === 'GET') {
        const current = state.dnssec.get(zoneId);
        if (!current) return send(404, failure(404, 1002, 'DNSSEC is not enabled'));
        return send(200, envelope(current));
      }
      if (req.method === 'POST') {
        const created = {
          status: 'pending', algorithm: '13', digest_algorithm: '2', digest_type: '2',
          ds: 'example.com. 3600 IN DS 2371 13 2 ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789',
          key_tag: 2371, flags: 257, modified_on: '2026-01-02T00:00:00.000Z',
        };
        state.dnssec.set(zoneId, created);
        return send(200, envelope(created));
      }
      if (req.method === 'PATCH') {
        const current = state.dnssec.get(zoneId) ?? {};
        const updated = { ...current, status: body.status };
        state.dnssec.set(zoneId, updated);
        return send(200, envelope(updated));
      }
    }

    if (purge && req.method === 'POST') {
      const targets = ['everything', 'files', 'tags', 'hosts'].filter((key) => body[key] !== undefined);
      if (targets.length !== 1) return send(400, failure(400, 1001, `Exactly one of everything/files/tags/hosts is required, received ${targets.length}`));
      state.purges.push({ zoneId: purge[1], body });
      return send(200, envelope({ id: nextId('purge') }));
    }

    if (path === '/graphql' && req.method === 'POST') {
      if (options.graphqlErrors) {
        // Cloudflare answers HTTP 200 with an `errors` array — the shape `readEnvelope` must treat as
        // authoritative rather than as success.
        return send(200, JSON.stringify({ data: null, errors: [{ message: 'invalid query' }] }));
      }
      const days = body?.variables?.limit ?? 7;
      const groups = Array.from({ length: days }, (_, index) => ({
        dimensions: { date: `2026-01-0${index + 1}` },
        sum: index === days - 1
          // A day Cloudflare has no datapoints for: every metric null, never zero-filled.
          ? { requests: null, bytes: null, threats: null, cachedRequests: null }
          : { requests: 100 + index, bytes: 1000 + index, threats: 1, cachedRequests: 50 },
      }));
      return send(200, envelope({ data: { viewer: { zones: [{ httpRequests1dGroups: groups }] } } }));
    }

    return send(404, failure(404, 7003, `Could not route to ${path}`));
  });

  return {
    state,
    seedZone,
    async listen() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();
      return { port, baseUrl: `http://127.0.0.1:${port}` };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
    requestsFor(path) {
      return state.requests.filter((r) => r.path === path);
    },
  };
}

module.exports = { startFakeCloudflare };
