// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ControlPanelsPage from '../../src/pages/ControlPanelsPage';
import type { ControlPanelPage, ControlPanelPageQuery, ControlPanelSummary } from '../../src/lib/control-panels-api';

const { fetchControlPanelsPage } = vi.hoisted(() => ({ fetchControlPanelsPage: vi.fn() }));
vi.mock('../../src/lib/control-panels-api', () => ({ fetchControlPanelsPage }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function fixtures(count: number): ControlPanelSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `test-${index}`, name: `Test Platform ${index + 1}`, slug: `test-platform-${index + 1}`,
    category: index < 30 ? 'APPLICATION_DEPLOYMENT_PLATFORM' : 'SERVER_PANEL',
    description: null, logoUrl: null, websiteUrl: null, documentationUrl: null,
    status: 'ACTIVE', installationMethod: 'DOCKER', requiresLicense: index % 2 === 0,
    licenseProvider: 'Open Source', minimumRequirements: { ramMb: 1024, cpuCores: 1, diskGb: 10 },
    supportedOs: ['Debian'], capabilities: {}, startingPrice: '0', currency: 'USD',
    billingCycle: 'monthly', planCount: 0,
  }));
}

function stubCatalogue(all = fixtures(55)) {
  fetchControlPanelsPage.mockImplementation(async ({ offset, limit, category, license, search }: ControlPanelPageQuery) => {
    const selected = all.filter((p) =>
      (!category || category === p.category) &&
      (!license || (license === 'FREE' ? !p.requiresLicense : p.requiresLicense)) &&
      (!search || p.name.toLowerCase().includes(search.toLowerCase()))
    );
    return {
      controlPanels: selected.slice(offset, offset + limit),
      total: selected.length,
      categoryCounts: {
        ALL: all.length, OPERATING_SYSTEM: 0,
        APPLICATION_DEPLOYMENT_PLATFORM: all.filter((p) => p.category === 'APPLICATION_DEPLOYMENT_PLATFORM').length,
        SERVER_PANEL: all.filter((p) => p.category === 'SERVER_PANEL').length,
        SERVER_MANAGEMENT: 0,
      },
    };
  });
}

function cardCount() {
  return document.querySelectorAll('#platform-results .ch247-panel-card').length;
}

