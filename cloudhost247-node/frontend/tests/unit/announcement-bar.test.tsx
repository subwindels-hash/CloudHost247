// @vitest-environment jsdom
/**
 * The announcement bar scrolls, which makes it easy to ship something that is unusable for
 * exactly the people it has to work for. These tests pin the parts that are not decoration: the
 * loop is seamless (two identical groups), the duplicate is hidden from assistive technology and
 * from the tab order, and every message points at a route this build serves.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AnnouncementBar from '../../src/components/AnnouncementBar';
import { ANNOUNCEMENTS } from '../../src/content/announcements';

afterEach(() => cleanup());

function renderBar() {
  return render(
    <MemoryRouter>
      <AnnouncementBar />
    </MemoryRouter>
  );
}

describe('AnnouncementBar', () => {
  it('is announced once to a screen reader, not twice', () => {
    renderBar();
    const region = screen.getByRole('region', { name: 'Site announcements' });
    expect(region).toBeTruthy();

    const groups = region.querySelectorAll('.ch-announce__group');
    // Two groups: the original and the seamless-loop clone.
    expect(groups).toHaveLength(2);
    expect(groups[0].getAttribute('aria-hidden')).toBeNull();
    expect(groups[1].getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the duplicated links out of the tab order', () => {
    renderBar();
    const [original, clone] = Array.from(
      document.querySelectorAll('.ch-announce__group')
    );
    expect(original.querySelectorAll('a[tabindex="-1"]')).toHaveLength(0);
    const cloneLinks = clone.querySelectorAll('a');
    expect(cloneLinks.length).toBeGreaterThan(0);
    cloneLinks.forEach((link) => expect(link.getAttribute('tabindex')).toBe('-1'));
  });

  it('renders every announcement with its star, and the star gradients only once', () => {
    renderBar();
    const items = document.querySelectorAll('.ch-announce__group:not(.ch-announce__group--clone) .ch-announce__item');
    expect(items).toHaveLength(ANNOUNCEMENTS.length);
    // The star is a <use> of one <symbol>: ten inline copies would mean ten duplicate gradient ids.
    const symbols = document.querySelectorAll('#ch-announce-star');
    expect(symbols).toHaveLength(1);
    items.forEach((item) => expect(item.querySelector('.ch-announce__star use')).toBeTruthy());
  });

  it('links only to internal routes, so a message can never point off-site', () => {
    renderBar();
    const hrefs = Array.from(document.querySelectorAll('.ch-announce__link')).map((a) =>
      a.getAttribute('href')
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/[A-Za-z0-9/_-]*$/);
    }
  });

  it('renders nothing when there is nothing verified to announce', () => {
    const published = ANNOUNCEMENTS.splice(0, ANNOUNCEMENTS.length);
    try {
      const { container } = renderBar();
      expect(container.firstChild).toBeNull();
    } finally {
      ANNOUNCEMENTS.push(...published);
    }
  });
});
