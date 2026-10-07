import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { publicFetch } from '../../lib/api';
import { NAV_SECTIONS, TOOLS_CATEGORIES } from '../../navigation/registry.generated';

/**
 * CloudHost247 mega navigation.
 *
 * The menu renders `NAV_SECTIONS` — imported straight from the generated registry, not fetched
 * over the network on mount. That is deliberate: a navigation that arrives late is a navigation
 * that flashes empty on a cold load, and a failed request would leave the header with nothing in
 * it. The definition is the same for every visitor, so it belongs in the bundle.
 *
 * `/api/v1/navigation` still serves the identical definition for `/sitemap.xml`, the SEO routes
 * and automated link checks. Both come from `shared/site/registry.json`, so they cannot disagree.
 *
 * Interaction:
 *  - desktop: pointer, click and keyboard all open a panel; it spans the viewport so it cannot
 *    overflow the window whichever item is open;
 *  - Escape closes and returns focus to the trigger; outside click closes; navigating closes;
 *  - the panel is capped at `calc(100dvh - header)` and scrolls internally, so a long menu on a
 *    short screen cannot push content out of reach;
 *  - `aria-expanded` / `aria-controls` are always wired, and one panel is open at a time.
 */

interface CatalogueTool {
  slug: string;
  name: string;
  path: string;
  discoveryCategories?: string[];
}

/**
 * Tools are the one menu whose *contents* are live data: an operator can add a tool to the
 * catalogue without a redeploy. So the panel shows registry categories immediately, then fills
 * each category with real tools from `/api/tools/navigation`. If that request fails the panel
 * degrades into a working directory of tool categories rather than an empty box.
 */
