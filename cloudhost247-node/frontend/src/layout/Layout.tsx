import { ToolsNavigationProvider } from '../components/tools/ToolsNavigation';
import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { MARKETING_ROUTES } from '../navigation/registry.generated';
import Header from './Header';
import Footer from './Footer';
import SupportModeBanner from '../components/SupportModeBanner';
import AiSupportWidget from '../components/AiSupportWidget';
import { CatalogLoadingBanner } from '../components/CatalogStateBanner';
import AnnouncementBar from '../components/AnnouncementBar';

/**
 * Shared application shell — a single Header/Footer wrapping every route (public marketing pages
 * and the authenticated app placeholders alike), so navigation chrome stays consistent as
 * features move from "Placeholder" to real implementations in later phases.
 *
 * `hg-theme` is on every route: it activates the Hostinger-style stylesheet (`hostinger.css`),
 * which restyles the *existing* header, mega menu, marquee, footer and shared primitives in
 * CloudHost247's own ink/mint palette. `hg-shell` marks public marketing routes and `hg-app`
 * marks the client area / admin / Tools Center, so the account surfaces get their own hPanel-style
 * layout without duplicating any chrome or changing any application logic.
 */

/** Route families that belong to the authenticated application, never the marketing surface. */
const APP_PREFIXES = [
  '/dashboard', '/account', '/admin', '/billing', '/invoices', '/services', '/cart',
  '/checkout', '/support', '/tools', '/login', '/register', '/forgot-password',
  '/reset-password', '/verify-email', '/marketing', '/servers',
  '/websites/builder', '/websites/ai-builder', '/websites/store', '/websites/experts',
];

/** Public surfaces that are not in MARKETING_ROUTES but still use the marketing chrome. */
const MARKETING_PREFIXES = [
  '/hosting', '/cloud', '/developers', '/platforms', '/websites', '/domains', '/apps',
  '/docs', '/legal', '/faq', '/contact', '/status', '/pricing', '/offers', '/about',
  '/blog', '/help', '/search', '/security', '/sitemap',
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isMarketingSurface(pathname: string): boolean {
  if (APP_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) return false;
  if (pathname === '/' || MARKETING_ROUTES.includes(pathname)) return true;
  return MARKETING_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export default function Layout() {
  const { pathname } = useLocation();
  const marketing = isMarketingSurface(pathname);

  // A 320 ms opacity-only transition between routes. Opacity (not transform) is deliberate: it
  // cannot shift layout or hurt CLS, and `metals.css` disables it under reduced motion. The
  // attribute is removed and re-added so the animation restarts on every navigation; no page
  // component is remounted and no route state is lost.
  useEffect(() => {
    const main = document.querySelector('.ch247-main');
    if (!main) return;
    main.removeAttribute('data-route-transition');
    void (main as HTMLElement).offsetWidth;
    main.setAttribute('data-route-transition', '');
  }, [pathname]);

  return (
    <ToolsNavigationProvider><div className={`ch247-shell hg-theme ${marketing ? 'hg-shell' : 'hg-app'}`}>
      <a className="ch247-skip" href="#main-content">
        Skip to main content
      </a>
      {/* Above the header, in DOM order and on screen: it is site-wide chrome, not page content.
          The skip link stays first so keyboard users still reach the page in one press. */}
      <AnnouncementBar />
      <SupportModeBanner />
      <Header />
      <main id="main-content" className="ch247-main">
        {/* Route-level code splitting: the boundary lives here, around the routed outlet, so a
            lazily-loaded page only replaces the page body — the header, footer and support
            widget stay painted instead of being swapped out for a full-screen fallback. */}
        <Suspense fallback={<CatalogLoadingBanner label="Loading page…" />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      <AiSupportWidget />
    </div></ToolsNavigationProvider>
  );
}
