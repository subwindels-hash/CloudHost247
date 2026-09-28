import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';

/**
 * Titles and descriptions below are reused verbatim from the real, currently-published Legal &
 * Policy Center (legal.php) — not invented. Only Privacy Policy has a page on this platform so far
 * (via the generic LegalPage placeholder pattern, itself never containing fabricated legal text —
 * see pages/LegalPage.tsx), matching the agreed Phase 2 scope of one legal/placeholder page, not
 * full parity with all ten policy documents. The other nine are listed honestly, with their real
 * title and description, and a plain statement that the reviewed version lives on the existing
 * site — not a link to a page that doesn't exist here, and not fabricated policy text.
 */
const sections: { title: string; description: string; to?: string }[] = [
  {
    title: 'Privacy Policy',
    description:
      'Learn how we collect, store, protect, and process your personal data. This policy explains your privacy rights and our commitment to data protection.',
    to: '/legal/privacy-policy',
  },
  {
    title: 'Terms of Service',
    description:
      'The terms and conditions that govern your use of our platform, services, and products. Please read these carefully before using any of our services.',
  },
  {
    title: 'Acceptable Use Policy',
    description:
      'Rules and guidelines for using our platform fairly and lawfully. This policy ensures a secure, reliable environment for all users.',
  },
  {
    title: 'Refund Policy',
    description:
      'Clear conditions under which refunds may be issued, including eligibility criteria, timeframes, and exceptions for digital services.',
  },
  {
    title: 'Cookie Policy',
    description:
      'Information about how we use cookies and tracking technologies to improve your browsing experience and platform functionality.',
  },
  {
    title: 'Disclaimer',
    description:
      'Important limitations of liability and legal disclaimers regarding the use of our platform, services, and published content.',
  },
  {
    title: 'Domain Registration Agreement',
    description:
      'Terms governing domain name registration, transfers, renewals, and ownership rights. Includes registrar obligations and registrant responsibilities.',
  },
  {
    title: 'Backup Policy',
    description:
      "Our backup procedures, retention schedules, and recommendations for protecting your data. Understand what we back up and your responsibilities.",
  },
  {
    title: 'Fair Usage Policy',
    description:
      'Resource usage limits and fair allocation rules to ensure optimal performance and stability for all customers on shared infrastructure.',
  },
  {
    title: 'Cybercrime Detection Policy',
    description:
      'How we detect, prevent, and respond to suspicious activity, abuse reports, and illegal use of our network and services.',
  },
];

export default function LegalIndexPage() {
  usePageMeta('Legal & Policy Center', 'All CloudHost247 legal, privacy, and policy documents in one place.');

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Legal &amp; Policy Center</h1>
          <p>All our legal documents and policies in one place.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          <p>
            This section brings together the key legal, privacy, and policy documents that govern
            how our platform operates and how your information is handled.
          </p>
          <div className="ch247-index-grid">
            {sections.map((section) => (
              <div className="ch247-index-card" key={section.title}>
                <span
                  className={`ch247-index-card__status ${
                    section.to ? 'ch247-index-card__status--available' : 'ch247-index-card__status--pending'
                  }`}
                >
                  {section.to ? 'On this platform' : 'On the current site'}
                </span>
                <h3>{section.title}</h3>
                <p>{section.description}</p>
                {section.to ? (
                  <NavLink to={section.to}>Read more →</NavLink>
                ) : (
                  <p className="ch247-page__hint">
                    <em>The currently-in-effect, legally-reviewed version of this policy is published on the existing CloudHost247 site.</em>
                  </p>
                )}
              </div>
            ))}
          </div>
          <p>
            Have a question about any of these? <NavLink to="/contact">Contact us</NavLink>.
          </p>
        </div>
      </section>
    </div>
  );
}
