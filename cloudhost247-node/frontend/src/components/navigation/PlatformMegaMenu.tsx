import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { fetchNavigation, type NavSection } from '../../lib/platform-api';

/**
 * CLOUDHOST247 mega navigation.
 *
 * The menu is rendered from `GET /api/v1/navigation` — the same definition the sitemap and the
 * footer use — so the desktop mega panels, the keyboard-operable drawer and every deep link can
 * never disagree with each other, and a route can never be linked that the app does not serve.
 *
 * Behaviour: hover opens a panel on wide screens, click/focus works everywhere, Escape closes and
 * restores focus to the trigger, clicking outside closes, and the mobile drawer is an accordion
 * with 44px+ touch targets and vertical scrolling (no horizontal overflow).
 */

/* --------------------------------------------------------------------------------------------
 * Icons
 * A small, dependency-free stroke icon set, chosen from the link's own destination. Icons are
 * decorative (`aria-hidden`) — the label and the description carry the meaning — and every path is
 * inline SVG, so the menu never waits on an icon font or an image request to become usable.
 * ------------------------------------------------------------------------------------------ */

type IconName =
  | 'search' | 'list' | 'transfer' | 'globe' | 'gavel' | 'chart' | 'handshake' | 'star' | 'shield'
  | 'folder' | 'layout' | 'sparkle' | 'grid' | 'cart' | 'user' | 'trend' | 'pen' | 'chat'
  | 'server' | 'wrench';

const ICON_PATHS: Record<IconName, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 5 5',
  list: 'M4 6h16M4 12h16M4 18h16',
  transfer: 'M4 8h13l-3-3m3 3-3 3M20 16H7l3-3m-3 3 3 3',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c3 3 3 15 0 18M3 12h18',
  gavel: 'M4 20h9M6 16l6-6m-3-3 6 6m-8 2 4-4m6 0 4-4',
  chart: 'M4 20V6m5 14V10m5 10V4m5 16v-7',
  handshake: 'M8 12l3-3 3 3 3-3 4 4-6 6-3-3-3 3-4-4 3-3Zm-3-1 3-3 3 3',
  star: 'M12 3l3 6 6 .9-4.5 4.3 1.1 6.3L12 17.6 6.4 20.5l1.1-6.3L3 9.9 9 9l3-6Z',
  shield: 'M12 3l7 3v6c0 5-3 7-7 9-4-2-7-4-7-9V6l7-3Zm-3 9 2 2 4-4',
  folder: 'M4 7h5l2 2h9v9H4V7Z',
  layout: 'M4 5h16v14H4zM4 10h16M10 10v9',
  sparkle: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Zm7 11 .8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  cart: 'M4 5h2l2 10h11M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM8 9h11l-1.5 6',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-7 16c1.5-3.5 4-5 7-5s5.5 1.5 7 5',
  trend: 'M4 17l5-5 4 3 7-8M20 7h-4m4 0v4',
  pen: 'M4 20l4-1 10-10-3-3L5 16l-1 4Zm11-14 3 3',
  chat: 'M5 5h14v10H9l-4 4V5Z',
  server: 'M5 5h14v5H5zM5 14h14v5H5zM8 7.5h.01M8 16.5h.01',
  wrench: 'M15 4a5 5 0 0 0-4.6 7L4 17l3 3 6-6.4A5 5 0 0 0 20 9l-3 1-2-2 1-3c-.6-.6-1.3-1-2-1Zm-8 13 .01.01',
};

/** Picks the icon that matches the destination. Longest prefix wins, so /domains/bulk-search beats /domains. */
function iconFor(to: string): IconName {
  const rules: Array<[string, IconName]> = [
    ['/domains/bulk-search', 'list'],
    ['/domains/search', 'search'],
    ['/domains/transfer', 'transfer'],
    ['/domains/extensions', 'globe'],
    ['/domains/auctions', 'gavel'],
    ['/domains/appraisal', 'chart'],
    ['/domains/broker', 'handshake'],
    ['/domains/club', 'star'],
    ['/domains/whois', 'shield'],
    ['/dashboard/domains', 'folder'],
    ['/websites/ai-builder', 'sparkle'],
    ['/websites/builder', 'layout'],
    ['/websites/templates', 'grid'],
    ['/websites/store', 'cart'],
    ['/websites/experts', 'user'],
    ['/websites/design-services', 'user'],
    ['/marketing/logo-maker', 'pen'],
    ['/marketing/inbox', 'chat'],
    ['/marketing/seo', 'trend'],
    ['/marketing/digital', 'trend'],
    ['/marketing/analytics', 'chart'],
    ['/hosting', 'server'],
    ['/dashboard/dns', 'server'],
  ];
  const match = rules.filter(([prefix]) => to.startsWith(prefix)).sort((a, b) => b[0].length - a[0].length)[0];
  return match ? match[1] : 'wrench';
}

export function NavIcon({ to }: { to: string }) {
  return (
    <svg className="ch247-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[iconFor(to)]} />
    </svg>
  );
}

function Badge({ kind }: { kind: NonNullable<NavSection['groups'][number]['links'][number]['badge']> }) {
  return <span className={`ch247-nav-badge ch247-nav-badge--${kind.toLowerCase()}`}>{kind}</span>;
}

