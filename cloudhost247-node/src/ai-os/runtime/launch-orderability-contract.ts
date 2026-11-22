/** Narrow output contract for the read-only website-launch tool. Not a provider verification. */
import { z } from 'zod';
import { BILLING_CYCLES } from '../../whmcs/types';
import { LAUNCH_SERVICE_KEYS } from '../../whmcs/agent-orderability';

const cartUrl = z.string().max(2048).url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch { return false; }
});

/** Unknown properties are stripped before any tool result is stored or returned. */
export const launchOrderabilitySchema = z.object({
  verdict: z.object({
    serviceKey: z.enum(LAUNCH_SERVICE_KEYS),
    state: z.enum(['orderable', 'not-integrated', 'unavailable']),
    orderable: z.boolean(),
    reasonCode: z.enum(['ORDERABLE', 'NOT_INTEGRATED', 'WHMCS_DISABLED', 'MAP_INVALID', 'PRODUCT_NOT_IN_CATALOGUE', 'NO_CYCLES_OFFERED', 'CURRENCY_UNAVAILABLE', 'UPSTREAM_UNAVAILABLE']),
    productName: z.string().trim().min(1).max(255).nullable(),
    cycles: z.array(z.object({
      cycle: z.enum(BILLING_CYCLES),
      price: z.string().max(32).regex(/^\d+(?:\.\d{1,6})?$/),
      setupFee: z.string().max(32).regex(/^\d+(?:\.\d{1,6})?$/),
      currency: z.string().regex(/^[A-Z]{3}$/),
      cartUrl,
    })).max(BILLING_CYCLES.length),
  }),
  checkedAt: z.string().datetime(),
}).superRefine(({ verdict }, ctx) => {
  const cycles = verdict.cycles;
  const consistent = verdict.state === 'orderable'
    ? verdict.orderable && verdict.reasonCode === 'ORDERABLE' && verdict.productName !== null && cycles.length > 0 &&
      new Set(cycles.map((c) => c.cycle)).size === cycles.length && new Set(cycles.map((c) => c.currency)).size === 1
    : !verdict.orderable && verdict.productName === null && cycles.length === 0 &&
      (verdict.state === 'not-integrated' ? verdict.reasonCode === 'NOT_INTEGRATED' : !['ORDERABLE', 'NOT_INTEGRATED'].includes(verdict.reasonCode));
  if (!consistent) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent orderability verdict' });
});
