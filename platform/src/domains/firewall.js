/**
 * Firewall (per-server).
 *
 * Ported from cloudhost247-node/src/routes/firewall.ts. The original deliberately refuses this
 * surface: firewall rows exist for schema/audit compatibility, but applying them needs a provider
 * or authenticated server-agent integration that does not exist. Presenting stored rows as an
 * active network policy would be a lie, so every route verifies ownership and then refuses with a
 * clear 400. When a provider/agent adapter lands, these handlers become real.
 */
'use strict';

const { NotFoundError, ValidationError } = require('../core/errors');
const { authenticate } = require('../lib/auth');

const name = 'firewall';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseId(value, label = 'id') {
  if (!UUID_RE.test(String(value))) throw new ValidationError(`A valid ${label} is required`);
  return String(value);
}

function refuseUnmanagedFirewall() {
  throw new ValidationError(
    'Managed firewall is unavailable because no provider or authenticated-agent firewall integration is configured'
  );
}

function register(router, deps) {
  const { store } = deps;

  async function requireOwnedServer(ctx, rawId) {
    const auth = await authenticate(ctx, deps);
    const server = await store.table('servers').findById(parseId(rawId, 'server id'));
    if (!server || server.user_id !== auth.id) throw new NotFoundError('Server not found');
    return server;
  }

  router.get('/api/v1/servers/:serverId/firewall', async (ctx) => {
    await requireOwnedServer(ctx, ctx.params.serverId);
    return refuseUnmanagedFirewall();
  });

  router.post('/api/v1/servers/:serverId/firewall', async (ctx) => {
    await requireOwnedServer(ctx, ctx.params.serverId);
    return refuseUnmanagedFirewall();
  });

  router.delete('/api/v1/servers/:serverId/firewall/:ruleId', async (ctx) => {
    parseId(ctx.params.ruleId, 'rule id');
    await requireOwnedServer(ctx, ctx.params.serverId);
    return refuseUnmanagedFirewall();
  });

  router.post('/api/v1/servers/:serverId/firewall/baseline', async (ctx) => {
    await requireOwnedServer(ctx, ctx.params.serverId);
    return refuseUnmanagedFirewall();
  });
}

module.exports = { name, register };
