// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AiSupportWidget from '../../src/components/AiSupportWidget';

vi.mock('../../src/layout/useAuthState', () => ({ useAuthState: () => ({ user: null, token: null }) }));
vi.mock('../../src/lib/tiktok', () => ({ trackTikTok: vi.fn() }));
const key = 'ch247_ai_support_pending_message:conversation-1';
const snapshot = () => ({ ok: true, json: async () => ({ messages: [], conversation: { status: 'AI_ACTIVE' }, launchProgress: null }) });
const success = () => ({ ok: true, json: async () => ({ accepted: true, humanActive: true }) });

describe('support message uncertainty', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ch247_ai_support_session', JSON.stringify({ conversationId: 'conversation-1', accessToken: 'token-1' }));
  });
  afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  async function open() {
    render(<AiSupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'AI Support' }));
    await vi.waitFor(() => expect(screen.queryByText('Loading the conversation…')).toBeNull());
  }
  function draft() {
    fireEvent.change(screen.getByRole('textbox', { name: 'Support message' }), { target: { value: 'Please launch a website' } });
  }

  it('persists uncertainty on lost response and requires explicit review after reload', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, opts) => opts?.method === 'POST' ? Promise.reject(new Error('connection lost')) : snapshot());
    vi.stubGlobal('fetch', fetchMock);
    await open();
    draft();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/previous message may have been received/)).toBeTruthy();
    expect(screen.queryByText('Please launch a website')).toBeNull(); // not presented as delivered
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(localStorage.getItem(key)).toBeTruthy();
    expect(localStorage.getItem(key)).not.toContain('Please launch');
    const posts = fetchMock.mock.calls.filter(([, opts]) => opts?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1].body)).toEqual({ message: 'Please launch a website', requestId: localStorage.getItem(key) });
    cleanup();
    await open();
    expect(await screen.findByText(/previous message may have been received/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue with this uncertainty' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand the previous message/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with this uncertainty' }));
    expect(localStorage.getItem(key)).toBeNull();
    expect(screen.queryByText(/previous message may have been received/)).toBeNull();
    expect(fetchMock.mock.calls.filter(([, opts]) => opts?.method === 'POST')).toHaveLength(1);
  });

  it.each(['server error', 'malformed success'] as const)('treats %s as unknown without automatically retrying', async (kind) => {
    const fetchMock = vi.fn().mockImplementation(async (_url, opts) => opts?.method === 'POST'
      ? kind === 'server error' ? { ok: false, json: async () => ({ message: 'Server error' }) } : { ok: true, json: async () => ({}) }
      : snapshot());
    vi.stubGlobal('fetch', fetchMock);
    await open(); draft(); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/previous message may have been received/)).toBeTruthy();
    expect(localStorage.getItem(key)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, opts]) => opts?.method === 'POST')).toHaveLength(1);
  });

  it('does not treat a duplicate response with unknown outcome as completed', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, opts) => opts?.method === 'POST'
      ? { ok: true, json: async () => ({ accepted: true, duplicate: true, outcomeUnknown: true }) }
      : snapshot());
    vi.stubGlobal('fetch', fetchMock);
    await open(); draft(); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/previous message may have been received/)).toBeTruthy();
    expect(localStorage.getItem(key)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, opts]) => opts?.method === 'POST')).toHaveLength(1);
  });

  it('clears its marker only after an observed accepted response, then reloads the transcript', async () => {
    let resolvePost!: (value: ReturnType<typeof success>) => void;
    const pendingPost = new Promise<ReturnType<typeof success>>((resolve) => { resolvePost = resolve; });
    const fetchMock = vi.fn().mockImplementation((_url, opts) => opts?.method === 'POST' ? pendingPost : Promise.resolve(snapshot()));
    vi.stubGlobal('fetch', fetchMock);
    await open(); draft(); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(localStorage.getItem(key)).toBeTruthy();
    await act(async () => { resolvePost(success()); await pendingPost; });
    await vi.waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    expect(screen.queryByText(/previous message may have been received/)).toBeNull();
    expect(fetchMock.mock.calls.filter(([, opts]) => opts?.method === 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, opts]) => !opts?.method)).toHaveLength(2);
  });

  it('reflects another tab’s uncertainty marker without submitting a message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(snapshot());
    vi.stubGlobal('fetch', fetchMock);
    await open(); draft();
    await act(async () => {
      localStorage.setItem(key, 'other-tab-marker');
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'other-tab-marker' }));
    });
    expect(screen.getByText(/previous message may have been received/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([, opts]) => opts?.method === 'POST')).toHaveLength(0);
  });

  it('does not dispatch when the marker cannot be written', async () => {
    const fetchMock = vi.fn().mockResolvedValue(snapshot());
    vi.stubGlobal('fetch', fetchMock);
    await open(); draft();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Cannot safely send while browser storage is unavailable/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, opts]) => opts?.method === 'POST')).toHaveLength(0);
  });
});
