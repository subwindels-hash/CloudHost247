// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AiAssistantPage from '../../src/pages/ai-os/AiAssistantPage';

const api = vi.hoisted(() => ({ activity: vi.fn(), profile: vi.fn(), ask: vi.fn() }));
vi.mock('../../src/lib/ai-os-api', () => ({ aiCustomerApi: api }));
vi.mock('../../src/lib/usePageMeta', () => ({ usePageMeta: () => undefined }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('Customer assistant activity transparency', () => {
  it('labels the bounded list as incomplete rather than a total account history', async () => {
    api.activity.mockResolvedValue({ tasks: [{ id: 'own', status: 'succeeded' }], findings: [], approvals: [], visibility: 'recent_customer_assistant_tasks_only' });
    api.profile.mockResolvedValue({ metrics: {} });
    render(<MemoryRouter><AiAssistantPage /></MemoryRouter>);
    expect(await screen.findByText('request(s) shown')).toBeTruthy();
    expect(screen.getByText(/not a complete record of AI activity/)).toBeTruthy();
    expect(screen.queryByText(/nothing happens outside this register/)).toBeNull();
    expect(screen.getByText(/Knowledge search is currently unavailable/)).toBeTruthy();
  });
  it('does not claim zero requests when activity fails', async () => {
    api.activity.mockRejectedValue(new Error('unavailable'));
    api.profile.mockResolvedValue({ metrics: {} });
    render(<MemoryRouter><AiAssistantPage /></MemoryRouter>);
    expect(await screen.findByText('Activity unavailable.')).toBeTruthy();
    expect(screen.queryByText('request(s) shown')).toBeNull();
  });
});
