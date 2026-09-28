import { useEffect } from 'react';

const SITE_NAME = 'CloudHost247';

/**
 * Sets a per-route document title (and meta description) client-side.
 *
 * This app is a client-rendered SPA with no server-side rendering, so a search engine crawler
 * that doesn't execute JavaScript will still only see frontend/index.html's static fallback
 * title/description (see that file) — that is a known limitation of the client-only rendering
 * approach chosen for Phase 1/2, not an oversight. This hook is what makes the title/description
 * correct for real browsers (tab titles, bookmarks, and browser history), and for any crawler
 * that does execute JavaScript. If server-rendered/pre-rendered meta tags become a requirement
 * later (e.g. for search ranking of the public marketing pages), that would be a separate,
 * explicitly-scoped piece of work — not assumed here.
 */
export function usePageMeta(title: string, description?: string): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title === SITE_NAME ? SITE_NAME : `${title} · ${SITE_NAME}`;

    let descriptionTag: HTMLMetaElement | null = null;
    let previousDescription: string | null = null;
    if (description) {
      descriptionTag = document.querySelector('meta[name="description"]');
      if (descriptionTag) {
        previousDescription = descriptionTag.getAttribute('content');
      } else {
        descriptionTag = document.createElement('meta');
        descriptionTag.setAttribute('name', 'description');
        document.head.appendChild(descriptionTag);
      }
      descriptionTag.setAttribute('content', description);
    }

    return () => {
      document.title = previousTitle;
      if (descriptionTag && previousDescription !== null) {
        descriptionTag.setAttribute('content', previousDescription);
      }
    };
  }, [title, description]);
}
