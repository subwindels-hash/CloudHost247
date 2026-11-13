// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminAiKnowledgePage from '../../src/pages/AdminAiKnowledgePage';
import { apiFetch } from '../../src/lib/api';
vi.mock('../../src/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('../../src/layout/useAuthState', () => ({ useAuthState: () => ({ user: { role: 'staff' } }) }));
vi.mock('../../src/lib/usePageMeta', () => ({ usePageMeta: () => undefined }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('knowledge dashboard trust health presentation', () => {
  it('renders server measurements once, labels limits, and does not imply empty gaps mean universal success', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (String(url).includes('/overview')) return {
        overview: { totals: {}, byKind: [], lastRun: null, failed: 2, stale: 3, chunks: 20 },
        drift: { changed: [], missing: [], unexpected: [] }, groups: {}, exclusions: [], failures: [], runs: [],
        engine: { phrasing: 'retrieval', modelConfigured: false, modelReason: null, embedding: 'lexical' },
        trust: { healthy: 7, unavailable: 2, stale: 3, conflicting: 2,
          sources: [{ id: 'source-fixture', authority: 1, approval: 'approved', freshness: 'current' }],
          conflicts: [{ sourceIds: ['a','b'], status: 'unresolved' }] }, humanEscalations: 4,
      } as any;
      if (String(url).includes('/gaps')) return { lowConfidence: [], unanswered: [], disliked: [], feedback: [], coverage: { answers: '0', grounded: '0', ungrounded: '0' } } as any;
      return { sources: [] } as any;
    });
    render(<AdminAiKnowledgePage />);
    expect(await screen.findByText(/Healthy synchronization: 7/)).toBeTruthy();
    expect(screen.getAllByRole('region', { name: 'Source trust health' })).toHaveLength(1);
    expect(screen.getByText(/Healthy synchronization is not human approval/)).toBeTruthy();
    expect(screen.getByText(/does not imply every question was answered/)).toBeTruthy();
    expect(screen.getByText('unresolved: a, b')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reindex everything' })).toBeNull();
  });
  it('reports API failure rather than fabricating zero healthy/conflicting sources', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('Knowledge overview unavailable'));
    render(<AdminAiKnowledgePage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Knowledge overview unavailable');
    expect(screen.queryByRole('region', { name: 'Source trust health' })).toBeNull();
  });
});