export function PlatformMegaMenu({ onNavigate }: { onNavigate?: () => void }) {
  const [sections, setSections] = useState<NavSection[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const location = useLocation();

  useEffect(() => {
    let active = true;
    fetchNavigation()
      .then((data) => {
        if (active) setSections(data.sections);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Navigating always closes the menu: a panel left open over the page is a bug, not a feature.
  useEffect(() => {
    setOpenId(null);
  }, [location.pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenId(null);
        const trigger = navRef.current?.querySelector<HTMLElement>('button[aria-expanded="true"]');
        trigger?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setOpenId(null);
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  if (failed) {
    // Never render an empty menu bar: if the definition cannot be loaded the shell says so and
    // offers the plain links that always work.
    return (
      <nav className="ch247-nav-links" aria-label="Primary" ref={navRef as never}>
        <Link to="/domains/search" onClick={onNavigate}>
          Domains
        </Link>
        <Link to="/websites/builder" onClick={onNavigate}>
          Websites
        </Link>
        <Link to="/marketing/digital" onClick={onNavigate}>
          Marketing
        </Link>
        <Link to="/tools" onClick={onNavigate}>
          Tools
        </Link>
      </nav>
    );
  }

  if (!sections) {
    return (
      <div className="ch247-nav-loading" aria-hidden="true">
        Loading menu…
      </div>
    );
  }

  return (
    <nav className="ch247-platform-nav" aria-label="Primary" ref={navRef}>
      <ul className="ch247-platform-nav__bar">
        {sections.map((section) => {
          const open = openId === section.id;
          const panelId = `ch247-nav-panel-${section.id}`;
          return (
            <li
              key={section.id}
              className="ch247-platform-nav__item"
              onMouseEnter={() => {
                if (window.matchMedia('(min-width: 1024px)').matches) setOpenId(section.id);
              }}
              onMouseLeave={() => {
                if (window.matchMedia('(min-width: 1024px)').matches) setOpenId((current) => (current === section.id ? null : current));
              }}
            >
              <button
                type="button"
                className={`ch247-platform-nav__trigger${open ? ' is-open' : ''}`}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? null : section.id)}
              >
                {section.label}
                <span aria-hidden="true">⌄</span>
              </button>

              <div id={panelId} className={`ch247-mega-panel${open ? ' is-open' : ''}`} hidden={!open}>
                <div className="ch247-mega-intro">
                  <h2>{section.label}</h2>
                  <p>{section.blurb}</p>
                  {section.featured ? (
                    <>
                      <h3>{section.featured.title}</h3>
                      <p>{section.featured.body}</p>
                      <Link to={section.featured.to} onClick={onNavigate} className="ch247-button ch247-button--small">
                        {section.featured.ctaLabel}
                      </Link>
                    </>
                  ) : null}
                </div>
                <div className="ch247-mega-groups">
                  {section.groups.map((group) => (
                    <section key={group.title} aria-label={group.title}>
                      <h3>{group.title}</h3>
                      <ul>
                        {group.links.map((link) => (
                          <li key={`${group.title}-${link.to}-${link.label}`}>
                            <Link to={link.to} onClick={onNavigate} className="ch247-mega-link">
                              <NavIcon to={link.to} />
                              <span className="ch247-mega-link__body">
                                <span className="ch247-mega-link__label">
                                  {link.label}
                                  {link.badge ? <Badge kind={link.badge} /> : null}
                                </span>
                                <span className="ch247-mega-link__desc">{link.description}</span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mobile drawer: the same navigation data as an accordion with large touch targets. */
export function PlatformMobileNav({ onNavigate }: { onNavigate?: () => void }) {
  const [sections, setSections] = useState<NavSection[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchNavigation()
      .then((data) => {
        if (active) setSections(data.sections);
      })
      .catch(() => {
        if (active) setSections([]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!sections) return null;

  return (
    <div className="ch247-mobile-nav">
      {sections.map((section) => {
        const open = openId === section.id;
        return (
          <div key={section.id} className="ch247-mobile-nav__group">
            <button
              type="button"
              className="ch247-mobile-nav__toggle"
              aria-expanded={open}
              aria-controls={`ch247-mobile-panel-${section.id}`}
              onClick={() => setOpenId(open ? null : section.id)}
            >
              <span>{section.label}</span>
              <span aria-hidden="true">{open ? '−' : '+'}</span>
            </button>
            {open ? (
              <div id={`ch247-mobile-panel-${section.id}`} className="ch247-mobile-nav__panel">
                {section.groups.map((group) => (
                  <div key={group.title} className="ch247-mobile-nav__subgroup">
                    <h3>{group.title}</h3>
                    <ul>
                      {group.links.map((link) => (
                        <li key={`${group.title}-${link.to}-${link.label}`}>
                          <Link to={link.to} onClick={onNavigate} className="ch247-mobile-nav__link">
                            <NavIcon to={link.to} />
                            <span className="ch247-mega-link__body">
                              <span className="ch247-mega-link__label">
                                {link.label}
                                {link.badge ? <Badge kind={link.badge} /> : null}
                              </span>
                              <span className="ch247-mega-link__desc">{link.description}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Small helper used by pages that need the navigation definition (e.g. the sitemap page). */
export function useNavigation(): { sections: NavSection[] | null; error: string | null } {
  const [sections, setSections] = useState<NavSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchNavigation()
      .then((data) => {
        if (active) setSections(data.sections);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return { sections, error };
}

/** Section pills used at the top of a hub page to move between the services in one area. */
export function NavSectionLinks({ ids, current, render }: { ids: string[]; current: string; render?: (section: NavSection) => ReactNode }) {
  const { sections } = useNavigation();
  if (!sections) return null;
  return (
    <>
      {sections
        .filter((section) => ids.includes(section.id))
        .map((section) => (render ? render(section) : null))}
      <span className="ch247-visually-hidden">{current}</span>
    </>
  );
}
