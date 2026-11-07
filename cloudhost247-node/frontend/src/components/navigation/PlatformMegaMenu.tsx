import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV_SECTIONS, TOOLS_CATEGORIES, type RegistryGroup, type RegistrySection } from '../../navigation/registry.generated';

/**
 * CloudHost247 top-menu navigation.
 *
 * All seven registry sections stay visible as direct links beside the logo — nothing is hidden
 * behind a hamburger or a `+` accordion. Each one now also has its own dropdown arrow: clicking
 * the arrow opens a panel under the top menu with that section's real sub-links from the shared
 * registry. The label itself remains a normal link to the section landing page, so a visitor can
 * either go straight there or open the directory.
 *
 * Interaction is click-only (not hover) so pointer, touch and keyboard behave identically and a
 * click never toggles a hover-opened panel shut. The panel is a single region controlled by the
 * seven carets via `aria-expanded` / `aria-controls`; Escape closes and restores focus; an
 * outside click or a route change closes it. Only one section is open at a time.
 *
 * `useNavigationSections` is kept for the platform hub, `Brand` for the header and footer.
 */

export function Brand({ className }: { className?: string }) {
  const onDark = Boolean(className?.includes('footer') || className?.includes('on-dark'));
  return (
    <NavLink to="/" className={className ? `ch247-brand ${className}` : 'ch247-brand'} aria-label="CloudHost247 — home">
      <img src={`/media/cloudhost247/brand/logo-horizontal-${onDark ? 'white' : 'dark'}.svg`} width={204} height={39} alt="CloudHost247" />
    </NavLink>
  );
}

/** Tools is the one section whose contents come from the live tool catalogue's category list. */
function sectionGroups(section: RegistrySection): RegistryGroup[] {
  if (!section.toolsDriven) return section.groups;
  return [
    {
      title: 'Free online tools',
      links: TOOLS_CATEGORIES.map((category) => ({
        label: category.label,
        to: `/tools/category/${category.slug}`,
        description: category.desc,
        icon: category.icon,
      })),
    },
    {
      title: 'Browse',
      links: [
        { label: 'All Tools', to: '/tools', description: 'Search the full catalogue by name or category.', icon: 'grid' },
        { label: 'Business Tools', to: '/tools/business-tools', description: 'Payroll, tax, contract and document tools.', icon: 'briefcase' },
      ],
    },
  ];
}

function Chevron() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
      <path d="M2 4.2 6 8.2 10 4.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlatformMenu() {
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const location = useLocation();

  const active = NAV_SECTIONS.find((section) => section.id === openId) ?? null;

  // Navigating closes the directory: a panel left hanging over the page the visitor asked for is
  // a bug, not a feature.
  useEffect(() => { setOpenId(null); }, [location.pathname]);

  useEffect(() => {
    if (!openId) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenId(null);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openId]);

  function toggle(section: RegistrySection, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setOpenId((current) => (current === section.id ? null : section.id));
  }

  const groups = active ? sectionGroups(active) : [];

  return (
    <div className="hg-menu__root" ref={rootRef}>
      <nav className="hg-menu" aria-label="Primary">
        <ul className="hg-menu__items">
          {NAV_SECTIONS.map((section) => {
            const open = openId === section.id;
            return (
              <li key={section.id} className={`hg-menu__item${open ? ' is-open' : ''}`}>
                <NavLink className="hg-menu__link" to={section.to}>{section.label}</NavLink>
                <button
                  type="button"
                  className="hg-menu__caret"
                  aria-label={`${section.label} sub-links`}
                  aria-controls="ch247-menu-panel"
                  aria-expanded={open}
                  onClick={(event) => toggle(section, event.currentTarget)}
                >
                  <Chevron />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div
        className="hg-menu__panel"
        id="ch247-menu-panel"
        role="region"
        aria-label={active ? `${active.label} sub-links` : 'Section sub-links'}
        hidden={!active}
      >
        {active ? (
          <div className="hg-menu__panel-inner">
            <div className="hg-menu__panel-head">
              <div>
                <p className="hg-menu__eyebrow">{active.label}</p>
                <p className="hg-menu__blurb">{active.blurb}</p>
              </div>
              <div className="hg-menu__panel-actions">
                <NavLink className="hg-menu__panel-all" to={active.to}>View all {active.label} →</NavLink>
                <button type="button" className="hg-menu__panel-close" onClick={() => { setOpenId(null); triggerRef.current?.focus(); }}>
                  Close ✕
                </button>
              </div>
            </div>

            <div className="hg-menu__groups">
              {groups.map((group) => (
                <section className="hg-menu__group" key={group.title} aria-label={group.title}>
                  <h3>{group.title}</h3>
                  <ul>
                    {group.links.map((link) => (
                      <li key={`${link.to}-${link.label}`}>
                        <NavLink className="hg-menu__sublink" to={link.to}>
                          <span>{link.label}</span>
                          {link.badge ? <span className="hg-menu__badge">{link.badge}</span> : null}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            {active.featured ? (
              <NavLink className="hg-menu__featured" to={active.featured.to}>
                <strong>{active.featured.title}</strong>
                <span>{active.featured.ctaLabel} →</span>
              </NavLink>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Used by pages that need the definition (sitemap page, hub navigation) without a network call. */
export function useNavigationSections() {
  return NAV_SECTIONS;
}
