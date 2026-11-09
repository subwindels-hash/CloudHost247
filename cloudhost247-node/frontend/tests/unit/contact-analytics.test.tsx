// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ContactPage from '../../src/pages/ContactPage';
import { apiFetch } from '../../src/lib/api';
import { trackAnalyticsContact, trackMarketing } from '../../src/lib/marketing';
vi.mock('../../src/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('../../src/lib/marketing', () => ({ trackAnalyticsContact: vi.fn(), trackMarketing: vi.fn() }));
vi.mock('../../src/lib/usePageMeta', () => ({ usePageMeta: vi.fn() }));
describe('contact analytics success boundary', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);
  function form() {
    render(<ContactPage />);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Private Name' } });
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'private@example.com' } });
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Billing' } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Private subject' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Private message' } });
    return screen.getByRole('button', { name: 'Send message' }).closest('form')!;
  }
  it('tracks contact once after confirmed persistence without forwarding any form values', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ received: true, marketingEvent: null });
    fireEvent.submit(form());
    expect(await screen.findByText(/Your message has been received/)).toBeTruthy();
    expect(trackAnalyticsContact).toHaveBeenCalledTimes(1);
    expect(trackAnalyticsContact).toHaveBeenCalledWith();
    expect(trackMarketing).not.toHaveBeenCalled();
  });
  it.each([{ received: false }, {}, null])('does not record a successful event for an unconfirmed response %j', async response => {
    vi.mocked(apiFetch).mockResolvedValue(response);
    fireEvent.submit(form());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(trackAnalyticsContact).not.toHaveBeenCalled();
  });
  it('does not record events when the request fails', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('error'));
    fireEvent.submit(form());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(trackAnalyticsContact).not.toHaveBeenCalled();
  });
  it('rejects concurrent submissions before React rerenders', async () => {
    let complete!: (result: unknown) => void;
    vi.mocked(apiFetch).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const node = form(); fireEvent.submit(node); fireEvent.submit(node);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    complete({ received: true });
    await waitFor(() => expect(trackAnalyticsContact).toHaveBeenCalledTimes(1));
  });
});
