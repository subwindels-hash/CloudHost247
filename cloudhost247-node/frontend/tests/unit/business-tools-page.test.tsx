// @vitest-environment jsdom
/**
 * Business Tools — the directory page, the shared workspace, routing and navigation.
 *
 * The *arithmetic* of all 21 tools is asserted engine-first in tests/unit/business-tools-engines.test.ts.
 * What this file covers is the part a visitor actually touches, and the part that can silently rot
 * without an engine test noticing:
 *
 *   - the directory advertises the counts the registry really holds (21 = 5 + 12 + 4), never a
 *     number typed into the copy;
 *   - search and the category filters narrow the grid, and say so in the URL so a filtered view is
 *     shareable;
 *   - every one of the 21 tools renders a workspace from its own schema and, when run, ends in the
 *     state its engine actually produces — a result if the defaults are sufficient, a specific
 *     validation error if they are not. A tool that throws, or that stays on its empty state after
 *     being asked to run, fails here;
 *   - reset, copy, download and print do what their labels claim;
 *   - the pre-existing MRZ URLs keep working, inside and outside the renamed section;
 *   - the mega menu and the footer publish Business Tools, and the Tools mega menu keeps its
 *     live-data contract (no static groups) while doing so.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import BusinessToolsPage from '../../src/pages/tools/BusinessToolsPage';
import BusinessToolWorkspacePage from '../../src/pages/tools/BusinessToolWorkspacePage';
import { FOOTER_COLUMNS, NAV_SECTIONS, SPA_ROUTE_PATTERNS } from '../../src/navigation/registry.generated';
import {
  copyTextToClipboard,
  downloadDocument,
  mimeTypeFor,
  printResult,
  resultToPlainText,
} from '../../src/lib/business-tools-export';
import {
  BUSINESS_TOOLS,
  BUSINESS_TOOLS_ROOT,
  BUSINESS_TOOLS_TOTAL,
  BUSINESS_TOOL_COUNTS,
  businessToolsByCategory,
  defaultInputFor,
} from '../../../src/tools/business';
import type { ResultDocument } from '../../../src/tools/business';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** The MRZ page asks the API whether each tab is enabled; answer that so the tabs render. */
function stubMrzAvailability() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      jsonResponse(200, { calculatorEnabled: true, parserEnabled: true, testDataEnabled: true, availability: 'public' })
    )
  );
}

