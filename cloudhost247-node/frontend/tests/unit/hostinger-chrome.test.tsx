// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    // Section arrows, mobile menu, and language/currency settings disclosures.
    expect(container.querySelectorAll('[aria-expanded]')).toHaveLength(NAV_SECTIONS.length + 3);
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
    expect(within(primary).queryByRole('link', { name: 'Create Account' })).toBeNull();
    expect(within(primary).getByRole('link', { name: 'Pricing' })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Help' })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Cart' })).toBeTruthy();

    // One straight line, left-to-right: quick links, then search/cart, then the account controls.
    // Asserting DOM order rather than sibling adjacency keeps the contract meaningful: the groups
    // may gain a wrapper (they did, when the quick links were introduced) without the line itself
    // changing, and the five controls in check-chrome-benchmark.mjs are what actually matter.
    const line = container.querySelector<HTMLElement>('.hg-bar__top')!;
    expect(line).toBeTruthy();
    const order = ['.hg-bar__quick', '.hg-bar__icons', '.hg-bar__actions'].map((selector) => {
      const element = line.querySelector<HTMLElement>(selector);
      expect(element, `${selector} must be part of the utility line`).toBeTruthy();
      return element!;
    });
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.querySelector('.hg-bar__locale')).toBeTruthy();
    expect(within(line.querySelector<HTMLElement>('.hg-bar__icons')!).getByRole('link', { name: /search/i })).toBeTruthy();
    expect(within(line.querySelector<HTMLElement>('.hg-bar__icons')!).getByRole('link', { name: 'Cart' })).toBeTruthy();
    const controls = [
      ...line.querySelectorAll('.hg-bar__quick a'),
      ...line.querySelectorAll('.hg-bar__locale button'),
      ...line.querySelectorAll('.hg-bar__actions a, .hg-bar__actions button'),
    ];
    // The documented set, by name — a count alone would still pass if the wrong five were shown.
    // Text as rendered; the locale disclosures have accessible names (`Language: English`) that the
    // roles above already pin, so this is the visible reading order. Create Account is deliberately
    // absent: the header carries no sign-up button any more.
    expect(controls.map((control) => control.textContent?.trim() || control.getAttribute('aria-label'))).toEqual([
      'Pricing',
      'Help',
      'English▾',
      'USD▾',
      'Sign In',
    ]);
    controls.forEach((control) => expect(control.hasAttribute('hidden')).toBe(false));
  });
});

describe('Responsive footer directory', () => {
  it('renders six categories with all registry destinations', () => {
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    const footer = container.querySelector<HTMLElement>('footer.hg-footer')!;
    const columns = footer.querySelectorAll('.hg-footer__column');
    expect([...columns].map((column) => column.querySelector('h2')?.textContent)).toEqual([
      'Hosting', 'Domain', 'Tools', 'Information', 'Company', 'Support',
    ]);
    const registryPaths = new Set(FOOTER_COLUMNS.flatMap((column) => column.links.map((link) => link.to)));
    const rendered = [...footer.querySelectorAll('.hg-footer__column a')].map((a) => a.getAttribute('href'));
    expect([...registryPaths].filter((path) => !rendered.includes(path))).toEqual([]);
    expect(footer.querySelector('.hg-footer__bottom')).toBeTruthy();
  });

  it('limits long lists to ten links until View all is selected', () => {
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    const hosting = container.querySelector<HTMLElement>('.hg-footer__column')!;
    const links = hosting.querySelectorAll('li > a');
    expect(links.length).toBeGreaterThan(10);
    expect([...links].filter((link) => !link.parentElement?.hidden)).toHaveLength(10);
    const toggle = within(hosting).getByRole('button', { name: 'View all Hosting links' });
    fireEvent.click(toggle);
    expect([...links].filter((link) => !link.parentElement?.hidden)).toHaveLength(links.length);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect([...links].filter((link) => !link.parentElement?.hidden)).toHaveLength(10);
  });

  it('toggles each mobile section independently', () => {
    render(<MemoryRouter><Footer /></MemoryRouter>);
    const hosting = screen.getByRole('button', { name: 'Hosting' });
    const domain = screen.getByRole('button', { name: 'Domain' });
    expect(hosting.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(hosting);
    expect(hosting.getAttribute('aria-expanded')).toBe('true');
    expect(domain.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(hosting);
    expect(hosting.getAttribute('aria-expanded')).toBe('false');
  });
});
