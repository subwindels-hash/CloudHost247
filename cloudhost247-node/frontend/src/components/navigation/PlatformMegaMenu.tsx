import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { publicFetch } from '../../lib/api';
import { NAV_SECTIONS, TOOLS_CATEGORIES } from '../../navigation/registry.generated';

/**
 * CloudHost247 navigation — GoDaddy-style dark menu / mega menu / mobile drawer.
 *
 * The menu renders `NAV_SECTIONS` — imported straight from the generated registry, not fetched
 * over the network on mount. That is deliberate: a navigation that arrives late is a navigation
 * that flashes empty on a cold load, and a failed request would leave the header with nothing in
 * it. The definition is the same for every visitor, so it belongs in the bundle.
 *
 * Hostinger's pattern, reproduced here:
 *   • a compact, sticky top bar of dropdown triggers with active underlines;
 *   • a full-width white mega panel: a tinted "explore" column with a featured card on the
 *     left, three columns of icon links with descriptions and badges on the right, and a
 *     bottom "see all" bar;
 *   • a phone drawer that turns the same registry into a one-level accordion.
 *
 * Interaction: pointer, click and keyboard open a panel; Escape closes and returns focus to the
 * trigger; outside click closes; navigating closes. `aria-expanded` / `aria-controls` are always
 * wired, and one panel is open at a time.
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
          <section key={category.slug} className="hg-mega__group" aria-label={category.label}>
            <h3>{category.label}</h3>
            <ul>
              {shown.map((tool) => (
                <li key={tool.slug}>
                  <Link className="hg-mega__link" to={tool.path}>
                    <span className="hg-mega__link-icon"><Icon name={category.icon} size={17} /></span>
                    <span>
                      <span className="hg-mega__link-label">{tool.name}</span>
                      <span className="hg-mega__link-desc">{category.desc}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section className="hg-mega__group" aria-label="All tools">
        <h3>Browse</h3>
        <ul>
          <li>
            <Link className="hg-mega__link" to="/tools">
              <span className="hg-mega__link-icon"><Icon name="grid" size={17} /></span>
              <span>
                <span className="hg-mega__link-label">All CloudHost247 Tools</span>
                <span className="hg-mega__link-desc">Search the full catalogue by name or category.</span>
              </span>
            </Link>
          </li>
          {failed ? (
            <li>
              <span className="hg-mega__link-desc" style={{ display: 'block', padding: '0 10px' }}>
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
  // `on-dark` lets the GoDaddy-style dark menu bar use the white mark without changing the
  // component's API; the footer's existing `--footer` class keeps working the same way.
  const onDark = Boolean(className?.includes('footer') || className?.includes('on-dark'));
  return (
    <Link to="/" className={className ? `ch247-brand ${className}` : 'ch247-brand'} aria-label="CloudHost247 — home">
      <img src={`/media/cloudhost247/brand/logo-horizontal-${onDark ? 'white' : 'dark'}.svg`} width={204} height={39} alt="CloudHost247" />
    </Link>
  );
}

function Badge({ kind }: { kind: string }) {
  return <span className={`hg-badge hg-badge--${kind.toLowerCase()}`}>{kind}</span>;
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
    <div ref={navRef} className="hg-nav">
      <nav className="hg-nav__list" aria-label="Primary">
        <ul className="hg-nav__items">
          {NAV_SECTIONS.map((section) => {
            const open = openId === section.id;
            const panelId = `ch247-nav-panel-${section.id}`;
            const expand = () => {
              if (window.matchMedia('(min-width: 1440px)').matches) setOpenId(section.id);
            };
            const collapse = () => {
              if (window.matchMedia('(min-width: 1440px)').matches) {
                setOpenId((current) => (current === section.id ? null : current));
              }
            };
            return (
              <li key={section.id} className="hg-nav__item" onMouseEnter={expand} onMouseLeave={collapse}>
                <button
                  type="button"
                  className={`hg-nav__trigger${open ? ' is-open' : ''}`}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenId(open ? null : section.id)}
                >
                  {section.label}
                  <span className="hg-nav__caret" aria-hidden>▾</span>
                </button>

                {/* The panel element always exists so `aria-controls` is never dangling, but its
                    contents are mounted only while it is open: rendering every menu's ~110 links
                    into the DOM of every page would cost parse time for content most visitors
                    never open. The same links are always available in the footer and the sitemap. */}
                <div id={panelId} className="hg-mega" hidden={!open}>
                  {open ? (
                    <div className="hg-mega__inner">
                      <aside className="hg-mega__intro">
                        <p className="hg-mega__eyebrow">Explore</p>
                        <h2>{section.label}</h2>
                        <p className="hg-mega__blurb">{section.blurb}</p>
                        {section.featured ? (
                          <Link className="hg-mega__featured" to={section.featured.to}>
                            <span className="hg-mega__featured-label">Featured</span>
                            <strong>{section.featured.title}</strong>
                            <span>{section.featured.body}</span>
                            <span className="hg-link">
                              {section.featured.ctaLabel}
                              <span className="hg-link__arrow" aria-hidden>→</span>
                            </span>
                          </Link>
                        ) : null}
                      </aside>

                      <div className="hg-mega__groups">
                        {section.toolsDriven ? (
                          /* Mounted only while the panel is open, so the catalogue request happens
                             when a visitor opens Tools — not on every page load. */
                          <ToolsGroups limit={6} active />
                        ) : (
                          section.groups.map((group) => (
                            <section key={group.title} className="hg-mega__group" aria-label={group.title}>
                              <h3>{group.title}</h3>
                              <ul>
                                {group.links.map((link) => (
                                  <li key={`${group.title}-${link.to}-${link.label}`}>
                                    <Link className="hg-mega__link" to={link.to}>
                                      <span className="hg-mega__link-icon"><Icon name={link.icon} size={17} /></span>
                                      <span>
                                        <span className="hg-mega__link-label">
                                          {link.label}
                                          {link.badge ? <Badge kind={link.badge} /> : null}
                                        </span>
                                        <span className="hg-mega__link-desc">{link.description}</span>
                                      </span>
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          ))
                        )}
                      </div>

                      <div className="hg-mega__foot">
                        <Link className="hg-link" to={section.to}>
                          All {section.label.toLowerCase()}
                          <span className="hg-link__arrow" aria-hidden>→</span>
                        </Link>
                        <span>Every link here opens a page this build serves.</span>
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
    <nav className="hg-drawer" aria-label="Mobile">
      {NAV_SECTIONS.map((section) => {
        const open = openId === section.id;
        const panelId = `${baseId}-${section.id}`;
        return (
          <div key={section.id} className="hg-drawer__group">
            <button
              type="button"
              className="hg-drawer__toggle"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpenId(open ? null : section.id)}
            >
              <span>{section.label}</span>
              <span aria-hidden>{open ? '−' : '+'}</span>
            </button>
            <div id={panelId} className="hg-drawer__panel" hidden={!open}>
              {open ? section.groups.map((group) => (
                <div key={group.title} className="hg-drawer__subgroup">
                  <h3>{group.title}</h3>
                  <ul>
                    {group.links.map((link) => (
                      <li key={`${group.title}-${link.to}-${link.label}`}>
                        <Link className="hg-drawer__link" to={link.to} onClick={onNavigate}>
                          <span className="hg-mega__link-icon"><Icon name={link.icon} size={17} /></span>
                          <span>
                            <span className="hg-mega__link-label">
                              {link.label}
                              {link.badge ? <Badge kind={link.badge} /> : null}
                            </span>
                            <span className="hg-mega__link-desc">{link.description}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )) : null}
              {open && section.toolsDriven ? <ToolsGroups limit={9} active /> : null}
              {open ? (
                <Link className="hg-link hg-drawer__all" to={section.to} onClick={onNavigate}>
                  All {section.label.toLowerCase()}
                  <span className="hg-link__arrow" aria-hidden>→</span>
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