function renderDirectory(search = '') {
  return render(
    <MemoryRouter initialEntries={[`${BUSINESS_TOOLS_ROOT}${search}`]}>
      <Routes>
        <Route path={BUSINESS_TOOLS_ROOT} element={<BusinessToolsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderWorkspace(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`${BUSINESS_TOOLS_ROOT}/${slug}`]}>
      <Routes>
        <Route path="/tools/business-tools/:tool" element={<BusinessToolWorkspacePage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

/** The cards in the main grid, excluding the two preserved tools in the "Also in" panel. */
function toolCards(): HTMLElement[] {
  const status = screen.getByRole('status');
  const grid = status.parentElement?.querySelector('.bt247-grid');
  return grid ? Array.from(grid.querySelectorAll('article.bt247-card')) : [];
}

/**
 * The result panel's error summary.
 *
 * Not `getByRole('alert')`: every invalid field renders its own `role="alert"` message, so a form
 * with three bad fields has four alerts and the query is ambiguous by design. The summary is the
 * one element that collects them, and it is the one a screen reader is pointed at.
 */
async function errorSummary(): Promise<HTMLElement> {
  await waitFor(() => expect(document.getElementById('bt247-error-summary')).toBeTruthy());
  return document.getElementById('bt247-error-summary')!;
}

/** The rendered metric tiles, as label → value, scoped so a value repeated in a table cannot match. */
function renderedMetrics(): Array<{ label: string; value: string }> {
  return Array.from(document.querySelectorAll('.bt247-metric')).map((node) => ({
    label: node.querySelector('.bt247-metric__label')?.textContent ?? '',
    value: node.querySelector('.bt247-metric__value')?.textContent ?? '',
  }));
}

/**
 * jsdom has no `URL.createObjectURL`. Defined as a property rather than by replacing the global
 * `URL`, because a stubbed global constructor outlives the test that installed it and takes the
 * router and every fetch with it.
 */
function stubObjectUrl(implementation: () => string = () => 'blob:mock') {
  const createObjectURL = vi.fn().mockImplementation(implementation);
  const revokeObjectURL = vi.fn();
  Object.defineProperty(window.URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true });
  Object.defineProperty(window.URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true });
  return { createObjectURL, revokeObjectURL };
}

const ACTION_LABEL = { calculators: 'Calculate', generators: 'Generate', comparisons: 'Compare' } as const;

afterEach(() => {
  cleanup();
  // A test that fails mid-body must not leave fake timers running: `waitFor` would then wait on a
  // clock nothing advances, and every later test in the file would time out instead of reporting
  // its own failure.
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('Business Tools — the registry the page advertises', () => {
  it('holds 21 tools split 5 calculators / 12 generators / 4 comparisons, with unique slugs and paths', () => {
    expect(BUSINESS_TOOLS_TOTAL).toBe(21);
    expect(BUSINESS_TOOL_COUNTS).toEqual({ calculators: 5, generators: 12, comparisons: 4 });
    expect(businessToolsByCategory('calculators')).toHaveLength(5);
    expect(businessToolsByCategory('generators')).toHaveLength(12);
    expect(businessToolsByCategory('comparisons')).toHaveLength(4);

    const slugs = BUSINESS_TOOLS.map((tool) => tool.slug);
    expect(new Set(slugs).size).toBe(21);
    const paths = BUSINESS_TOOLS.map((tool) => tool.path);
    expect(new Set(paths).size).toBe(21);

    for (const tool of BUSINESS_TOOLS) {
      expect(tool.path).toBe(`${BUSINESS_TOOLS_ROOT}/${tool.slug}`);
      expect(typeof tool.compute).toBe('function');
      expect(tool.fields.length).toBeGreaterThan(0);
      // A card with no summary or no stated units is a card a visitor cannot choose between.
      expect(tool.summary.length).toBeGreaterThan(20);
      expect(tool.units.length).toBeGreaterThan(3);
      expect(tool.name.length).toBeGreaterThan(2);
    }
  });

  it('names the jurisdiction, source and effective date for every tool that applies a statutory rule', () => {
    const statutory = BUSINESS_TOOLS.filter((tool) => tool.jurisdiction && !tool.jurisdiction.estimate);
    expect(statutory.length).toBeGreaterThan(0);
    for (const tool of statutory) {
      const note = tool.jurisdiction!;
      expect(note.jurisdiction.length, tool.slug).toBeGreaterThan(2);
      expect(note.source.length, tool.slug).toBeGreaterThan(5);
      expect(note.effectiveDate, tool.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('Business Tools — the directory page', () => {
  it('renders the heading, the intro and all 21 tools with the counts read from the registry', async () => {
    renderDirectory();
    expect(await screen.findByRole('heading', { level: 1, name: 'Business Tools' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Showing 21 of 21 tools');
    expect(toolCards()).toHaveLength(21);

    // Breadcrumbs: Home → Tools → Business Tools, with the last crumb marked as the current page.
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const current = breadcrumb.querySelector('li[aria-current="page"]');
    expect(current?.textContent).toBe('Business Tools');
    expect(within(breadcrumb).getByRole('link', { name: 'Tools' }).getAttribute('href')).toBe('/tools');
    expect(within(breadcrumb).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');

    // Every tool is reachable from its own card, and each card states its units.
    for (const tool of BUSINESS_TOOLS) {
      const card = toolCards().find((element) => within(element).queryByText(tool.name) !== null);
      expect(card, `no card for ${tool.slug}`).toBeTruthy();
      expect(within(card!).getByRole('link', { name: 'Open Tool' }).getAttribute('href')).toBe(tool.path);
      expect(within(card!).getByText(tool.units)).toBeTruthy();
    }
  });

  it('offers four category filters carrying the real counts, and marks the active one', async () => {
    renderDirectory();
    await screen.findByRole('heading', { level: 1, name: 'Business Tools' });

    const filters = screen.getByRole('group', { name: 'Filter tools by category' });
    expect(within(filters).getByRole('button', { name: /All tools \(21\)/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(filters).getByRole('button', { name: /Calculators \(5\)/ })).toBeTruthy();
    expect(within(filters).getByRole('button', { name: /Generators \(12\)/ })).toBeTruthy();
    expect(within(filters).getByRole('button', { name: /Comparisons \(4\)/ })).toBeTruthy();
    for (const button of within(filters).getAllByRole('button')) {
      if (button.textContent?.includes('All tools')) continue;
      expect(button.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('narrows the grid to one category and keeps the filter in the query string', async () => {
    renderDirectory('?category=comparisons');
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Showing 4 of 21 tools'));
    expect(screen.getByRole('status').textContent).toContain('in Comparisons');
    expect(toolCards()).toHaveLength(4);
    for (const tool of businessToolsByCategory('comparisons')) {
      expect(toolCards().some((card) => within(card).queryByText(tool.name) !== null), tool.slug).toBe(true);
    }
    const filters = screen.getByRole('group', { name: 'Filter tools by category' });
    expect(within(filters).getByRole('button', { name: /Comparisons \(4\)/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('switches category on click, and the search box is labelled with the real tool count', async () => {
    renderDirectory();
    await screen.findByRole('heading', { level: 1, name: 'Business Tools' });
    expect(screen.getByLabelText('Search all 21 tools')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Generators \(12\)/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Showing 12 of 21 tools'));
    expect(toolCards()).toHaveLength(12);

    fireEvent.click(screen.getByRole('button', { name: /All tools \(21\)/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Showing 21 of 21 tools'));
  });

  it('searches names, summaries and keywords, and requires every word to match', async () => {
    renderDirectory('?q=pension');
    await waitFor(() => expect(toolCards().length).toBeGreaterThan(0));
    const names = toolCards().map((card) => within(card).getByText(/./, { selector: '.bt247-card__title' }).textContent);
    expect(names).toContain('Pension Calculator');
    // The PFA comparison is about pension fund administrators, so a keyword search must find it too.
    expect(names).toContain('PFA Comparison (Nigeria)');

    // Two words: both must appear. "pension employer" narrows further than "pension" alone.
    cleanup();
    renderDirectory('?q=pension%20employer');
    await waitFor(() => expect(toolCards().length).toBeGreaterThan(0));
    expect(toolCards().length).toBeLessThanOrEqual(names.length);
  });

  it('shows an empty state with a working clear action when nothing matches', async () => {
    renderDirectory('?q=zzz-not-a-tool');
    expect(await screen.findByRole('heading', { name: 'No tools match that search' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Showing 0 of 21 tools');
    expect(toolCards()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Showing 21 of 21 tools'));
    expect(toolCards()).toHaveLength(21);
  });

  it('reports an unknown category instead of rendering an empty grid', async () => {
    renderDirectory('?category=not-a-category');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Unknown category/)).toBeTruthy();
    expect(within(alert).getByText(/not-a-category/)).toBeTruthy();
    expect(within(alert).getByRole('link', { name: 'Show all 21 tools' }).getAttribute('href')).toBe(BUSINESS_TOOLS_ROOT);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps the preserved MRZ and Document Tools panels out of the 21, and links their canonical URLs', async () => {
    renderDirectory();
    await screen.findByRole('heading', { level: 1, name: 'Business Tools' });
    const also = screen.getByRole('heading', { name: 'Also in Business Tools' }).parentElement!;
    const links = within(also).getAllByRole('link', { name: 'Open Tool' }).map((link) => link.getAttribute('href'));
    expect(links).toContain('/tools/mrz-generator');
    expect(links).toContain('/tools/document');
    // The count the hero advertises is the 21, not 23.
    expect(screen.getByRole('status').textContent).toContain('Showing 21 of 21 tools');
  });

  it('states the privacy position and refuses to call its estimates advice', async () => {
    renderDirectory();
    const panel = screen.getByRole('heading', { name: 'How these tools handle your data' }).parentElement!;
    expect(within(panel).getByText(/Nothing is uploaded\./)).toBeTruthy();
    expect(within(panel).getByText(/Nothing is stored\./)).toBeTruthy();
    expect(within(panel).getByText(/Estimates are not advice\./)).toBeTruthy();
    expect(panel.textContent).toMatch(/tax, legal or financial advice/i);
  });
});

describe('Business Tools — one workspace for all 21 tools', () => {
  it.each(BUSINESS_TOOLS.map((tool) => [tool.slug, tool] as const))(
    'renders %s from its schema and ends in the state its engine produces',
    async (_slug, tool) => {
      renderWorkspace(tool.slug);
      expect(await screen.findByRole('heading', { level: 1, name: tool.name })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Inputs' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Result' })).toBeTruthy();
      expect(screen.getByRole('button', { name: ACTION_LABEL[tool.category] })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reset form' })).toBeTruthy();

      // Every declared field is rendered, labelled and wired to an input with a matching id.
      for (const field of tool.fields) {
        const control = document.getElementById(`bt247-field-${field.key}`);
        expect(control, `missing control for ${field.key}`).toBeTruthy();
        expect(document.querySelector(`label[for="bt247-field-${field.key}"]`), `missing label for ${field.key}`).toBeTruthy();
      }

      // The empty state is category-appropriate copy, not a blank box.
      expect(screen.getByText(/yet$/)).toBeTruthy();

      // Running it must produce exactly what the engine produces with the same defaults: a result,
      // or a specific validation error. Never a crash, and never a silent no-op.
      const expected = tool.compute(defaultInputFor(tool));
      fireEvent.click(screen.getByRole('button', { name: ACTION_LABEL[tool.category] }));

      if (expected.ok) {
        await waitFor(() => expect(screen.getByText(`${tool.name} produced a result.`)).toBeTruthy());
        const rendered = renderedMetrics();
        expect(rendered).toHaveLength(expected.result.metrics.length);
        for (const metric of expected.result.metrics) {
          const tile = rendered.find((entry) => entry.label === metric.label);
          expect(tile, `no metric tile for "${metric.label}"`).toBeTruthy();
          expect(tile!.value).toBe(metric.value);
        }
      } else {
        const alert = await errorSummary();
        expect(within(alert).getByText('This could not be run yet')).toBeTruthy();
        expect(alert.textContent).toContain(expected.error.message);
        expect(renderedMetrics()).toHaveLength(0);
      }
    },
    30_000
  );

  it('publishes provenance beside a statutory result and never labels an estimate as advice', async () => {
    renderWorkspace('nigeria-vat-calculator');
    await screen.findByRole('heading', { level: 1, name: 'VAT Calculator' });
    fireEvent.change(screen.getByLabelText(/Base amount/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    const provenance = await waitFor(() => {
      const list = document.querySelector('.bt247-provenance');
      expect(list).toBeTruthy();
      return list!;
    });
    expect(provenance.textContent).toContain('Jurisdiction');
    expect(provenance.textContent).toContain('Source');
    expect(provenance.textContent).toMatch(/Nigeria/);
    expect(provenance.textContent).toMatch(/2020-02-01/);
    // The worked example from the source: ₦100 at 7.5% is ₦7.50 of VAT and ₦107.50 gross.
    expect(screen.getByText('₦7.50')).toBeTruthy();
    expect(screen.getByText('₦107.50')).toBeTruthy();
  });

  it('rejects a missing required amount and clears the field error as soon as it is corrected', async () => {
    renderWorkspace('nigeria-pension-calculator');
    await screen.findByRole('heading', { level: 1, name: 'Pension Calculator' });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    const alert = await errorSummary();
    expect(alert.textContent).toContain('Basic salary is required and must be a number.');
    // The headline names the first field that failed, and the summary links to every one of them
    // in declaration order — housing and transport are required too.
    const basic = screen.getByLabelText(/Basic salary/);
    expect(basic.getAttribute('aria-invalid')).toBe('true');
    const links = within(alert).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#bt247-field-basicSalary',
      '#bt247-field-housingAllowance',
      '#bt247-field-transportAllowance',
    ]);
    expect(screen.getByLabelText(/Housing allowance/).getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(basic, { target: { value: '100000' } });
    expect(screen.getByLabelText(/Basic salary/).getAttribute('aria-invalid')).toBeNull();
  });

  it('refuses an employer pension contribution below the PenCom minimum rather than computing it', async () => {
    renderWorkspace('nigeria-pension-calculator');
    await screen.findByRole('heading', { level: 1, name: 'Pension Calculator' });
    fireEvent.change(screen.getByLabelText(/Basic salary/), { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText(/Housing allowance/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/Transport allowance/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/Employer contribution/), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    const alert = await errorSummary();
    expect(alert.textContent).toMatch(/10%/);
    expect(renderedMetrics()).toHaveLength(0);
  });

  it('computes the statutory pension example end to end, with the working shown', async () => {
    renderWorkspace('nigeria-pension-calculator');
    await screen.findByRole('heading', { level: 1, name: 'Pension Calculator' });
    fireEvent.change(screen.getByLabelText(/Basic salary/), { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText(/Housing allowance/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/Transport allowance/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    await waitFor(() => expect(screen.getByText('Pension Calculator produced a result.')).toBeTruthy());
    // 8% employee and 10% employer on a ₦100,000 pensionable base — the worked example the
    // statutory source publishes, to the kobo.
    expect(renderedMetrics()).toEqual([
      { label: 'Employee contribution', value: '₦8,000.00' },
      { label: 'Employer contribution', value: '₦10,000.00' },
      { label: 'Total monthly remittance', value: '₦18,000.00' },
      { label: 'Pensionable base', value: '₦100,000.00' },
    ]);
    expect(screen.getByRole('heading', { name: 'How this was calculated' })).toBeTruthy();
    // The generated schedule is downloadable, and states what it is.
    expect(screen.getByRole('button', { name: /^Download pension-contribution-schedule\.csv$/ })).toBeTruthy();
  });

  it('resets the form back to its defaults and clears the result', async () => {
    renderWorkspace('nigeria-pension-calculator');
    await screen.findByRole('heading', { level: 1, name: 'Pension Calculator' });
    fireEvent.change(screen.getByLabelText(/Basic salary/), { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText(/Housing allowance/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/Transport allowance/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(document.querySelectorAll('.bt247-metric').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Reset form' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Form reset to its defaults.'));
    expect((screen.getByLabelText(/Basic salary/) as HTMLInputElement).value).toBe('');
    expect(document.querySelectorAll('.bt247-metric')).toHaveLength(0);
    expect(screen.getByText('No calculation yet')).toBeTruthy();
  });

  it('offers the related tools in the same category and a link back to the directory', async () => {
    renderWorkspace('nigeria-vat-calculator');
    await screen.findByRole('heading', { level: 1, name: 'VAT Calculator' });
    const related = screen.getByRole('heading', { name: 'More Calculators' }).parentElement!;
    const hrefs = within(related).getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs).not.toContain(`${BUSINESS_TOOLS_ROOT}/nigeria-vat-calculator`);
    for (const href of hrefs) expect(href!.startsWith(`${BUSINESS_TOOLS_ROOT}/`)).toBe(true);
    expect(screen.getByRole('link', { name: 'Back to the directory' }).getAttribute('href')).toBe(BUSINESS_TOOLS_ROOT);
  });

  it('shows a not-found state for an unregistered slug instead of an empty workspace', async () => {
    renderWorkspace('definitely-not-a-tool');
    expect(await screen.findByRole('heading', { level: 1, name: 'That tool is not in Business Tools' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Check the address');
    expect(screen.getByRole('link', { name: 'Back to Business Tools' }).getAttribute('href')).toBe(BUSINESS_TOOLS_ROOT);
    expect(screen.queryByRole('heading', { name: 'Inputs' })).toBeNull();
  });
});

describe('Business Tools — exports the visitor can actually take away', () => {
  const DOCUMENT: ResultDocument = {
    label: 'Offer letter',
    filename: 'offer-letter.txt',
    format: 'text',
    content: 'Dear Candidate,\nWe are pleased to offer you the role.',
  };

  it('maps every supported document format to a real MIME type', () => {
    expect(mimeTypeFor('text')).toBe('text/plain;charset=utf-8');
    expect(mimeTypeFor('csv')).toBe('text/csv;charset=utf-8');
    expect(mimeTypeFor('svg')).toBe('image/svg+xml;charset=utf-8');
    expect(mimeTypeFor('markdown')).toBe('text/markdown;charset=utf-8');
    expect(mimeTypeFor('json')).toBe('application/json;charset=utf-8');
  });

  it('copies through the Clipboard API, and falls back to execCommand when the API is absent', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    expect(await copyTextToClipboard('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');

    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;
    expect(await copyTextToClipboard('legacy')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('reports a blocked clipboard honestly instead of claiming success', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true });
    document.execCommand = vi.fn().mockReturnValue(false);
    expect(await copyTextToClipboard('nope')).toBe(false);
  });

  it('downloads a generated document through an object URL and revokes it', () => {
    const { createObjectURL, revokeObjectURL } = stubObjectUrl();
    const clicked: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });

    // Fake timers only around the revoke assertion, and released in a finally: a leak here would
    // stall every later test in the file on a clock nothing advances.
    vi.useFakeTimers();
    try {
      expect(downloadDocument(DOCUMENT)).toBe(true);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0]![0] as Blob;
      expect(blob.type).toBe('text/plain;charset=utf-8');
      expect(clicked).toEqual(['offer-letter.txt']);
      // The anchor is a means to an end: it must not be left in the document.
      expect(document.querySelector('a[download="offer-letter.txt"]')).toBeNull();

      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    } finally {
      vi.useRealTimers();
      clickSpy.mockRestore();
    }
  });

  it('flattens a result into readable plain text for the clipboard', () => {
    const text = resultToPlainText({
      metrics: [{ label: 'Monthly tax', value: '₦61,970', hint: 'after reliefs' }],
      tables: [{ title: 'Breakdown', columns: ['Item', 'Amount'], rows: [{ label: 'Gross', cells: ['₦500,000'] }] }],
      explanation: ['Bands applied progressively.'],
      warnings: ['Not tax advice.'],
    });
    expect(text).toContain('Monthly tax: ₦61,970 (after reliefs)');
    expect(text).toContain('BREAKDOWN');
    expect(text).toContain('Item\tAmount');
    expect(text).toContain('Gross\t₦500,000');
    expect(text).toContain('HOW THIS WAS CALCULATED');
    expect(text).toContain('- Not tax advice.');
  });

  it('wires copy and print in the workspace and reports what happened', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    const print = vi.fn();
    vi.stubGlobal('print', print);
    window.print = print;

    renderWorkspace('nigeria-vat-calculator');
    await screen.findByRole('heading', { level: 1, name: 'VAT Calculator' });
    fireEvent.change(screen.getByLabelText(/Base amount/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    await waitFor(() => expect(screen.getByText('₦107.50')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Copy result' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Copied to your clipboard.'));
    expect(writeText.mock.calls[0]![0]).toContain('₦107.50');

    fireEvent.click(screen.getByRole('button', { name: 'Print result' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(printResult()).toBe(true);
  });

  it('offers a real download for a generated document, and says so when the browser blocks it', async () => {
    const { createObjectURL } = stubObjectUrl();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    renderWorkspace('business-card-generator');
    await screen.findByRole('heading', { level: 1, name: 'Business Card Generator' });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    const download = await screen.findByRole('button', { name: /^Download / });
    expect(download.textContent).toContain('.svg');
    fireEvent.click(download);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Downloading'));
    expect(createObjectURL).toHaveBeenCalled();
    const svg = document.querySelector('.bt247-document__body--svg svg');
    expect(svg, 'the generated SVG is rendered inline').toBeTruthy();
  });

  it('reports a blocked download rather than pretending the file arrived', () => {
    stubObjectUrl(() => {
      throw new Error('blocked by the browser');
    });
    expect(downloadDocument(DOCUMENT)).toBe(false);
  });
});

describe('Business Tools — routing, backwards compatibility and navigation', () => {
  it('still serves the pre-existing /tools/mrz-generator URL, unchanged', async () => {
    stubMrzAvailability();
    renderAppAt('/tools/mrz-generator');
    expect(await screen.findByRole('heading', { level: 1, name: 'MRZ Generator' })).toBeTruthy();
  });

  it('serves the MRZ tool inside the renamed section as well, without duplicating the tool', async () => {
    stubMrzAvailability();
    renderAppAt('/tools/business-tools/mrz-generator');
    expect(await screen.findByRole('heading', { level: 1, name: 'MRZ Calculator' })).toBeTruthy();
    cleanup();
    stubMrzAvailability();
    renderAppAt('/tools/business-tools/mrz-parser');
    expect(await screen.findByRole('heading', { level: 1, name: 'MRZ Parser' })).toBeTruthy();
  });

  it('routes /tools/business-tools to the directory and a tool slug to its workspace', async () => {
    renderAppAt(BUSINESS_TOOLS_ROOT);
    expect(await screen.findByRole('heading', { level: 1, name: 'Business Tools' })).toBeTruthy();
    cleanup();
    renderAppAt(`${BUSINESS_TOOLS_ROOT}/nigeria-paye-net-salary-calculator`);
    expect(await screen.findByRole('heading', { level: 1, name: 'PAYE & Net Salary Calculator' })).toBeTruthy();
  });

  it('does not let the Tools Center catch-all claim a Business Tools slug', async () => {
    // Every business tool path must be answered by the workspace, not by /tools/*'s generic page.
    renderAppAt(`${BUSINESS_TOOLS_ROOT}/hmo-comparison-nigeria`);
    expect(await screen.findByRole('heading', { level: 1, name: 'HMO Comparison (Nigeria)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Result' })).toBeTruthy();
  });

  it('publishes Business Tools as the Tools mega menu’s featured card, keeping the live-data contract', () => {
    const tools = NAV_SECTIONS.find((section) => section.id === 'tools');
    expect(tools).toBeTruthy();
    expect(tools!.toolsDriven).toBe(true);
    // The panel's *entries* stay live data from /api/tools/navigation: no static groups, ever.
    expect(tools!.groups).toEqual([]);
    expect(tools!.featured?.title).toBe('Business Tools');
    expect(tools!.featured?.to).toBe('/tools/business-tools');
    expect(tools!.featured?.ctaLabel).toBeTruthy();
    expect(tools!.featured!.body.length).toBeGreaterThan(20);
  });

  it('publishes Business Tools in the site footer and keeps the MRZ link beside it', () => {
    const column = FOOTER_COLUMNS.find((entry) => entry.title === 'Tools');
    expect(column).toBeTruthy();
    const hrefs = column!.links.map((link) => link.to);
    expect(hrefs).toContain('/tools/business-tools');
    expect(hrefs).toContain('/tools/mrz-generator');
    const business = column!.links.find((link) => link.to === '/tools/business-tools');
    expect(business!.label).toBe('Business Tools');
  });

  it('renders the footer link on the page a visitor actually sees', async () => {
    renderAppAt(BUSINESS_TOOLS_ROOT);
    await screen.findByRole('heading', { level: 1, name: 'Business Tools' });
    const footerLinks = screen.getAllByRole('link', { name: 'Business Tools' });
    expect(footerLinks.some((link) => link.getAttribute('href') === '/tools/business-tools')).toBe(true);
  });

  it('declares a router pattern for the directory and for a tool slug', () => {
    const patterns = new Set(SPA_ROUTE_PATTERNS);
    expect(patterns.has('/tools/business-tools')).toBe(true);
    expect(patterns.has('/tools/business-tools/:tool')).toBe(true);
    expect(patterns.has('/tools/mrz-generator')).toBe(true);
  });
});
