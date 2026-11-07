// @vitest-environment jsdom
import { cleanup, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '../../src/layout/Header';
import Footer from '../../src/layout/Footer';
import { FOOTER_COLUMNS, NAV_SECTIONS } from '../../src/navigation/registry.generated';

/**
 * The header was flattened: every registry section is a direct, always-visible link beside the
 * logo, with no trigger buttons, no aria-expanded disclosures, no mega panel, no compact
 * dropdown, no hamburger and no `+` accordion. These tests pin that contract plus the
 * professional four-column dark footer. All content is asserted against the generated registry,
 * so a menu that drifts from the sitemap fails here rather than in production.
 */

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((media: string) => ({
    matches: false,
    media,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Flat single-row menu with no dropdowns', () => {
  it('renders every registry section as a direct link in the bar', () => {
    const { container } = render(<MemoryRouter><Header /></MemoryRouter>);
    expect(container.querySelector('.hg-header .hg-nav__bar')).toBeTruthy();

    const links = container.querySelectorAll('.hg-menu__link');
    expect(links).toHaveLength(NAV_SECTIONS.length);
    [...links].forEach((link, index) => {
      expect(link.textContent?.trim()).toBe(NAV_SECTIONS[index].label);
      expect(link.getAttribute('href')).toBe(NAV_SECTIONS[index].to);
      expect(link.tagName).toBe('A');
    });

    // Nothing is hidden behind a disclosure any more.
    expect(container.querySelectorAll('.hg-nav__trigger')).toHaveLength(0);
    expect(container.querySelectorAll('.hg-mega')).toHaveLength(0);
    expect(container.querySelectorAll('.hg-drawer__toggle')).toHaveLength(0);
    expect(container.querySelectorAll('.hg-nav__toggle')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-expanded]')).toHaveLength(2); // the two locale settings only
  });

  it('keeps the settings and account controls inline in the menu area', () => {
    const { container } = render(<MemoryRouter><Header /></MemoryRouter>);
    const primary = container.querySelector<HTMLElement>('#ch247-primary-nav')!;
    expect(primary).toBeTruthy();

    // Settings live in the bar, not the footer (also pinned by Header.test.tsx).
    expect(within(primary).getByRole('button', { name: 'Language: English' })).toBeTruthy();
    expect(within(primary).getByRole('button', { name: /^Display currency: USD/ })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Sign In' })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Create Account' })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Pricing' })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Help' })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Cart' })).toBeTruthy();

    // Every section link is visible in the DOM — no panel is collapsed or hidden.
    const links = [...primary.querySelectorAll('.hg-menu__link')];
    expect(links.length).toBe(NAV_SECTIONS.length);
    links.forEach((link) => expect(link.hasAttribute('hidden')).toBe(false));
  });
});

describe('Professional footer directory', () => {
  it('has a brand intro, four balanced columns with eight labelled sub-groups, and a legal bar', () => {
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    const footer = container.querySelector<HTMLElement>('footer.ch247-footer.hg-footer')!;
    expect(footer).toBeTruthy();

    expect(footer.querySelector('.hg-footer__intro')).toBeTruthy();
    expect(footer.querySelector('.hg-footer__brand img')?.getAttribute('src')).toContain('white');
    expect(footer.querySelector('.hg-footer__bottom')).toBeTruthy();
    expect(footer.querySelector('.hg-footer__bottom .hg-footer__top')?.getAttribute('href')).toBe('#ch247-top');
    expect(footer.querySelector('.hg-footer__locale')).toBeTruthy();
    expect(footer.querySelector('.hg-footer__legal-links')).toBeTruthy();

    const columns = footer.querySelectorAll('.hg-footer__column');
    expect(columns).toHaveLength(4);
    expect([...columns].map((column) => column.querySelector('h2')?.textContent)).toEqual([
      'Products & Domains', 'Cloud & Resources', 'Developers & Tools', 'Company & Legal',
    ]);
    const subgroups = footer.querySelectorAll('.hg-footer__subgroup');
    expect(subgroups).toHaveLength(8);
    expect([...subgroups].map((group) => group.querySelector('h3')?.textContent)).toEqual([
      'Hosting', 'Domains', 'Infrastructure', 'Resources',
      'Developers', 'Tools', 'Company', 'Legal',
    ]);

    // Every destination rendered in the footer comes from the shared registry, and every
    // registry destination is still reachable — rearranging columns must not silently drop a link.
    const registryPaths = new Set(FOOTER_COLUMNS.flatMap((column) => column.links.map((link) => link.to)));
    const rendered = [...footer.querySelectorAll('.hg-footer__column a')].map((a) => a.getAttribute('href'));
    expect(rendered.length).toBeGreaterThan(10);
    rendered.forEach((href) => expect(registryPaths.has(href!)).toBe(true));
    expect([...registryPaths].filter((path) => !rendered.includes(path))).toEqual([]);
    const counts = [...columns].map((column) => column.querySelectorAll('a').length);
    expect(Math.max(...counts)).toBeLessThanOrEqual(Math.min(...counts) * 2);

    // Switchers live in the header only (also pinned by Header.test.tsx).
    expect(within(footer).queryByRole('button', { name: /Language:/i })).toBeNull();
    expect(within(footer).queryByRole('button', { name: /Display currency:/i })).toBeNull();
  });
});
