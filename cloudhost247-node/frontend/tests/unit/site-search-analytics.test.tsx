// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SiteSearch } from '../../src/pages/marketing/MarketingPage';
import { trackAnalyticsSearch } from '../../src/lib/marketing';
vi.mock('../../src/lib/marketing', () => ({ trackAnalyticsSearch: vi.fn(), trackAnalyticsCatalog: vi.fn(), trackAnalyticsSelect: vi.fn(), trackAnalyticsItem: vi.fn(), trackMarketing: vi.fn(), useMarketing: vi.fn() }));
describe('site search analytics', () => {
  beforeEach(() => vi.clearAllMocks()); afterEach(cleanup);
  function page() { return render(<MemoryRouter><SiteSearch section={{ heading: 'Find a service' } as never} /></MemoryRouter>); }
  it('tracks explicit meaningful searches with no query argument', () => {
    page(); const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'private@example.com' } });
    expect(trackAnalyticsSearch).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole('search'));
    expect(trackAnalyticsSearch).toHaveBeenCalledOnce(); expect(trackAnalyticsSearch).toHaveBeenCalledWith();
    expect(screen.getByText(/without the query/)).toBeTruthy();
  });
  it('does not track empty or one-character submissions', () => {
    page(); fireEvent.submit(screen.getByRole('search'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } }); fireEvent.submit(screen.getByRole('search'));
    expect(trackAnalyticsSearch).not.toHaveBeenCalled();
  });
});
