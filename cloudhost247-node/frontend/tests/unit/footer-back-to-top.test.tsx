// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Footer from '../../src/layout/Footer';

/**
 * Amazon-style "Back to top": a full-width strip forming the final band of the footer
 * (last child of <footer>, below the bottom row, one centred click target), not a small
 * link buried inside the bottom row. The visual contract (slate band #37475A / hover
 * #485769, min-height 48px) lives in hostinger-chrome.css `.hg-footer__top`; this test
 * pins the structural/behavioural contract: placement, real `#ch247-top` destination,
 * smooth scroll on click with reduced-motion honoured, and focus moved to the top for
 * keyboard users.
 */
describe('Footer: Amazon-style back-to-top strip', () => {
  const scrollTo = vi.fn();

  beforeEach(() => {
    scrollTo.mockClear();
    Object.defineProperty(window, 'scrollTo', { writable: true, value: scrollTo });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  function renderFooter() {
    const header = document.createElement('header');
    header.id = 'ch247-top';
    header.tabIndex = -1;
    document.body.appendChild(header);
    return render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
  }

  it('renders as the last element of the footer, below the bottom row', () => {
    const { container } = renderFooter();
    const footer = container.querySelector('footer.ch247-footer');
    expect(footer).toBeTruthy();
    const strip = screen.getByRole('link', { name: 'Back to top' });
    expect(footer!.lastElementChild).toBe(strip);
    expect(strip.getAttribute('href')).toBe('#ch247-top');
    expect(strip.className).toContain('hg-footer__top');
    // It sits after — not inside — the bottom row (copyright / locale).
    const bottom = container.querySelector('.hg-footer__bottom');
    expect(bottom?.contains(strip)).toBe(false);
    expect(bottom?.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the powered-by line directly below the copyright line', () => {
    const { container } = renderFooter();
    const copyright = container.querySelector('.hg-footer__copyright');
    const powered = screen.getByText('Proudly Powered by WINDELS GROUP & COMPANY®');
    expect(copyright?.textContent).toContain('All rights reserved.');
    expect(powered.className).toContain('hg-footer__powered');
    expect(copyright?.parentElement).toBe(powered.parentElement);
    expect(copyright?.compareDocumentPosition(powered) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not render the removed legal-links row in the footer bottom', () => {
    const { container } = renderFooter();
    const footer = container.querySelector('footer.ch247-footer');
    expect(footer?.querySelector('.hg-footer__legal-links')).toBeNull();
    // The only bottom-row link is the GeoLite2 attribution, not a legal-links row.
    const bottom = container.querySelector('.hg-footer__bottom');
    const links = bottom?.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links?.[0]?.getAttribute('href')).toBe('https://www.maxmind.com');
  });

  it('smooth-scrolls to the very top and moves focus to the header on click', () => {
    renderFooter();
    fireEvent.click(screen.getByRole('link', { name: 'Back to top' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(document.activeElement?.id).toBe('ch247-top');
  });

  it('uses instant scrolling when the user prefers reduced motion', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;
    try {
      renderFooter();
      fireEvent.click(screen.getByRole('link', { name: 'Back to top' }));
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    } finally {
      window.matchMedia = original;
    }
  });
});
