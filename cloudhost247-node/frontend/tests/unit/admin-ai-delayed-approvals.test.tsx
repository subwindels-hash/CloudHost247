// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAiCommandPage from '../../src/pages/ai-os/AdminAiCommandPage';

const api = vi.hoisted(() => ({ overview: vi.fn(), getBoard: vi.fn(), listApprovals: vi.fn(), listDelayedApprovals: vi.fn(), decideApproval: vi.fn() }));
vi.mock('../../src/lib/ai-os-api', () => ({ aiOsApi: api }));
vi.mock('../../src/layout/useAuthState', () => ({ useAuthState: () => ({ user: { role: 'admin' } }) }));
vi.mock('../../src/lib/usePageMeta', () => ({ usePageMeta: () => undefined }));

const delayed = { id: 'approval-1', status: 'executing', tool: 'create_ticket', task_id: 'task-1', run_id: 'run-1', updated_at: '2026-01-01T00:00:00Z' };
describe('Delayed approval visibility', () => {
  beforeEach(() => {
    api.overview.mockReturnValue(new Promise(() => {}));
    api.getBoard.mockReturnValue(new Promise(() => {}));
    api.listApprovals.mockResolvedValue({ approvals: [] });
    api.listDelayedApprovals.mockResolvedValue({ approvals: [delayed] });
  });
  afterEach(() => { cleanup(); vi.resetAllMocks(); });
  function open() { render(<AdminAiCommandPage />); fireEvent.click(screen.getByRole('button', { name: 'Decision Inbox' })); }

  it('shows references and uncertainty without providing replay controls', async () => {
    open();
    expect(await screen.findByText(/Approval approval-1 · task task-1 · run run-1/)).toBeTruthy();
    expect(screen.getByText(/elapsed time does not prove failure/)).toBeTruthy();
    expect(screen.getByText(/not a complete history or a resolution queue/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry|replay|reset/i })).toBeNull();
  });

  it('warns on an ambiguous decision response and disables further decisions until reload', async () => {
    api.listApprovals.mockImplementation(async (status: string) => ({ approvals: status === 'pending' ? [{ id: 'pending-1', tool: 'create_ticket', risk_level: 'high', status: 'pending', reason: 'review', expires_at: '2027-01-01T00:00:00Z', reviewFingerprint: 'a'.repeat(64), arguments_verified: true, action: 'create_ticket()', arguments: { subject: 'Review subject' }, affected_customer_id: 'customer-1', task_id: 'task-1', run_id: 'run-1', evidence: [] }] : [] }));
    api.decideApproval.mockRejectedValue(new Error('Connection lost'));
    open();
    const approve = await screen.findByRole('button', { name: 'Approve & execute' });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Review subject/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I reviewed this stored proposal and its scope.' }));
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(approve);
    expect(await screen.findByText(/decision or execution outcome may be unknown/)).toBeTruthy();
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(approve);
    expect(api.decideApproval).toHaveBeenCalledTimes(1);
    expect(api.decideApproval).toHaveBeenCalledWith('pending-1', 'approved', 'a'.repeat(64));
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decision Inbox' }));
    expect(await screen.findByText(/A previous decision outcome may be unknown/)).toBeTruthy();
    expect((await screen.findByRole('button', { name: 'Approve & execute' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps approval disabled for legacy unverified arguments while allowing rejection', async () => {
    api.listApprovals.mockImplementation(async (status: string) => ({ approvals: status === 'pending' ? [{ id: 'legacy-1', tool: 'create_ticket', risk_level: 'high', status: 'pending', reason: 'review', expires_at: '2027-01-01T00:00:00Z', reviewFingerprint: 'b'.repeat(64), arguments_verified: false, action: 'create_ticket()', arguments: { body: 'old' }, evidence: [] }] : [] }));
    open();
    const approve = await screen.findByRole('button', { name: 'Approve & execute' });
    expect(screen.getByText(/Original arguments cannot be verified/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I reviewed this stored proposal and its scope.' }));
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('distinguishes loading and failure from an empty pending queue', async () => {
    let reject!: (reason: Error) => void;
    api.listApprovals.mockImplementation((status: string) => status === 'pending' ? new Promise((_, r) => { reject = r; }) : Promise.resolve({ approvals: [] }));
    open();
    expect(screen.getByText('Loading pending approvals…')).toBeTruthy();
    expect(screen.queryByText('No pending approvals in this snapshot.')).toBeNull();
    await act(async () => { reject(new Error('offline')); });
    expect(screen.getByText('Pending approvals unavailable. Refresh before making a decision.')).toBeTruthy();
    expect(screen.queryByText('No pending approvals in this snapshot.')).toBeNull();
  });

  it('reports a history failure without hiding a successful pending snapshot', async () => {
    api.listApprovals.mockImplementation((status: string) => status === 'pending' ? Promise.resolve({ approvals: [] }) : Promise.reject(new Error('offline')));
    open();
    expect(await screen.findByText('Executed approval history unavailable.')).toBeTruthy();
    expect(await screen.findByText('No pending approvals in this snapshot.')).toBeTruthy();
    expect(screen.queryByText('No executed approvals in this snapshot.')).toBeNull();
  });

  it('clears reviewed proposals during refresh and ignores an older response', async () => {
    const proposal = { id: 'pending-1', tool: 'create_ticket', risk_level: 'high', status: 'pending', reason: 'review', expires_at: '2027-01-01T00:00:00Z', reviewFingerprint: 'a'.repeat(64), arguments_verified: true, action: 'create_ticket()', arguments: {}, evidence: [] };
    let resolve!: (value: { approvals: unknown[] }) => void;
    let calls = 0;
    api.listApprovals.mockImplementation((status: string) => {
      if (status !== 'pending') return Promise.resolve({ approvals: [] });
      calls++;
      if (calls === 1) return Promise.resolve({ approvals: [proposal] });
      if (calls === 2) return new Promise((r) => { resolve = r; });
      return Promise.reject(new Error('offline'));
    });
    open();
    const approve = await screen.findByRole('button', { name: 'Approve & execute' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'I reviewed this stored proposal and its scope.' }));
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh decision inbox' }));
    expect(screen.queryByRole('button', { name: 'Approve & execute' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh decision inbox' }));
    expect(await screen.findByText('Pending approvals unavailable. Refresh before making a decision.')).toBeTruthy();
    await act(async () => { resolve({ approvals: [proposal] }); });
    expect(screen.queryByRole('button', { name: 'Approve & execute' })).toBeNull();
  });

  it('shows failure instead of an empty result', async () => {
    api.listDelayedApprovals.mockRejectedValue(new Error('Delayed approvals unavailable'));
    open();
    expect(await screen.findByText('Delayed approvals unavailable')).toBeTruthy();
    expect(screen.queryByText('No delayed approvals in this view.')).toBeNull();
  });

  it('ignores a stale response after refresh', async () => {
    let resolve!: (value: { approvals: unknown[] }) => void;
    api.listDelayedApprovals.mockReturnValueOnce(new Promise((r) => { resolve = r; })).mockResolvedValueOnce({ approvals: [] });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh delayed approvals' }));
    expect(await screen.findByText('No delayed approvals in this view.')).toBeTruthy();
    await act(async () => { resolve({ approvals: [delayed] }); });
    expect(screen.queryByText(/Approval approval-1/)).toBeNull();
  });
});
