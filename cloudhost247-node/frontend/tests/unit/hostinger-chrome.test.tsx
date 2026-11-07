// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '../../src/layout/Header';
import Footer from '../../src/layout/Footer';
import { PlatformMobileNav } from '../../src/components/navigation/PlatformMegaMenu';
import { FOOTER_COLUMNS, NAV_SECTIONS } from '../../src/navigation/registry.generated';

/**
 * The shared chrome was rebuilt in the Hostinger shape. These tests pin the parts that are easy
 * to lose in a refactor: the compact trigger bar, the full-width mega panel (intro card + three
 * link columns + "see all" bar), the mobile accordion, and the professional four-column dark footer. All
 * content is asserted against the generated registry, so a menu that drifts from the sitemap
 * fails here rather than in production.
 */

beforeEach(() => {
  localStorage.clear();
  // jsdom has no matchMedia; the menu consults it to decide whether pointer-hover applies.
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

describe('Hostinger-style menu and mega menu', () => {
  it('renders one accessible dropdown trigger per registry section in a compact nav bar', () => {
    const { container } = render(<MemoryRouter><Header /></MemoryRouter>);

    expect(container.querySelector('.hg-header .hg-nav__bar')).toBeTruthy();
    const triggers = container.querySelectorAll('.hg-nav__trigger');
    expect(triggers).toHaveLength(NAV_SECTIONS.length);
    triggers.forEach((trigger) => {
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(trigger.getAttribute('aria-controls')).toBeTruthy();
    });

    // Utility controls stay inside #ch247-primary-nav (also pinned by Header.test.tsx).
    const primary = container.querySelector<HTMLElement>('#ch247-primary-nav')!;
    expect(within(primary).getByRole('button', { name: 'Language: English' })).toBeTruthy();
    expect(within(primary).getByRole('button', { name: /^Display currency: USD/ })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Sign In' })).toBeTruthy();
    expect(within(primary).getByRole('link', { name: 'Create Account' })).toBeTruthy();
  });

  it('opens a full-width mega panel with an intro card, icon link columns and a see-all bar', async () => {
    const { container } = render(<MemoryRouter><Header /></MemoryRouter>);
    // The mobile drawer also has a "Hosting" button, so scope this to the desktop trigger list.
    const trigger = within(container.querySelector<HTMLElement>('.hg-nav__list')!)
      .getByRole('button', { name: /^Hosting/ });

    await userEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const panel = container.querySelector<HTMLElement>(`#${trigger.getAttribute('aria-controls')}`)!;
    expect(panel.classList.contains('hg-mega')).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('.hg-mega__intro h2')?.textContent).toBe('Hosting');
    expect(panel.querySelector('.hg-mega__featured')).toBeTruthy();
    expect(panel.querySelectorAll('.hg-mega__groups .hg-mega__group')).toHaveLength(
      NAV_SECTIONS.find((section) => section.id === 'hosting')!.groups.length
    );
    expect(panel.querySelector('.hg-mega__link-icon')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: /All hosting/i })).toBeTruthy();

    // Registry links are real, not placeholders: the featured card points to a registry route.
    const featured = NAV_SECTIONS.find((section) => section.id === 'hosting')!.featured!;
    expect(panel.querySelector('.hg-mega__featured')?.getAttribute('href')).toBe(featured.to);

    // Escape closes and returns focus to the trigger, as a keyboard user expects.
    await userEvent.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('turns the same registry into a tappable accordion in the mobile drawer', async () => {
    const onNavigate = vi.fn();
    const { container } = render(<MemoryRouter><PlatformMobileNav onNavigate={onNavigate} /></MemoryRouter>);

    const toggles = container.querySelectorAll('.hg-drawer__toggle');
    expect(toggles).toHaveLength(NAV_SECTIONS.length);
    expect(toggles[0].getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(screen.getByRole('button', { name: /Hosting/ }));
    expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
    const all = screen.getByRole('link', { name: /All hosting/i });
    expect(all).toBeTruthy();
    await userEvent.click(all);
    expect(onNavigate).toHaveBeenCalled();
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
    // The rearrangement keeps all eight registry columns, each under a readable sub-heading.
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
    // Balanced columns: no column is more than twice the size of the smallest one.
    const counts = [...columns].map((column) => column.querySelectorAll('a').length);
    expect(Math.max(...counts)).toBeLessThanOrEqual(Math.min(...counts) * 2);

    // Switchers live in the header only (also pinned by Header.test.tsx).
    expect(within(footer).queryByRole('button', { name: /Language:/i })).toBeNull();
    expect(within(footer).queryByRole('button', { name: /Display currency:/i })).toBeNull();
  });
});
