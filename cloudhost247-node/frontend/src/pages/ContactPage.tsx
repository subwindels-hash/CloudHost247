import { usePageMeta } from '../lib/usePageMeta';

/**
 * The department email addresses below are real and already published/in active use across many
 * of the existing, currently-live CloudHost247 legal/policy pages (e.g. refund-policy.php uses
 * billing@cloudhost247.com for the Billing Department; cybercrime-policy.php and
 * trademark-policy.php use abuse@cloudhost247.com for the Abuse and Security Team;
 * legalnotice.tpl uses legal@cloudhost247.com and privacy@cloudhost247.com) — reused here as-is,
 * not invented. This deliberately does NOT include a working web contact form: this app has no
 * SMTP/outbound-email capability yet (email sending is explicitly a later phase per
 * docs/NODE_PLATFORM_STATUS.md), and a form that silently didn't send anywhere would be a fake
 * feature. Nor does it include a phone number or a street address — the purchased WHMCS theme's
 * contact.tpl / lang/overrides/english.php contain only placeholder dummy values for those
 * ("info@gmail.com", "abcdd, Phase 123, IND Area") which are not real CloudHost247 details, so
 * they are correctly not reused (same reasoning as AboutPage.tsx).
 */
const departments = [
  {
    title: 'General support',
    email: 'support@cloudhost247.com',
    description: 'Account, hosting, and technical questions.',
  },
  {
    title: 'Billing',
    email: 'billing@cloudhost247.com',
    description: 'Invoices, payments, and refund requests.',
  },
  {
    title: 'Abuse & security',
    email: 'abuse@cloudhost247.com',
    description: 'Report abuse, fraud, or suspicious activity on a hosted service.',
  },
  {
    title: 'Privacy & data protection',
    email: 'privacy@cloudhost247.com',
    description: 'Data access, deletion, or privacy-related requests.',
  },
  {
    title: 'Legal',
    email: 'legal@cloudhost247.com',
    description: 'General legal inquiries, compliance matters, and formal notices.',
  },
];

export default function ContactPage() {
  usePageMeta('Contact', 'How to reach CloudHost247.');

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Contact Us</h1>
          <p>Reach the right team directly by email.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          <p className="ch247-placeholder-notice">
            A web contact form isn't available on this platform yet. Email the relevant department
            directly below, or existing customers can open a support ticket from the current
            client area.
          </p>
          <div className="ch247-contact-grid">
            {departments.map((dept) => (
              <div className="ch247-index-card" key={dept.email}>
                <h3>{dept.title}</h3>
                <p>{dept.description}</p>
                <a href={`mailto:${dept.email}`}>{dept.email}</a>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
