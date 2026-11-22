import { describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({ compose: vi.fn(), retrieve: vi.fn() }));
vi.mock('../../src/ai-website/answer-composer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ai-website/answer-composer')>()),
  composeAnswer: spies.compose,
}));
vi.mock('../../src/ai-website/retrieval', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ai-website/retrieval')>()),
  retrieveKnowledge: spies.retrieve,
}));
import { decideSupportResponse } from '../../src/services/ai-support-operator';

const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as any;
const facts = { available: false, prices: [] } as any;

describe('support model disclosure boundary', () => {
  it('passes an explicit model opt-in only when its caller explicitly sets true', async () => {
    spies.retrieve.mockResolvedValue({ verificationFailure: null, understanding: {}, pages: [], trustTrace: {} });
    spies.compose.mockResolvedValue({ kind: 'ESCALATE', body: 'Support can help.', intent: 'unknown', confidence: 0, engine: 'retrieval' });
    for (const [option, expected] of [[undefined, false], [false, false], [true, true]] as const) {
      spies.compose.mockClear();
      await decideSupportResponse(db, 'What is cloud hosting?', { facts, allowModel: option });
      expect(spies.compose).toHaveBeenCalledTimes(1);
      expect(spies.compose.mock.calls[0]![2]).toMatchObject({ allowModel: expected });
    }
  });
});
