// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAiCommandPage from '../../src/pages/ai-os/AdminAiCommandPage';

const api = vi.hoisted(() => ({
  overview: vi.fn(), getBoard: vi.fn(), listEvents: vi.fn(), listWorkflows: vi.fn(),
  listHeldEventClaims: vi.fn(), listAcknowledgedIncompleteRuns: vi.fn(), listWorkflowRunsForEvent: vi.fn(), openEventInvestigation: vi.fn(), openAcknowledgedRunInvestigation: vi.fn(),
}));
vi.mock('../../src/lib/ai-os-api', () => ({ aiOsApi: api }));
vi.mock('../../src/layout/useAuthState', () => ({ useAuthState: () => ({ user: { role: 'admin' } }) }));
vi.mock('../../src/lib/usePageMeta', () => ({ usePageMeta: () => undefined }));

const claim = {
  event_id: 'ef6c0fa9-b665-40a4-bd89-e6cbbf31cc11', event_type: 'invoice.overdue',
  claimed_at: '2026-01-01T00:00:00Z', delayed: true,
  investigation_id: null, investigation_opened_at: null, investigation_opened_by: null,
};

describe('AI event claim investigation view', () => {
  beforeEach(() => {
    api.overview.mockReturnValue(new Promise(() => {}));
    api.getBoard.mockReturnValue(new Promise(() => {}));
    api.listWorkflows.mockResolvedValue({ workflows: [] });
    api.listEvents.mockResolvedValue({ events: [{ id: claim.event_id, event_type: claim.event_type, source: 'admin', fingerprint: null, occurred_at: '2026-01-01T00:00:00Z', processed_at: null }] });
    api.listHeldEventClaims.mockResolvedValue({ claims: [claim] });
    api.listAcknowledgedIncompleteRuns.mockResolvedValue({ runs: [{ run_id: 'history-run-1', event_id: 'history-event-1', event_type: 'legacy.event', workflow_slug: 'legacy-workflow', status: 'partial', started_at: '2026-01-01T00:00:00Z', processed_at: '2026-01-01T00:05:00Z', acknowledgement_key: '2026-01-01T00:05:00.123456Z', investigation_id: null, investigation_opened_at: null, investigation_observed_status: null }] });
    api.listWorkflowRunsForEvent.mockResolvedValue({ runs: [{ id: 'run-1', workflow_slug: 'collections', status: 'running', steps: [{ step: 'collector', status: 'dispatching', taskId: 'task-1' }] }] });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

  it('shows uncertainty, requires confirmation and displays only the returned investigation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AdminAiCommandPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Events & Workflows' }));
    expect(await screen.findByText(/A delayed claim may still have a live worker/)).toBeTruthy();
    expect(screen.getByText(/deciding an approval does not automatically resume or release the event/)).toBeTruthy();
    const button = await screen.findByRole('button', { name: 'Record investigation' });
    expect(screen.queryByText('Invalid Date')).toBeNull();
    fireEvent.click(button);
    expect(api.openEventInvestigation).not.toHaveBeenCalled();
    api.openEventInvestigation.mockResolvedValue({ created: true });
    api.listHeldEventClaims.mockResolvedValue({ claims: [{ ...claim, investigation_id: 'investigation-1', investigation_opened_at: '2026-01-01T00:10:00Z' }] });
    fireEvent.click(button);
    await waitFor(() => expect(api.openEventInvestigation).toHaveBeenCalledWith(claim.event_id));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/No outcome has been verified/)).toBeTruthy();
    expect(screen.getByText(/No claim was released and no one was notified/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show workflow references' }));
    expect(await screen.findByText(/task task-1/)).toBeTruthy();
    expect(screen.getByText(/Recorded state is not proof of an external outcome/)).toBeTruthy();
  });

  it('shows bounded acknowledged history without claiming an outcome or resolution', async () => {
    render(<AdminAiCommandPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Events & Workflows' }));
    expect(await screen.findByText(/Event history-event-1 · run history-run-1/)).toBeTruthy();
    expect(screen.getByText(/not a complete history or a list of unresolved cases/)).toBeTruthy();
    expect(screen.getByText(/acknowledgement does not verify an external outcome/)).toBeTruthy();
  });

  it('requires confirmation and binds a recorded run investigation to the displayed acknowledgement', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AdminAiCommandPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Events & Workflows' }));
    const button = await screen.findByRole('button', { name: 'Record run investigation' });
    fireEvent.click(button);
    expect(api.openAcknowledgedRunInvestigation).not.toHaveBeenCalled();
    api.openAcknowledgedRunInvestigation.mockResolvedValue({ created: true });
    api.listAcknowledgedIncompleteRuns.mockResolvedValue({ runs: [{ run_id: 'history-run-1', event_id: 'history-event-1', event_type: 'legacy.event', workflow_slug: 'legacy-workflow', status: 'failed', started_at: '2026-01-01T00:00:00Z', processed_at: '2026-01-01T00:05:00Z', acknowledgement_key: '2026-01-01T00:05:00.123456Z', investigation_id: 'investigation-1', investigation_opened_at: '2026-01-01T00:10:00Z', investigation_observed_status: 'partial' }] });
    fireEvent.click(button);
    await waitFor(() => expect(api.openAcknowledgedRunInvestigation).toHaveBeenCalledWith(expect.objectContaining({ run_id: 'history-run-1', event_id: 'history-event-1', status: 'partial', acknowledgement_key: '2026-01-01T00:05:00.123456Z' })));
    expect(await screen.findByText(/when status was partial/)).toBeTruthy();
    expect(screen.getByText(/No outcome was verified and no one was notified/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record run investigation' })).toBeNull();
  });

  it('does not claim a run investigation was recorded after a stale-state conflict', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.openAcknowledgedRunInvestigation.mockRejectedValue(new Error('Run is not an acknowledged incomplete workflow'));
    render(<AdminAiCommandPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Events & Workflows' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Record run investigation' }));
    expect(await screen.findByText(/result may be unknown. Refresh acknowledged runs and investigate/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record run investigation' })).toBeNull();
    expect(screen.queryByText(/Investigation recorded\. No outcome was verified/)).toBeNull();
  });

  it('ignores an older history response after refresh', async () => {
    let finishOld!: (value: { runs: unknown[] }) => void;
    api.listAcknowledgedIncompleteRuns.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce({ runs: [] });
    render(<AdminAiCommandPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Events & Workflows' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh acknowledged runs' }));
    expect(await screen.findByText('No matching runs in this view.')).toBeTruthy();
    await act(async () => { finishOld({ runs: [{ run_id: 'stale', event_id: 'stale', event_type: 'stale', workflow_slug: 'stale', status: 'partial', started_at: '2026-01-01T00:00:00Z', processed_at: '2026-01-01T00:00:00Z' }] }); });
    expect(screen.getByText('No matching runs in this view.')).toBeTruthy();
    expect(screen.queryByText(/Event stale/)).toBeNull();
  });

  it('does not present an empty history if the history request fails; held claims remain visible', async () => {
    api.listAcknowledgedIncompleteRuns.mockRejectedValue(new Error('History unavailable'));
    render(<AdminAiCommandPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Events & Workflows' }));
    expect(await screen.findByText('History unavailable')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Record investigation' })).toBeTruthy();
    expect(screen.queryByText('No matching runs in this view.')).toBeNull();
  });

  it('keeps held claims visible when events or workflows fail independently', async () => {
    api.listEvents.mockRejectedValue(new Error('Events unavailable'));
    api.listWorkflows.mockRejectedValue(new Error('Workflows unavailable'));
    render(<AdminAiCommandPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Events & Workflows' }));
    expect(await screen.findByText('Events unavailable')).toBeTruthy();
    expect(await screen.findByText('Workflows unavailable')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Record investigation' })).toBeTruthy();
    expect(screen.queryByText('No events in this snapshot.')).toBeNull();
    expect(screen.queryByText('No workflows in this view.')).toBeNull();
  });

  it('clears stale claims during refresh and ignores older claim responses', async () => {
    let resolve!: (value: { claims: unknown[] }) => void;
    api.listHeldEventClaims.mockResolvedValueOnce({ claims: [claim] }).mockReturnValueOnce(new Promise((r) => { resolve = r; })).mockRejectedValueOnce(new Error('Claim queue unavailable'));
    render(<AdminAiCommandPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Events & Workflows' }));
    expect(await screen.findByRole('button', { name: 'Record investigation' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh claims' }));
    expect(screen.getByText('Loading held claims…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record investigation' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh claims' }));
    expect(await screen.findByText('Claim queue unavailable')).toBeTruthy();
    await act(async () => { resolve({ claims: [claim] }); });
    expect(screen.queryByRole('button', { name: 'Record investigation' })).toBeNull();
  });

  it('discards workflow references returned after a claim refresh', async () => {
    let resolve!: (value: { runs: unknown[] }) => void;
    api.listWorkflowRunsForEvent.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<AdminAiCommandPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Events & Workflows' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show workflow references' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh claims' }));
    await screen.findByRole('button', { name: 'Show workflow references' });
    await act(async () => { resolve({ runs: [{ id: 'stale-run', workflow_slug: 'stale-workflow', status: 'running', steps: [] }] }); });
    expect(screen.queryByText(/stale-workflow/)).toBeNull();
  });

  it('hides a claim after an ambiguous investigation response', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.openEventInvestigation.mockRejectedValue(new Error('Connection lost'));
    render(<AdminAiCommandPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Events & Workflows' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Record investigation' }));
    expect(await screen.findByText(/result may be unknown. Refresh claims and investigate/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record investigation' })).toBeNull();
  });

  it('does not show an empty-queue claim when the API fails', async () => {
    api.listHeldEventClaims.mockRejectedValue(new Error('Claim queue unavailable'));
    render(<AdminAiCommandPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Events & Workflows' }));
    expect((await screen.findAllByText('Claim queue unavailable')).length).toBeGreaterThan(0);
    expect(screen.queryByText('No held event claims in this view.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record investigation' })).toBeNull();
  });
});
