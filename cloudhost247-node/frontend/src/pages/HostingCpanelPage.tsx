import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';

/**
 * Deliberately does not show plan tiers or prices: the real product catalog and pricing live in
 * WHMCS (queried dynamically from tblproducts/tblpricing in cpanel-hosting.php) and this Node app
 * has no live connection to that catalog yet. Inventing specific numbers here would present
 * fabricated pricing as real, which this project explicitly avoids. This page describes what's
 * included in general terms; a later phase will integrate the real, live catalog.
 */
const included = [
  { title: 'cPanel control panel', body: 'Manage files, databases, email, and domains from one familiar dashboard.' },
  { title: 'Free SSL', body: "Every hosting account includes a TLS certificate, kept renewed automatically." },
  { title: 'Daily backups', body: 'Automated daily backups so a bad deploy or accidental deletion is recoverable.' },
  { title: 'One-click apps', body: 'Install WordPress and other common applications without manual setup.' },
  { title: 'Email hosting included', body: 'Send and receive mail on your own domain without a separate email provider.' },
  { title: '24/7 support', body: "Reach support whenever something needs attention — see the Support page." },
];

export default function HostingCpanelPage() {
  usePageMeta('cPanel Hosting', "Everyday web hosting with the control panel administrators already know.");

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>cPanel Hosting</h1>
          <p>Everyday web hosting with the control panel administrators already know.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-grid">
          {included.map((item) => (
            <article className="ch247-card ch247-feature-card" key={item.title}>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ch247-section ch247-section--muted">
        <div className="ch247-page ch247-page--cta">
          <h2>See current plans and pricing</h2>
          <p>
            Plan tiers and current pricing are shown when you create an account or sign in — create
            an account to view them.
          </p>
          <NavLink className="ch247-button" to="/register">
            Create your account
          </NavLink>
        </div>
      </section>
    </div>
  );
}
