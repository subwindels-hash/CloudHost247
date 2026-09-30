import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, ValidationError } from '../lib/errors';
import { findCustomerServerById } from '../db/server-provisioning';

const idSchema = z.string().uuid();

function parseId(value: unknown): string {
  const result=idSchema.safeParse(value);
  if(!result.success)throw new ValidationError('A valid server id is required');
  return result.data;
}

/**
 * Firewall database rows are retained for schema/audit compatibility, but no provider adapter or
 * authenticated server-agent endpoint applies them yet. Refuse the surface rather than presenting
 * desired PostgreSQL state as an active network policy.
 */
function refuseUnmanagedFirewall(): never {
  throw new ValidationError(
    'Managed firewall is unavailable because no provider or authenticated-agent firewall integration is configured'
  );
}

export async function registerFirewallRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable
) {
  const pool=overridePool??getPool(env);

  async function requireOwnedServer(request: Parameters<typeof authenticate>[0],rawId:unknown) {
    const auth=await authenticate(request,env,pool);
    const server=await findCustomerServerById(pool,parseId(rawId));
    if(!server||server.customer_id!==auth.userId)throw new NotFoundError('Server not found');
  }

  app.get<{Params:{serverId:string}}>('/api/v1/servers/:serverId/firewall',async(request)=>{
    await requireOwnedServer(request,request.params.serverId);
    return refuseUnmanagedFirewall();
  });
  app.post<{Params:{serverId:string}}>('/api/v1/servers/:serverId/firewall',async(request)=>{
    await requireOwnedServer(request,request.params.serverId);
    return refuseUnmanagedFirewall();
  });
  app.delete<{Params:{serverId:string;ruleId:string}}>('/api/v1/servers/:serverId/firewall/:ruleId',async(request)=>{
    parseId(request.params.ruleId);
    await requireOwnedServer(request,request.params.serverId);
    return refuseUnmanagedFirewall();
  });
  app.post<{Params:{serverId:string}}>('/api/v1/servers/:serverId/firewall/baseline',async(request)=>{
    await requireOwnedServer(request,request.params.serverId);
    return refuseUnmanagedFirewall();
  });
}
