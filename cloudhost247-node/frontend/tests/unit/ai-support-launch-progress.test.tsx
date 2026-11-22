// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AiSupportWidget from '../../src/components/AiSupportWidget';

vi.mock('../../src/layout/useAuthState', () => ({ useAuthState: () => ({ user: null, token: null }) }));
vi.mock('../../src/lib/tiktok', () => ({ trackTikTok: vi.fn() }));

function conversation(progress: unknown) {
  return { ok: true, json: async () => ({ messages: [], conversation: { status: 'AI_ACTIVE' }, launchProgress: progress }) };
}

describe('support widget website launch progress', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ch247_ai_support_session', JSON.stringify({ conversationId: 'conversation-1', accessToken: 'token-1' }));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); vi.unstubAllGlobals(); });

  function open(progress: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(conversation(progress));
    vi.stubGlobal('fetch', fetchMock);
    render(<AiSupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'AI Support' }));
    return fetchMock;
  }

  it('distinguishes suspected interruption without presenting it as confirmed failure or a retry', async () => {
    const fetchMock = open({ status: 'checking', attentionState: 'suspected_interrupted', label: 'This lookup is taking longer than expected and may be interrupted. Please ask support for help.' });
    const status = await screen.findByText(/Website launch — may need attention/);
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toContain('may be interrupted');
    expect(status.textContent).toContain('ask support for help');
    expect(screen.queryByRole('button', { name: /retry|restart|replay/i })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers['X-AI-Conversation-Token']).toBe('token-1');
  });

  it('shows ordinary checking without an interruption warning', async () => {
    open({ status: 'checking', attentionState: 'none', label: 'Checking hosting availability' });
    expect(await screen.findByText('Website launch: Checking hosting availability')).toBeTruthy();
    expect(screen.queryByText(/may need attention/)).toBeNull();
  });

  it('continues to show older server responses without a typed attention state', async () => {
    open({ status: 'options_ready', label: 'Hosting options checked — no order placed' });
    expect(await screen.findByText('Website launch: Hosting options checked — no order placed')).toBeTruthy();
    expect(screen.queryByText(/may need attention/)).toBeNull();
  });

  it('does not show launch progress when the conversation has none', async () => {
    const fetchMock = open(null);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Website launch/)).toBeNull();
  });

  it.each(['network', '500', '404'] as const)('retains the session and pauses actions after %s transcript failure until a successful refresh', async (failure) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(conversation({ status: 'checking', attentionState: 'none', label: 'Checking hosting availability' }));
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'));
    else fetchMock.mockResolvedValueOnce({ ok: false, status: Number(failure) });
    fetchMock.mockResolvedValueOnce(conversation({ status: 'options_ready', attentionState: 'none', label: 'Hosting options checked — no order placed' }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    render(<AiSupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'AI Support' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Website launch: Checking hosting availability')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Support message' }), { target: { value: 'Hello' } });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByRole('alert').textContent).toContain('may be out of date');
    expect(screen.getByRole('alert').textContent).toContain('Actions already in progress may still finish');
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(localStorage.getItem('ch247_ai_support_session')).toContain('conversation-1');
    expect(screen.queryByRole('button', { name: 'Start conversation' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh conversation' })); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Website launch: Hosting options checked — no order placed')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every((call) => !call[1].method || call[1].method === 'GET')).toBe(true);
  });

  it('retains an initially unavailable session and recovers on the next read-only poll', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(conversation(null));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    render(<AiSupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'AI Support' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('alert').textContent).toContain('Conversation unavailable');
    expect(localStorage.getItem('ch247_ai_support_session')).toContain('conversation-1');
    expect(screen.queryByRole('button', { name: 'Start conversation' })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Support message' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['success', 'failure'] as const)('ignores an older %s after a newer refresh', async (olderResult) => {
    let resolveOld!: (value: ReturnType<typeof conversation>) => void;
    let rejectOld!: (error: Error) => void;
    const old = new Promise<ReturnType<typeof conversation>>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    const fetchMock = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce(conversation({
      status: 'options_ready', attentionState: 'none', label: 'Hosting options checked — no order placed',
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    render(<AiSupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'AI Support' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Website launch: Hosting options checked — no order placed')).toBeTruthy();
    await act(async () => {
      if (olderResult === 'success') resolveOld(conversation({ status: 'checking', attentionState: 'suspected_interrupted', label: 'Old delayed state' }));
      else rejectOld(new Error('Old request failed'));
      await old.catch(() => undefined);
    });
    expect(screen.getByText('Website launch: Hosting options checked — no order placed')).toBeTruthy();
    expect(screen.queryByText(/may need attention|Old delayed state/)).toBeNull();
    expect(localStorage.getItem('ch247_ai_support_session')).toBeTruthy();
  });
});
