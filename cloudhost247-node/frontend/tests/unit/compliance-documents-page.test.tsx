// @vitest-environment jsdom
/**
 * Compliance & Document Tools hub.
 *
 * The registry footer links `/tools/compliance-documents` on every page. The app had no route for
 * it, so the link fell through to the tools catch-all and rendered "Tool not found" — a dead link in
 * the footer of the whole site, invisible to the tests because the existing link check treats every
 * `/tools/...` path as served.
 *
 * This file covers the page that fixes it, and the two rules that keep it from becoming another
 * version of the same problem:
 *
 *   1. every entry is looked up in the live catalogue, so a tool this platform does not serve is
 *      dropped rather than linked;
 *   2. a catalogue that cannot be loaded is stated plainly, with a route out, instead of rendering an
 *      empty page that looks like an empty collection.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ComplianceDocumentsPage from '../../src/pages/tools/ComplianceDocumentsPage';

/** The catalogue returns display names, and the page renders those as the link text. */
const NAMES: Record<string, string> = {
  'mrz-generator': 'MRZ Generator',
  'word-counter': 'Word Counter',
  'password-tools': 'Password Tools',
  'uuid-generator': 'UUID Generator',
  'json-tools': 'JSON Tools',
  'image-ocr': 'Image to Text',
  'qr-scanner': 'QR Scanner',
};

function catalogueResponse(slugs: string[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      categories: [],
      discoveryCategories: [],
      count: slugs.length,
      masterEnabled: true,
      anonymousAccess: true,
      tools: slugs.map((slug) => ({
        slug,
        name: NAMES[slug] ?? slug,
        category: 'productivity',
        summary: `About ${slug}.`,
        description: '',
        icon: 'tool',
        path: `/tools/${slug}`,
        apiPath: `/api/tools/${slug}`,
        status: 'ACTIVE',
      })),
    }),
  };
}

function stubCatalogue(slugs: string[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalogueResponse(slugs)));
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/tools/compliance-documents']}>
      <ComplianceDocumentsPage />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Compliance & Document Tools hub', () => {
  it('links only the tools the catalogue actually serves', async () => {
    // Two of the four groups' tools are served; `image-ocr` and `qr-scanner` deliberately are not.
    stubCatalogue(['mrz-generator', 'word-counter', 'password-tools', 'uuid-generator', 'json-tools']);
    renderPage();

    await waitFor(() => expect(screen.getByRole('link', { name: /MRZ Generator/i })).toBeTruthy());
    expect(screen.getByRole('link', { name: /JSON Tools/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Image to Text/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /QR Scanner/i })).toBeNull();

    // Every rendered link points at a tool route, never at a slug the catalogue does not hold.
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    for (const href of hrefs.filter((value) => value.startsWith('/tools/'))) {
      expect(['/tools/mrz-generator', '/tools/word-counter', '/tools/password-tools', '/tools/uuid-generator', '/tools/json-tools']).toContain(href);
    }
  });

  it('drops a group entirely when none of its tools are served, instead of showing an empty heading', async () => {
    stubCatalogue(['mrz-generator']);
    renderPage();

    await waitFor(() => expect(screen.getByRole('link', { name: /MRZ Generator/i })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: /security & secrets/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^developer$/i })).toBeNull();
    expect(screen.getByRole('heading', { name: /identity & document/i })).toBeTruthy();
  });

  it('says so when the catalogue cannot be loaded, and offers a way out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/could not be loaded/i)).toBeTruthy();
    expect(within(alert).getByText(/Failed to fetch/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /open the tools center/i })).toBeTruthy();
  });

  it('states that the collection loads before the catalogue arrives', () => {
    stubCatalogue(['mrz-generator']);
    renderPage();
    expect(screen.getByRole('status').textContent).toMatch(/loading/i);
  });

  it('never claims the tools certify anything', async () => {
    stubCatalogue(['mrz-generator']);
    renderPage();
    await waitFor(() => expect(screen.getByRole('link', { name: /MRZ Generator/i })).toBeTruthy());
    const page = document.body.textContent ?? '';

    /* The page is allowed to *disclaim* certification — "none of them authenticate a document,
       certify a compliance programme or prove that a system is secure" — so a substring search for
       "certif" proves nothing. The rule that matters is that no sentence makes the claim without
       denying it, which is what this checks: every sentence that mentions certification, approval
       or a guarantee must also contain a negation. */
    const sentences = page.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
    const claimWords = /certif|approv|guarantee|accredited|government-verified/i;
    const negation = /\b(no|not|never|none|nothing|n't|cannot)\b/i;
    const unsupported = sentences.filter((sentence) => claimWords.test(sentence) && !negation.test(sentence));
    expect(unsupported, `These sentences make a claim without denying it:\n${unsupported.join('\n')}`).toEqual([]);

    // And the disclaimer is actually on the page.
    expect(page).toMatch(/none of them authenticate/i);
  });
});