function useCatalogueTools(enabled: boolean) {
  const [tools, setTools] = useState<CatalogueTool[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Only fetch once somebody actually opens the Tools panel. Loading the catalogue on every
    // page view would cost a request for the majority of visitors who never open this menu.
    if (!enabled) return undefined;
    let active = true;
    publicFetch<{ tools: CatalogueTool[] }>('/api/tools/navigation')
      .then((result) => {
        if (active && Array.isArray(result.tools)) setTools(result.tools);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [enabled]);
  return { tools, failed };
}

function ToolsGroups({ limit, active = true }: { limit: number; active?: boolean }) {
  const { tools, failed } = useCatalogueTools(active);
  return (
    <>
      {TOOLS_CATEGORIES.slice(0, limit).map((category) => {
        const entries = tools.filter((tool) => tool.discoveryCategories?.includes(category.slug)).slice(0, 4);
        const shown = entries.length > 0
          ? entries
          : [{ slug: `${category.slug}-index`, name: `${category.label} tools`, path: `/tools/category/${category.slug}` }];
        return (
          <section key={category.slug} className="ch247-mega-group" aria-label={category.label}>
            <h3>{category.label}</h3>
            <ul>
              {shown.map((tool) => (
                <li key={tool.slug}>
                  <Link className="ch247-mega-link" to={tool.path}>
                    <span className="ch247-mega-link__icon">
                      <Icon name={category.icon} size={17} />
                    </span>
                    <span>
                      <span className="ch247-mega-link__label">{tool.name}</span>
                      <span className="ch247-mega-link__desc">{category.desc}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section className="ch247-mega-group" aria-label="All tools">
        <h3>Browse</h3>
        <ul>
          <li>
            <Link className="ch247-mega-link" to="/tools">
              <span className="ch247-mega-link__icon"><Icon name="grid" size={17} /></span>
              <span>
                <span className="ch247-mega-link__label">All CloudHost247 Tools</span>
                <span className="ch247-mega-link__desc">Search the full catalogue by name or category.</span>
              </span>
            </Link>
          </li>
          {failed ? (
            <li>
              <span className="ch247-mega-link__desc" style={{ display: 'block', padding: '0 10px' }}>
                The live tool catalogue could not be loaded, so only categories are listed.
              </span>
            </li>
          ) : null}
        </ul>
      </section>
    </>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link to="/" className={className ? `ch247-brand ${className}` : 'ch247-brand'} aria-label="CloudHost247 — home">
      <span className="ch247-brand__mark">
        <svg viewBox="0 0 24 24" aria-hidden focusable="false">
          <path d="M12 2.5 21 7.5v9L12 21.5 3 16.5v-9L12 2.5Z" fill="none" stroke="#7ff0b4" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M3 7.5 12 13l9-5.5M12 13v8.5" fill="none" stroke="#7ff0b4" strokeWidth="1" opacity="0.7" />
          <circle cx="12" cy="13" r="1.7" fill="#7ff0b4" />
        </svg>
      </span>
      <span>
        CloudHost<span className="ch247-brand__suffix">247</span>
      </span>
    </Link>
  );
}

function Badge({ kind }: { kind: string }) {
  return <span className={`ch247-nav-badge ch247-nav-badge--${kind.toLowerCase()}`}>{kind}</span>;
}

export function PlatformMegaMenu() {
  const [openId, setOpenId] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Navigating always closes the menu: a panel left open over the page a visitor just asked for is
  // a bug, not a feature.
  useEffect(() => {
    setOpenId(null);
  }, [location.pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || openId === null) return;
      setOpenId(null);
      navRef.current?.querySelector<HTMLElement>('button[aria-expanded="true"]')?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (navRef.current && !event.target) return;
      if (navRef.current && !navRef.current.contains(event.target as Node)) setOpenId(null);
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [openId]);

  return (
    <div ref={navRef} className="ch247-header__nav-slot">
      <nav className="ch247-platform-nav" aria-label="Primary">
        <ul className="ch247-platform-nav__bar">
          {NAV_SECTIONS.map((section) => {
            const open = openId === section.id;
            const panelId = `ch247-nav-panel-${section.id}`;
            const expand = () => {
              if (window.matchMedia('(min-width: 1181px)').matches) setOpenId(section.id);
            };
            const collapse = () => {
              if (window.matchMedia('(min-width: 1181px)').matches) {
                setOpenId((current) => (current === section.id ? null : current));
              }
            };
            return (
              <li key={section.id} className="ch247-platform-nav__item" onMouseEnter={expand} onMouseLeave={collapse}>
                <button
                  type="button"
                  className={`ch247-platform-nav__trigger${open ? ' is-open' : ''}`}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenId(open ? null : section.id)}
                >
                  {section.label}
                  <span className="ch247-caret" aria-hidden>▾</span>
                </button>

                {/* The panel element always exists so `aria-controls` is never dangling, but its
                    contents are mounted only while it is open: rendering every menu's ~110 links
                    into the DOM of every page would cost parse time for content most visitors
                    never open. The same links are always available in the footer and the sitemap. */}
                <div id={panelId} className="ch247-mega-panel" hidden={!open}>
                  {open ? (
                  <div className="ch247-mega-panel__inner">
                    <div className="ch247-mega-intro">
                      <h2>{section.label}</h2>
                      <p>{section.blurb}</p>
                      {section.featured ? (
                        <div className="ch247-mega-featured">
                          <h3>{section.featured.title}</h3>
                          <p>{section.featured.body}</p>
                          <Link className="ch-link" to={section.featured.to}>
                            {section.featured.ctaLabel}
                            <span className="ch-link__arrow" aria-hidden>→</span>
                          </Link>
                        </div>
                      ) : null}
                      <p style={{ marginTop: '18px', marginBottom: 0 }}>
                        <Link className="ch-link" to={section.to}>
                          All {section.label.toLowerCase()}
                          <span className="ch-link__arrow" aria-hidden>→</span>
                        </Link>
                      </p>
                    </div>

                    <div className="ch247-mega-groups">
                      {section.toolsDriven ? (
                        /* Mounted only while the panel is open, so the catalogue request happens
                           when a visitor opens Tools — not on every page load. */
                        open ? <ToolsGroups limit={6} active /> : null
                      ) : (
                        section.groups.map((group) => (
                          <section key={group.title} className="ch247-mega-group" aria-label={group.title}>
                            <h3>{group.title}</h3>
                            <ul>
                              {group.links.map((link) => (
                                <li key={`${group.title}-${link.to}-${link.label}`}>
                                  <Link className="ch247-mega-link" to={link.to}>
                                    <span className="ch247-mega-link__icon">
                                      <Icon name={link.icon} size={17} />
                                    </span>
                                    <span>
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
                        ))
                      )}
                    </div>
                  </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/**
 * Mobile drawer: the same registry, rendered as an accordion built for thumbs rather than a
 * collapsed desktop menu.
 *
 *  - 52 px minimum row height on every tappable element (well past the 44 px floor);
 *  - one level of nesting, so the hierarchy stays legible on a phone;
 *  - the drawer is capped to the viewport and scrolls vertically — no horizontal scrolling is
 *    possible at any width;
 *  - each open section ends with a visible "All …" link, so a visitor is never trapped in a long
 *    sub-list looking for the overview page.
 */
export function PlatformMobileNav({ onNavigate }: { onNavigate?: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const baseId = useId();

  return (
    <nav className="ch247-mobile-nav" aria-label="Mobile">
      {NAV_SECTIONS.map((section) => {
        const open = openId === section.id;
        const panelId = `${baseId}-${section.id}`;
        return (
          <div key={section.id} className="ch247-mobile-nav__group">
            <button
              type="button"
              className="ch247-mobile-nav__toggle"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpenId(open ? null : section.id)}
            >
              <span>{section.label}</span>
              <span aria-hidden>{open ? '−' : '+'}</span>
            </button>
            <div id={panelId} className="ch247-mobile-nav__panel" hidden={!open}>
              {open ? section.groups.map((group) => (
                <div key={group.title} className="ch247-mobile-nav__subgroup">
                  <h3>{group.title}</h3>
                  <ul>
                    {group.links.map((link) => (
                      <li key={`${group.title}-${link.to}-${link.label}`}>
                        <Link className="ch247-mobile-nav__link" to={link.to} onClick={onNavigate}>
                          <span className="ch247-mega-link__icon">
                            <Icon name={link.icon} size={17} />
                          </span>
                          <span>
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
              )) : null}
              {open && section.toolsDriven ? <ToolsGroups limit={9} active /> : null}
              {open ? (
                <Link className="ch-link ch247-mobile-nav__all" to={section.to} onClick={onNavigate}>
                  All {section.label.toLowerCase()}
                  <span className="ch-link__arrow" aria-hidden>→</span>
                </Link>
              ) : null}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** Used by pages that need the definition (sitemap page, hub navigation) without a network call. */
export function useNavigationSections() {
  return NAV_SECTIONS;
}
