import { Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';

/**
 * Shared application shell — a single Header/Footer wrapping every route (public marketing pages
 * and the authenticated app placeholders alike), so navigation chrome stays consistent as
 * features move from "Placeholder" to real implementations in later phases.
 */
export default function Layout() {
  return (
    <div className="ch247-shell">
      <a className="ch247-skip" href="#main-content">
        Skip to main content
      </a>
      <Header />
      <main id="main-content" className="ch247-main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
