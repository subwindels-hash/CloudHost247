import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, ValidationError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import { findCustomerServerById } from '../db/server-provisioning';
import {
  listFirewallRulesForServer,
  findFirewallRuleById,
  createFirewallRule,
  deleteFirewallRule,
  applyBaselineFirewallForServer,
} from '../db/firewall';

const idSchema = z.string().uuid();

const createRuleSchema = z.object({
  protocol: z.enum(['tcp', 'udp', 'icmp', 'any']).optional(),
  portRangeStart: z.coerce.number().int().min(1).max(65535),
  portRangeEnd: z.coerce.number().int().min(1).max(65535).optional(),
  direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
  sourceCidr: z.string().min(3).max(64).optional(),
  action: z.enum(['ALLOW', 'DROP', 'REJECT']).optional(),
  description: z.string().max(500).optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues.map((i) => i.message).join(', '));
  return result.data;
}

export async function registerFirewallRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable
) {
  const pool = overridePool ?? getPool(env);

  app.get<{ Params: { serverId: string } }>('/api/v1/servers/:serverId/firewall', async (request) => {
    const auth = await authenticate(request, env, pool);
    const serverId = parseOrThrow(idSchema, request.params.serverId);
    const server = await findCustomerServerById(pool, serverId);
    if (!server || server.customer_id !== auth.userId) throw new NotFoundError('Server not found');

    const rules = await listFirewallRulesForServer(pool, serverId);
    return { rules };
  });

  app.post<{ Params: { serverId: string } }>('/api/v1/servers/:serverId/firewall', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const serverId = parseOrThrow(idSchema, request.params.serverId);
    const server = await findCustomerServerById(pool, serverId);
    if (!server || server.customer_id !== auth.userId) throw new NotFoundError('Server not found');

    const input = parseOrThrow(createRuleSchema, request.body);
    const rule = await createFirewallRule(pool, {
      serverId,
      protocol: input.protocol,
      portRangeStart: input.portRangeStart,
      portRangeEnd: input.portRangeEnd,
      direction: input.direction,
      sourceCidr: input.sourceCidr,
      action: input.action,
      description: input.description,
    });

    await auditRequest(pool, request, auth.userId, {
      action: 'FIREWALL_RULE_CREATED',
      resourceType: 'firewall_rule',
      resourceId: rule.id,
      metadata: { serverId, port: rule.port_range_start, protocol: rule.protocol },
    });

    reply.code(201);
    return { rule };
  });

  app.delete<{ Params: { serverId: string; ruleId: string } }>(
    '/api/v1/servers/:serverId/firewall/:ruleId',
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const serverId = parseOrThrow(idSchema, request.params.serverId);
      const ruleId = parseOrThrow(idSchema, request.params.ruleId);

      const server = await findCustomerServerById(pool, serverId);
      if (!server || server.customer_id !== auth.userId) throw new NotFoundError('Server not found');

      const existingRule = await findFirewallRuleById(pool, ruleId);
      if (!existingRule || existingRule.server_id !== serverId) {
        throw new NotFoundError('Firewall rule not found for this server');
      }

      await deleteFirewallRule(pool, ruleId);
      await auditRequest(pool, request, auth.userId, {
        action: 'FIREWALL_RULE_DELETED',
        resourceType: 'firewall_rule',
        resourceId: ruleId,
        metadata: { serverId },
      });

      reply.code(204);
      return null;
    }
  );

  app.post<{ Params: { serverId: string } }>(
    '/api/v1/servers/:serverId/firewall/baseline',
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const serverId = parseOrThrow(idSchema, request.params.serverId);
      const server = await findCustomerServerById(pool, serverId);
      if (!server || server.customer_id !== auth.userId) throw new NotFoundError('Server not found');

      const rules = await applyBaselineFirewallForServer(pool, serverId, server.control_panel_slug);
      await auditRequest(pool, request, auth.userId, {
        action: 'FIREWALL_BASELINE_APPLIED',
        resourceType: 'server',
        resourceId: serverId,
        metadata: { panelSlug: server.control_panel_slug, rulesCount: rules.length },
      });

      reply.code(201);
      return { rules };
    }
  );
}
