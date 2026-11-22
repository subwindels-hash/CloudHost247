import { describe, expect, it } from 'vitest';
import { prepareWorkflowSteps } from '../../src/ai-os/workflows/workflow-contract';

const id = '3a490d3b-b47a-4728-8ebf-4dc74df52761';
const step = { agent_slug: 'collector', task_type: 'billing.overdue_digest', subject_from: 'invoiceId', subject_type: 'invoice', customer_from: 'customerId', input: { focusInvoiceId: '{{invoiceId}}', limit: 25 } };

describe('workflow preflight contract', () => {
  it('resolves the seeded shape while preserving event content as data', () => {
    const resolved = prepareWorkflowSteps([step], { invoiceId: id, customerId: id });
    expect(resolved[0]).toMatchObject({ subjectId: id, customerId: id, input: { focusInvoiceId: id, limit: 25 }, priority: 'normal' });
    expect(prepareWorkflowSteps([{ ...step, input: { value: '{{value}}' } }], { invoiceId: id, customerId: id, value: '{{not-a-template}}' })[0]!.input.value).toBe('{{not-a-template}}');
  });
  it('rejects invalid or ambiguous definitions', () => {
    const definitions = [
      [], [step, step], Array.from({ length: 21 }, (_, i) => ({ agent_slug: `agent-${i}`, task_type: 'x' })),
      [{ ...step, unknown: true }], [{ ...step, priority: 'extreme' }], [{ ...step, subject_from: 'constructor' }],
      [{ ...step, input: { name: 'prefix {{invoiceId}}' } }], [{ ...step, input: { nested: { value: '{{invoiceId}}' } } }],
      [{ ...step, input: { value: '{{__proto__}}' } }], [{ ...step, input: JSON.parse('{"__proto__":"polluted"}') }],
      [{ ...step, input: { value: 'x'.repeat(32769) } }],
    ];
    for (const definition of definitions) expect(() => prepareWorkflowSteps(definition, { invoiceId: id, customerId: id })).toThrow();
  });
  it('requires own, non-null mapped values and UUID scope references', () => {
    for (const payload of [{ customerId: id }, { invoiceId: null, customerId: id }, { invoiceId: 'not-a-uuid', customerId: id }, Object.assign(Object.create({ invoiceId: id }), { customerId: id })]) {
      expect(() => prepareWorkflowSteps([step], payload)).toThrow();
    }
    expect(() => prepareWorkflowSteps([step], [])).toThrow();
    expect(() => prepareWorkflowSteps([{ ...step, input: { value: '{{missing}}' } }], { invoiceId: id, customerId: id })).toThrow();
  });
});
