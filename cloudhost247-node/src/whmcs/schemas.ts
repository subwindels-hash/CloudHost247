/**
 * Validated shapes for the WHMCS API actions this project relies on.
 *
 * WHMCS is famously permissive about what it returns: numbers arrive as strings, an empty product
 * list can be `[]` or `{}`, and a cycle that is not offered appears as the string "-1" rather than
 * being omitted. Every one of those is handled here, once, so route code never has to.
 *
 * `z.looseObject` keeps unknown keys — WHMCS adds fields between minor versions and a strict schema
 * would break on an upgrade for no security benefit. The fields this project *uses* are required.
 */

import { z } from 'zod';
import { BILLING_CYCLES } from './types';

const numericString = z.union([z.string(), z.number()]).transform((v) => String(v));

const cycleValue = z.union([z.string(), z.number(), z.null()]).optional();

export const pricingSchema = z.looseObject({
  prefix: z.string().optional().default(''),
  suffix: z.string().optional().default(''),
  monthly: cycleValue,
  quarterly: cycleValue,
  semiannually: cycleValue,
  annually: cycleValue,
  biennially: cycleValue,
  triennially: cycleValue,
  msetupfee: cycleValue,
  qsetupfee: cycleValue,
  ssetupfee: cycleValue,
  asetupfee: cycleValue,
  bsetupfee: cycleValue,
  tsetupfee: cycleValue,
});

/**
 * `GetProducts` — one row per product. `pricing` is keyed by currency code in WHMCS 8.x; older
 * installs return a single object for the default currency, which `normalizeProducts` treats as the
 * default currency's prices.
 */
export const productSchema = z.looseObject({
  pid: numericString,
  gid: numericString,
  name: z.string(),
  description: z.string().optional().default(''),
  module: z.string().optional().default(''),
  paytype: z.string().optional().default(''),
  hidden: z.union([z.string(), z.number(), z.boolean()]).optional(),
  pricing: z.union([z.record(z.string(), pricingSchema), pricingSchema]),
});

export const getProductsSchema = z.looseObject({
  result: z.literal('success'),
  totalresults: z.union([z.string(), z.number()]).optional(),
  products: z.array(z.looseObject({})).optional(), // tolerate objects-with-string-keys; see `toArray`
});

export const getProductGroupsSchema = z.looseObject({
  result: z.literal('success'),
  totalresults: z.union([z.string(), z.number()]).optional(),
  productgroups: z.union([z.array(z.looseObject({})), z.record(z.string(), z.looseObject({}))]).optional(),
});

export const groupSchema = z.looseObject({
  id: numericString,
  name: z.string(),
  hidden: z.union([z.string(), z.number(), z.boolean()]).optional(),
  order: z.union([z.string(), z.number()]).optional(),
});

export const currencySchema = z.looseObject({
  id: numericString,
  code: z.string().min(1),
  prefix: z.string().optional().default(''),
  suffix: z.string().optional().default(''),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const getCurrenciesSchema = z.looseObject({
  result: z.literal('success'),
  currencies: z.union([z.array(z.looseObject({})), z.record(z.string(), z.looseObject({}))]).optional(),
});

/**
 * `GetClients` — used only by the SSO link flow, to find a WHMCS client by an *exact* email match.
 *
 * `GetClientsDetails` would be the obvious call, but it takes either `clientid` or `email` and
 * returns whichever single client matches first. When two clients share an address, that silently
 * links one of them. `GetClients` returns a list, so the caller can insist on exactly one match and
 * refuse otherwise. Only the two fields needed for that decision are required; the rest of the row
 * (address, phone, card details) is deliberately not part of this shape.
 */
export const clientSummarySchema = z.looseObject({
  id: numericString,
  email: z.string().optional().default(''),
});

export const getClientsSchema = z.looseObject({
  result: z.literal('success'),
  totalresults: z.union([z.string(), z.number()]).optional(),
  // WHMCS wraps the list as `clients: { client: [ ... ] }`; older/edge responses use a bare array or
  // a numeric-keyed object. `normalizeClientRows` handles all three, so this stays `unknown`.
  clients: z.unknown().optional(),
});

/**
 * `CreateSsoToken` — the response carries a 60-second, single-use access token.
 *
 * `redirect_url` is *prepared by WHMCS* and is the only URL this platform will hand to a browser;
 * `cart.ts`-style local construction of an SSO URL would be guessing at WHMCS's redemption endpoint.
 * `access_token` is optional here because `redirect_url` already embeds it — if WHMCS ever stops
 * returning the separate field, the hand-off still works.
 */
export const ssoTokenSchema = z.looseObject({
  result: z.literal('success'),
  access_token: z.string().min(8).optional(),
  redirect_url: z.string().min(1),
});

/** The envelope every WHMCS action answers with when it fails. */
export const errorEnvelopeSchema = z.looseObject({
  result: z.literal('error'),
  message: z.string().optional().default('WHMCS reported an error without a message'),
});

/**
 * WHMCS returns some collections as `{ "0": {...}, "1": {...} }` and others as `[...]`. Both are
 * normalised here rather than at each call site.
 */
export function toArray<T>(value: T[] | Record<string, T> | undefined | null): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Object.values(value);
}

export const CYCLE_SETUP_KEY: Record<(typeof BILLING_CYCLES)[number], string> = {
  monthly: 'msetupfee',
  quarterly: 'qsetupfee',
  semiannually: 'ssetupfee',
  annually: 'asetupfee',
  biennially: 'bsetupfee',
  triennially: 'tsetupfee',
};