describe('public control panels catalogue paged loading', () => {
  it('requests only 24 records initially and fetches one more page per click', async () => {
    stubCatalogue();
    render(<MemoryRouter><ControlPanelsPage /></MemoryRouter>);
    await waitFor(() => expect(cardCount()).toBe(24));
    expect(fetchControlPanelsPage).toHaveBeenCalledTimes(1);
    expect(fetchControlPanelsPage).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 0, limit: 24 }));
    expect(document.querySelector('.ch247-control-panels-count')?.textContent).toContain('Showing 24 of 55 platforms');
    expect(screen.queryByText('Test Platform 25')).toBeNull();

    const showMore = screen.getByRole('button', { name: /Show more/ });
    expect(showMore.getAttribute('aria-controls')).toBe('platform-results');
    fireEvent.click(showMore);
    await waitFor(() => expect(cardCount()).toBe(48));
    expect(fetchControlPanelsPage).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 24, limit: 24 }));
    expect(document.querySelector('.ch247-control-panels-count')?.textContent).toContain('Showing 48 of 55 platforms');
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    await waitFor(() => expect(cardCount()).toBe(55));
    expect(fetchControlPanelsPage).toHaveBeenNthCalledWith(3, expect.objectContaining({ offset: 48, limit: 24 }));
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
  });

  it('resets to page zero and searches the whole directory after each filter change', async () => {
    stubCatalogue();
    render(<MemoryRouter><ControlPanelsPage /></MemoryRouter>);
    await waitFor(() => expect(cardCount()).toBe(24));
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    await waitFor(() => expect(cardCount()).toBe(48));

    const search = screen.getByPlaceholderText(/Search by name/);
    fireEvent.change(search, { target: { value: 'Test Platform 55' } });
    await waitFor(() => expect(cardCount()).toBe(1));
    expect(screen.getByText('Test Platform 55')).toBeTruthy();
    expect(fetchControlPanelsPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, search: 'Test Platform 55' }));
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => expect(cardCount()).toBe(24));

    fireEvent.click(screen.getByRole('tab', { name: /Web Hosting Panels/ }));
    await waitFor(() => expect(document.querySelector('.ch247-control-panels-count')?.textContent).toContain('Showing 24 of 25 platforms'));
    expect(fetchControlPanelsPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, category: 'SERVER_PANEL' }));
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    await waitFor(() => expect(cardCount()).toBe(25));
    fireEvent.click(screen.getByRole('tab', { name: /All Platforms/ }));
    await waitFor(() => expect(cardCount()).toBe(24));

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by licensing' }), { target: { value: 'COMMERCIAL' } });
    await waitFor(() => expect(document.querySelector('.ch247-control-panels-count')?.textContent).toContain('Showing 24 of 28 platforms'));
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    await waitFor(() => expect(cardCount()).toBe(28));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by licensing' }), { target: { value: 'FREE' } });
    await waitFor(() => expect(document.querySelector('.ch247-control-panels-count')?.textContent).toContain('Showing 24 of 27 platforms'));

    fireEvent.change(search, { target: { value: 'No Such Platform' } });
    await waitFor(() => expect(screen.getByText('No control panels match the selected filters.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Reset Filters/ }));
    await waitFor(() => expect(cardCount()).toBe(24));
    expect(fetchControlPanelsPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, category: undefined, license: undefined, search: '' }));
  });

  it('keeps existing cards and offers another attempt when a later page fails', async () => {
    stubCatalogue();
    fetchControlPanelsPage.mockImplementationOnce(async () => ({
      controlPanels: fixtures(24), total: 55,
      categoryCounts: { ALL: 55, OPERATING_SYSTEM: 0, SERVER_PANEL: 25, APPLICATION_DEPLOYMENT_PLATFORM: 30, SERVER_MANAGEMENT: 0 },
    })).mockRejectedValueOnce(new Error('Connection lost'));
    render(<MemoryRouter><ControlPanelsPage /></MemoryRouter>);
    await waitFor(() => expect(cardCount()).toBe(24));
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    await waitFor(() => expect(screen.getByText(/Could not load more platforms: Connection lost/)).toBeTruthy());
    expect(cardCount()).toBe(24);
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    await waitFor(() => expect(cardCount()).toBe(48));
    expect(fetchControlPanelsPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 24 }));
  });

  it('ignores a slow old page after the search changes, even if its transport ignores abort', async () => {
    stubCatalogue();
    let resolveOldPage!: (page: ControlPanelPage) => void;
    fetchControlPanelsPage.mockImplementationOnce(async () => ({
      controlPanels: fixtures(24), total: 55,
      categoryCounts: { ALL: 55, OPERATING_SYSTEM: 0, SERVER_PANEL: 25, APPLICATION_DEPLOYMENT_PLATFORM: 30, SERVER_MANAGEMENT: 0 },
    })).mockImplementationOnce(() => new Promise<ControlPanelPage>((resolve) => { resolveOldPage = resolve; }));
    render(<MemoryRouter><ControlPanelsPage /></MemoryRouter>);
    await waitFor(() => expect(cardCount()).toBe(24));
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
    expect(fetchControlPanelsPage).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: 'Test Platform 55' } });
    await waitFor(() => expect(cardCount()).toBe(1));
    await act(async () => resolveOldPage({
      controlPanels: fixtures(55).slice(24, 48), total: 55,
      categoryCounts: { ALL: 55, OPERATING_SYSTEM: 0, SERVER_PANEL: 25, APPLICATION_DEPLOYMENT_PLATFORM: 30, SERVER_MANAGEMENT: 0 },
    }));
    expect(cardCount()).toBe(1);
    expect(screen.getByText('Test Platform 55')).toBeTruthy();
  });
});
