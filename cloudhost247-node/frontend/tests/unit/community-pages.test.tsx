// @vitest-environment jsdom
/**
 * Community Forum frontend behaviour.
 *
 * These render the real `/community` route inside the real app shell against a mocked HTTP
 * contract, so what is asserted is what a visitor actually gets: the live statistics the API
 * returned, threads linked by their own slug, the honest empty state of a forum with no posts,
 * and a sign-up prompt instead of a composer for someone who is not signed in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../src/App';
import { plural } from '../../src/components/community/CommunityUI';
import type { CommunityHome } from '../../src/lib/community-api';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function author(username: string, standing: 'member' | 'staff' = 'member') {
  return {
    id: `user-${username}`,
    username,
    displayName: username,
    standing,
    reputation: 12,
    joinedAt: '2026-01-04T09:00:00.000Z',
  };
}

const home: CommunityHome = {
  stats: { members: 1204, discussions: 87, replies: 412, solved: 31, activeToday: 9 },
  categories: [
    {
      id: 'cat-dns',
      slug: 'domains-dns',
      name: 'Domains & DNS',
      description: 'Nameservers, records and transfers.',
      purpose: 'question',
      acceptsSolutions: true,
      staffOnlyPosting: false,
      isEnabled: true,
      position: 1,
      discussionCount: 41,
      replyCount: 190,
      solvedCount: 18,
      lastActivityAt: '2026-11-12T10:00:00.000Z',
    },
  ],
  latest: [
    {
      id: 'd-1',
      slug: 'cname-redirect-keeps-target-path',
      title: 'CNAME redirect keeps the old path',
      preview: 'After adding the CNAME the old path still resolves.',
      tags: ['dns'],
      category: { id: 'cat-dns', slug: 'domains-dns', name: 'Domains & DNS' },
      author: author('dana'),
      isPinned: false,
      isLocked: false,
      isSolved: true,
      replyCount: 1,
      reactionCount: 2,
      viewCount: 44,
      lastActivityAt: '2026-11-12T10:00:00.000Z',
      createdAt: '2026-11-11T10:00:00.000Z',
    },
  ],
  popular: [],
  trending: [],
  unanswered: [],
  solved: [],
  contributors: [{ ...author('marcus', 'staff'), acceptedAnswers: 1 }],
  canParticipate: true,
};

/** Answers `/api/v1/community/home` with `payload`; everything else the shell asks for gets `{}`. */
function stubApi(payload: CommunityHome) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.startsWith('/api/v1/community/home') ? payload : {};
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderCommunity() {
  return render(
    <MemoryRouter initialEntries={['/community']}>
      <App />
    </MemoryRouter>
  );
}

describe('/community', () => {
  beforeEach(() => {
    stubApi(home);
  });

  it('renders the statistics and threads the API returned, linked by their own slug', async () => {
    renderCommunity();

    // The statistics strip renders a placeholder while loading, so wait for the real number —
    // then the rest of the strip must agree with the same response.
    await screen.findByText('1,204');
    const stats = screen.getByLabelText('Community statistics');
    expect(within(stats).getByText('87')).toBeTruthy();
    expect(within(stats).getByText('412')).toBeTruthy();
    expect(within(stats).getByText('31')).toBeTruthy();

    const thread = await screen.findByRole('link', { name: 'CNAME redirect keeps the old path' });
    expect(thread.getAttribute('href')).toBe('/community/discussion/cname-redirect-keeps-target-path');
    expect(screen.getByText('✓ Solved')).toBeTruthy();
  });

  it('labels a question category Q&A, counts solved threads, and never prints "1 solutions"', async () => {
    renderCommunity();

    const category = await screen.findByRole('link', { name: /Q&A/ });
    expect(category.getAttribute('href')).toBe('/community/category/domains-dns');
    expect(within(category).getByText('18 solved')).toBeTruthy();

    // The accepted-answer count on a contributor must not read "1 solutions".
    expect(await screen.findByText(/·\s*1 solution$/)).toBeTruthy();
    expect(screen.queryByText(/1 solutions/)).toBeNull();
  });

  it('offers registration and sign-in to an anonymous visitor instead of a composer', async () => {
    renderCommunity();

    expect(await screen.findByRole('link', { name: 'Join the community' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in to post' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Start a discussion' })).toBeNull();
  });

  it('shows the composer entry point once a session is stored', async () => {
    localStorage.setItem('ch247_token', 'test-token');
    localStorage.setItem('ch247_user', JSON.stringify({ id: 'u1', email: 'dana@example.com', fullName: 'Dana', role: 'customer' }));
    renderCommunity();

    expect(await screen.findByRole('link', { name: 'Start a discussion' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Join the community' })).toBeNull();
  });

  it('keeps an empty forum honest instead of inventing threads', async () => {
    vi.unstubAllGlobals();
    stubApi({
      ...home,
      stats: { members: 0, discussions: 0, replies: 0, solved: 0, activeToday: 0 },
      latest: [],
      contributors: [],
    });
    renderCommunity();

    expect(await screen.findByRole('heading', { name: 'No discussions yet' })).toBeTruthy();
    expect(screen.getByText(/every question has at least one reply/i)).toBeTruthy();
    expect(screen.getByText(/does not list accounts that have not taken part/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'CNAME redirect keeps the old path' })).toBeNull();
  });
});

describe('plural', () => {
  it('singularises one and pluralises everything else', () => {
    expect(plural(1, 'reply', 'replies')).toBe('reply');
    expect(plural(0, 'reply', 'replies')).toBe('replies');
    expect(plural(2, 'reply', 'replies')).toBe('replies');
    expect(plural(1, 'view')).toBe('view');
    expect(plural(3, 'view')).toBe('views');
  });
});
