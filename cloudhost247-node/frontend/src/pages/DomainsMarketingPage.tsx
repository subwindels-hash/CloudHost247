import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';

/**
 * Public "Domains" marketing/info page — distinct from the authenticated /account/domains page,
 * which manages domains already on a signed-in customer's account.
 *
 * Domain registration/management is a real, currently-offered CloudHost247 service (see
 * faqs.php's "What services do you offer?" answer, reused on /faq), but the actual domain search,
 * TLD/pricing list, and registration flow are powered by WHMCS (modules/addons/
 * cloudhost247_domain_lookup, domain.php, tblpricing) and this Node app has no live connection to
 * that yet. Rather than fabricate a working-looking search box, a TLD price list, or availability
 * results, this page states that plainly and points to the real account creation flow and the
 * real, currently-published domain policy documents (see docs/policies/) by name.
 */
export default function DomainsMarketingPage() {
  usePageMeta('Domains', 'Domain registration and management at CloudHost247.');

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Domains</h1>
          <p>Register and manage domain names alongside your hosting.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          <p>
            Domain registration and management is one of our services, alongside hosting, email,
            SSL, and backups.
          </p>
          <p className="ch247-placeholder-notice">
            Domain search, availability checks, and online registration aren't available on this
            platform yet — this app doesn't have a live connection to the domain registry/pricing
            system yet, so we're not showing a search box or prices that wouldn't actually work.
            Existing customers can manage their domains from the current client area; new
            customers can create an account below and we'll follow up about domain options.
          </p>
          <p>
            Domain registrations are governed by our Domain Registration Agreement and Domain Name
            Auto-Renewal and Deletion Policy — see the <NavLink to="/legal">Legal &amp; Policy Center</NavLink>.
          </p>
          <NavLink className="ch247-button" to="/register">
            Create your account
          </NavLink>
        </div>
      </section>
    </div>
  );
}
