import { ToolsFooter } from '../components/tools/ToolsNavigation';
import { NavLink } from 'react-router-dom';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="ch247-footer">
      <div className="ch247-footer__inner">
        <div>
          <div className="ch247-brand ch247-brand--footer">CloudHost247</div>
          <p>Reliable cloud services, available around the clock.</p>
        </div>
        <ToolsFooter/>
        <nav aria-label="Footer">
          <NavLink to="/hosting">Hosting</NavLink>
          <NavLink to="/apps">App Marketplace</NavLink>
          <NavLink to="/domains">Domains</NavLink>
          <NavLink to="/tools">Tools</NavLink>
          <NavLink to="/about">About</NavLink>
          <NavLink to="/contact">Contact</NavLink>
          <NavLink to="/faq">FAQ</NavLink>
          <NavLink to="/support">Support</NavLink>
          <NavLink to="/legal">Legal</NavLink>
        </nav>
      </div>
      <div className="ch247-footer__legal">&copy; {year} CloudHost247. All rights reserved.</div>
    </footer>
  );
}
