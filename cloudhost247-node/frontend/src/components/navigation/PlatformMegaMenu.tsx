import { NavLink } from 'react-router-dom';
import { NAV_SECTIONS } from '../../navigation/registry.generated';

/**
 * CloudHost247 navigation — a flat, single-row menu with no dropdowns.
 *
 * Every top-level registry section is a real, always-visible link in the header bar. Nothing is
 * hidden behind a caret, a `+` accordion, a mega panel or a hamburger: the seven destinations are
 * all reachable with one click (or one keyboard press) from the bar beside the logo. The deeper
 * pages inside each section remain reachable from that section's landing page, the professional
 * footer and the sitemap, so the registry is still the single source of truth.
 *
 * `useNavigationSections` is kept for the platform hub, which renders the same registry sections.
 * `Brand` is kept for the header and footer, which both use the white-on-dark mark.
 */

export function Brand({ className }: { className?: string }) {
  // `on-dark` lets the dark menu bar use the white mark without changing the component's API;
  // the footer's existing `--footer` class keeps working the same way.
  const onDark = Boolean(className?.includes('footer') || className?.includes('on-dark'));
  return (
    <NavLink to="/" className={className ? `ch247-brand ${className}` : 'ch247-brand'} aria-label="CloudHost247 — home">
      <img src={`/media/cloudhost247/brand/logo-horizontal-${onDark ? 'white' : 'dark'}.svg`} width={204} height={39} alt="CloudHost247" />
    </NavLink>
  );
}

/**
 * The desktop/menu-area navigation. A plain list of links — no disclosure state, no
 * `aria-expanded`, no panel to mount, and therefore no keyboard trap or Escape handler needed.
 */
export function PlatformMenu() {
  return (
    <nav className="hg-menu" aria-label="Primary">
      <ul className="hg-menu__items">
        {NAV_SECTIONS.map((section) => (
          <li key={section.id} className="hg-menu__item">
            <NavLink className="hg-menu__link" to={section.to}>
              {section.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Used by pages that need the definition (sitemap page, hub navigation) without a network call. */
export function useNavigationSections() {
  return NAV_SECTIONS;
}
