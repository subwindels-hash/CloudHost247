// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FaqPage from '../../src/pages/FaqPage';
import { searchSite } from '../../src/lib/search-api';

/**
 * Frontend unit tests for the searchable knowledge base (K05):
 * - the FAQ page renders the generated FAQ entries as Markdown,
 * - the search client sends the query to the server and normalises the response.
 */
describe('FAQ page (public knowledge)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders every generated FAQ item as a question with a Markdown answer', async () => {
    render(
      <MemoryRouter initialEntries={['/faq']}>
        <FaqPage />
      </MemoryRouter>
    );
    // The FAQ has 12 items; each is an article whose heading is the question.
    const questions = await screen.findAllByRole('heading', { level: 3 });
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.map((q) => q.textContent)).toContain('What is CloudHost247?');
    expect(questions.map((q) => q.textContent)).toContain('Do you provide 24/7 customer support?');
    // Answers are rendered, not blank.
    const firstAnswer = questions[0].closest('article')?.querySelector('p, ul');
    expect(firstAnswer?.textContent?.trim().length).toBeGreaterThan(0);
  });
});

describe('search client (lib/search-api)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the query to /api/v1/search and returns the normalised response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        query: 'vps',
        results: [
          {
            href: '/cloud/vps',
            title: 'Compute VPS Hosting',
            category: 'Page · Cloud',
            description: 'Guaranteed virtual resources.',
            snippet: '…virtual resources…',
            score: 12,
          },
        ],
        total: 1,
        limit: 20,
      }),
    });

    const response = await searchSite('vps');

    expect(fetch).toHaveBeenCalledTimes(1);
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUrl).toBe('/api/v1/search?q=vps');
    expect(response.query).toBe('vps');
    expect(response.results).toHaveLength(1);
    expect(response.results[0].title).toBe('Compute VPS Hosting');
    expect(response.total).toBe(1);
    expect(response.limit).toBe(20);
  });

  it('appends an explicit limit when one is supplied', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ query: 'dns', results: [], total: 0, limit: 5 }),
    });
    await searchSite('dns', 5);
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUrl).toBe('/api/v1/search?q=dns&limit=5');
  });
});
