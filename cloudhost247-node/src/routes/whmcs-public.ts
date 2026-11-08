/**
 * B2.4 — the public orderability endpoint.
 *
 * One question, asked by every hosting page: *may this service be bought online right now, and in
 * which cycles?* The answer is computed by `src/whmcs/orderability.ts` from the checksummed product
 * map and a live WHMCS catalogue; this file is only the HTTP skin around it.
 *
 * Deliberate properties:
 *
 *  - **Public and unauthenticated.** It exposes prices WHMCS already publishes on its own storefront;
 *    it exposes nothing about a customer.
 *  - **The client cannot influence the verdict.** The only accepted inputs are which service keys to
 *    describe and which configured currency to price in. `pid`, `price`, `orderable`, `force` and
 *    friends are dropped by the query schema, and no request value reaches `decideOrderability`.
 *  - **Never a 500 for a WHMCS problem.** A page that cannot reach WHMCS renders without a buy
 *    button and with a stated reason (`WHMCS_DISABLED`, `UPSTREAM_UNAVAILABLE`, …), because a plan
 *    card with no button is honest and an error page is not.
 *  - **Fail closed on a broken map.** If `config/whmcs/product-map.json` is missing, hand-edited or
 *    fails its checksum, every service reports `MAP_INVALID` — no orderable verdict is reachable.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import path from 'node:path';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { ValidationError } from '../lib/errors';
import {
  WhmcsClient,
  WhmcsMapInvalidError,
  consoleLogger,
  createCatalogueLoader,
  decideMany,
  catalogueFailure,
  knownServiceKeys,
  loadWhmcsConfig,
  readProductMapFile,
  type OrderabilityReasonCode,
  type ProductMapDocument,
  type WhmcsConfigResult,
  type NormalizedCatalogue,
} from '../whmcs';

const MAX_SERVICE_KEYS = 60;

const querySchema = z.object({
  services: z.string().max(2_000).optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'currency must be a three-letter code')
    .optional(),
});

const paramSchema = z.object({
  serviceKey: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/, 'unknown service key'),
});

export interface WhmcsPublicRouteDeps {
  /** Test seam: fixed configuration instead of `process.env`. */
  whmcsConfig?: WhmcsConfigResult;
  /** Test seam: a client backed by a scripted transport. */
  whmcsClient?: WhmcsClient;
  /** Test seam: a different product-map file. Defaults to `<cwd>/config/whmcs/product-map.json`. */
  mapPath?: string;
  /** Catalogue cache lifetime in ms. Tests pass 0 to disable sharing. */
  catalogueTtlMs?: number;
  now?: () => number;
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  }
  return parsed.data;
}

/** Splits and de-duplicates the `services` query parameter, bounded. */
function parseServiceKeys(raw: string | undefined): string[] | null {
  if (!raw || raw.trim() === '') return null;
  const keys = raw
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  if (keys.length > MAX_SERVICE_KEYS) {
    throw new ValidationError(`at most ${MAX_SERVICE_KEYS} service keys may be requested at once`);
  }
  for (const key of keys) {
    if (!/^[a-z0-9-]{1,120}$/.test(key)) throw new ValidationError(`"${key}" is not a service key`);
  }
  return [...new Set(keys)];
}

export async function registerWhmcsPublicRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable,
  deps: WhmcsPublicRouteDeps = {},
) {
  // Every route on this surface is anonymous, so neither the pool nor `env` is consulted. Both stay
  // in the signature so the registrar matches its siblings (and so a later authenticated neighbour
  // can reuse this file) without changing every call site.
  const configResult: WhmcsConfigResult = deps.whmcsConfig ?? loadWhmcsConfig(process.env);
  const client: WhmcsClient | null =
    deps.whmcsClient ??
    (configResult.enabled ? new WhmcsClient({ config: configResult.config, logger: consoleLogger }) : null);
  const loader = client ? createCatalogueLoader(client, { ttlMs: deps.catalogueTtlMs, now: deps.now }) : null;

  // Read once at registration: the map is a committed, checksummed artifact, and re-reading a file
  // on every page view would only add a way for it to change under a running process.
  const mapPath = deps.mapPath ?? path.join(process.cwd(), 'config', 'whmcs', 'product-map.json');
  let map: ProductMapDocument | null = null;
  let mapError: string | null = null;
  try {
    map = readProductMapFile(mapPath);
  } catch (error) {
    mapError = error instanceof WhmcsMapInvalidError ? error.message : 'product map could not be read';
    app.log.warn({ event: 'whmcs.productMap.unreadable', path: mapPath, reason: mapError });
  }

  async function catalogueFor(currency: string | undefined): Promise<{
    catalogue: NormalizedCatalogue | null;
    unavailable: { code: OrderabilityReasonCode; reason?: string } | null;
  }> {
    if (!configResult.enabled || !loader) {
      return {
        catalogue: null,
        unavailable: { code: 'WHMCS_DISABLED', reason: configResult.enabled ? undefined : configResult.reason },
      };
    }
    try {
      return { catalogue: await loader.load(currency), unavailable: null };
    } catch (error) {
      return { catalogue: null, unavailable: catalogueFailure(error) };
    }
  }

  async function respond(rawQuery: unknown, keys: string[] | null, reply: FastifyReply) {
    const query = parseOrThrow(querySchema, rawQuery);
    const requested = keys ?? parseServiceKeys(query.services);

    if (!map) {
      const serviceKeys = requested ?? [];
      return {
        configured: configResult.enabled,
        mapValid: false,
        currency: null,
        generatedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
        services: serviceKeys.map((serviceKey) => ({
          serviceKey,
          state: 'unavailable' as const,
          orderable: false,
          reasonCode: 'MAP_INVALID' as const,
          reason: 'Online ordering is temporarily unavailable.',
          currency: null,
          productId: null,
          productName: null,
          cycles: [],
        })),
      };
    }

    const serviceKeys = requested ?? knownServiceKeys(map);
    const { catalogue, unavailable } = await catalogueFor(query.currency);
    const cart = configResult.enabled
      ? { baseUrl: configResult.config.baseUrl, cartPath: configResult.config.cartPath }
      : { baseUrl: 'https://invalid.invalid', cartPath: 'cart.php' };

    const services = decideMany({ map, catalogue, serviceKeys, unavailable, cart });

    // Prices are public and change rarely; a short shared cache is safe because WHMCS re-validates
    // the product and price when the cart is opened.
    reply.header('cache-control', 'public, max-age=30');
    return {
      configured: configResult.enabled,
      mapValid: true,
      currency: catalogue?.currency ?? null,
      generatedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
      services,
    };
  }

  app.get(
    '/api/v1/whmcs/orderability',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => respond(request.query, null, reply),
  );

  app.get<{ Params: { serviceKey: string } }>(
    '/api/v1/whmcs/orderability/:serviceKey',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { serviceKey } = parseOrThrow(paramSchema, request.params);
      // Same envelope as the list form (one shape for the client to parse), with exactly one entry.
      const body = await respond(request.query, [serviceKey], reply);
      return { ...body, services: body.services.slice(0, 1) };
    },
  );
}
