import { ToolsNavigationProvider } from '../components/tools/ToolsNavigation';
import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';
import SupportModeBanner from '../components/SupportModeBanner';
import AiSupportWidget from '../components/AiSupportWidget';
import { CatalogLoadingBanner } from '../components/CatalogStateBanner';

/**
 * Shared application shell — a single Header/Footer wrapping every route (public marketing pages
 * and the authenticated app placeholders alike), so navigation chrome stays consistent as
 * features move from "Placeholder" to real implementations in later phases.
 */
export default function Layout() {
  return (
    <ToolsNavigationProvider><div className="ch247-shell">
      <a className="ch247-skip" href="#main-content">
        Skip to main content
      </a>
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
