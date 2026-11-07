// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '../../src/layout/Header';
import Footer from '../../src/layout/Footer';
import { FOOTER_COLUMNS, NAV_SECTIONS } from '../../src/navigation/registry.generated';

/**
 * The header keeps all seven registry sections visible as direct links beside the logo, and each
 * now has its own dropdown arrow that opens a directory of that section's real registry
 * sub-links. Nothing hides behind a hamburger, a `+` accordion or a legacy mega panel. All
 * content is asserted against the generated registry, so a menu that drifts from the sitemap
 * fails here rather than in production.
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

describe('Top menu with per-section dropdown arrows', () => {
  it('renders every registry section as a direct link in the bar', () => {
    const { container } = render(<MemoryRouter><Header /></MemoryRouter>);
    expect(container.querySelector('.hg-header .hg-nav__bar')).toBeTruthy();

    const links = container.querySelectorAll('.hg-menu__link');
    expect(links).toHaveLength(NAV_SECTIONS.length);
    [...links].forEach((link, index) => {
      expect(link.textContent?.trim()).toBe(NAV_SECTIONS[index].label);
      expect(link.getAttribute('href')).toBe(NAV_SECTIONS[index].to);
      expect(link.tagName).toBe('A');
      expect(link.hasAttribute('hidden')).toBe(false);
    });

    // No legacy collapsed chrome came back with the arrows.
    expect(container.querySelectorAll('.hg-nav__trigger')).toHaveLength(0);
    expect(container.querySelectorAll('.hg-mega')).toHaveLength(0);
    expect(container.querySelectorAll('.hg-drawer__toggle')).toHaveLength(0);
    expect(container.querySelectorAll('.hg-nav__toggle')).toHaveLength(0);
  });

  it('puts a labelled, collapsed dropdown arrow beside every section link', () => {
    const { container } = render(<MemoryRouter><Header /></MemoryRouter>);
    const carets = [...container.querySelectorAll<HTMLButtonElement>('.hg-menu__caret')];
    expect(carets).toHaveLength(NAV_SECTIONS.length);
    carets.forEach((caret, index) => {
      expect(caret.getAttribute('aria-label')).toBe(`${NAV_SECTIONS[index].label} sub-links`);
      expect(caret.getAttribute('aria-expanded')).toBe('false');
      expect(caret.getAttribute('aria-controls')).toBe('ch247-menu-panel');
      expect(caret.previousElementSibling?.textContent?.trim()).toBe(NAV_SECTIONS[index].label);
    });

    const panel = container.querySelector<HTMLElement>('#ch247-menu-panel');
    expect(panel).toBeTruthy();
    expect(panel?.hasAttribute('hidden')).toBe(true);
    // Seven arrows plus the two always-inline language/currency settings disclosures.
    expect(container.querySelectorAll('[aria-expanded]')).toHaveLength(NAV_SECTIONS.length + 2);
  });

  it('opens the matching registry sub-links on the top menu and closes on Escape', () => {
    const { container } = render(<MemoryRouter><Header /></MemoryRouter>);
    const carets = [...container.querySelectorAll<HTMLButtonElement>('.hg-menu__caret')];
    const panel = container.querySelector<HTMLElement>('#ch247-menu-panel')!;

    fireEvent.click(carets[0]);
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(panel.getAttribute('aria-label')).toBe('Hosting sub-links');
    expect(carets[0].getAttribute('aria-expanded')).toBe('true');
    expect(carets.slice(1).every((c) => c.getAttribute('aria-expanded') === 'false')).toBe(true);

    const expected = NAV_SECTIONS[0].groups.flatMap((group) => group.links.map((link) => link.to));
    const rendered = [...panel.querySelectorAll<HTMLAnchorElement>('.hg-menu__sublink')]
      .map((a) => a.getAttribute('href'));
    expect(rendered.length).toBe(expected.length);
    expect(rendered).toEqual(expected);
    expect(panel.querySelectorAll('.hg-menu__group').length).toBe(NAV_SECTIONS[0].groups.length);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect(carets[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the settings and account controls inline on the utility line', () => {
    const { container } = render(<MemoryRouter><Header /></MemoryRouter>);
    const primary = container.querySelector<HTMLElement>('#ch247-primary-nav')!;
    expect(primary).toBeTruthy();

    expect(within(primary).getByRole('button', { name: 'Language: English' })).toBeTruthy();
    expect(within(primary).getByRole('button', { name: /^Display currency: USD/ })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Sign In' })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Create Account' })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Pricing' })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Help' })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Cart' })).toBeTruthy();

    // All six controls are children of one single, non-wrapping line beside the announcement.
    const line = container.querySelector<HTMLElement>('.hg-bar__top')!;
    expect(line).toBeTruthy();
    const controls = [
      ...line.querySelectorAll('.hg-bar__quick a'),
      ...line.querySelectorAll('.hg-bar__locale button'),
      ...line.querySelectorAll('.hg-bar__actions a, .hg-bar__actions button'),
    ];
    expect(controls).toHaveLength(6);
    controls.forEach((control) => expect(control.hasAttribute('hidden')).toBe(false));
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
