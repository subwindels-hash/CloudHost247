import { describe, expect, it } from 'vitest';
import { launchOrderabilitySchema } from '../../src/ai-os/runtime/launch-orderability-contract';

const valid = () => ({ verdict: {
  serviceKey: 'hosting-wordpress', state: 'orderable', orderable: true, reasonCode: 'ORDERABLE', productName: 'Example',
  cycles: [{ cycle: 'monthly', price: '9.00', setupFee: '0.00', currency: 'USD', cartUrl: 'https://billing.example.test/cart.php?a=add' }],
}, checkedAt: '2026-01-01T00:00:00.000Z' });

describe('website launch tool output contract', () => {
  it('strips extraneous upstream fields at all object levels', () => {
    const input = valid();
    const parsed = launchOrderabilitySchema.parse({ ...input, secret: 'top-secret', verdict: { ...input.verdict, reason: 'private', extra: 'secret', cycles: [{ ...input.verdict.cycles[0], token: 'private' }] } });
    expect(JSON.stringify(parsed)).not.toContain('secret');
    expect(JSON.stringify(parsed)).not.toContain('private');
  });
  it.each([
    ['unsafe URL', (v: ReturnType<typeof valid>) => { v.verdict.cycles[0]!.cartUrl = 'javascript:alert(1)'; }],
    ['URL credentials', (v: ReturnType<typeof valid>) => { v.verdict.cycles[0]!.cartUrl = 'https://user:password@billing.example.test/cart'; }],
    ['unknown cycle', (v: ReturnType<typeof valid>) => { v.verdict.cycles[0]!.cycle = 'hourly'; }],
    ['negative price', (v: ReturnType<typeof valid>) => { v.verdict.cycles[0]!.price = '-1.00'; }],
    ['duplicate cycle', (v: ReturnType<typeof valid>) => { v.verdict.cycles.push({ ...v.verdict.cycles[0]! }); }],
    ['mixed currencies', (v: ReturnType<typeof valid>) => { v.verdict.cycles.push({ ...v.verdict.cycles[0]!, cycle: 'annually', currency: 'EUR' }); }],
    ['contradictory state', (v: ReturnType<typeof valid>) => { v.verdict.orderable = false; }],
    ['unsupported reason', (v: ReturnType<typeof valid>) => { v.verdict.reasonCode = 'SOME_PRIVATE_ERROR'; }],
    ['invalid category', (v: ReturnType<typeof valid>) => { v.verdict.serviceKey = 'hosting-unknown'; }],
  ])('rejects %s', (_label, mutate) => {
    const input = valid(); mutate(input);
    expect(launchOrderabilitySchema.safeParse(input).success).toBe(false);
  });
  it('rejects nonorderable results carrying a purchasable cycle', () => {
    const input = valid();
    Object.assign(input.verdict, { state: 'unavailable', orderable: false, reasonCode: 'UPSTREAM_UNAVAILABLE', productName: null });
    expect(launchOrderabilitySchema.safeParse(input).success).toBe(false);
  });
});
