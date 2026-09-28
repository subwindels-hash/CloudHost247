import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';

/**
 * Questions and answers below are reused verbatim from the real, currently-published FAQ content
 * (faqs.php, rendered by templates/cloudhost247_legacy/faqs.tpl) — not invented. Internal links
 * that have a real equivalent on this platform were repointed to it (the client-area login/signup
 * reference now points to /register, "cancel from the Client Area" links to /dashboard, and the
 * policy index link points to /legal); links to features this app doesn't have yet (submitting a
 * support ticket) are left as descriptive text rather than a link to a page that doesn't exist
 * here. Mailto links and the external cloudhost247.com reference are unchanged.
 */
const faqItems: { id: string; question: string; answer: JSX.Element }[] = [
  {
    id: 'faq-1',
    question: 'What is CloudHost247?',
    answer: (
      <p>
        CloudHost247 is a professional web hosting and cloud solutions provider offering secure,
        reliable, and high-performance hosting, domain registration, and managed IT services for
        individuals, businesses, and organizations worldwide.
      </p>
    ),
  },
  {
    id: 'faq-2',
    question: 'What services do you offer?',
    answer: (
      <>
        <p>We provide:</p>
        <ul>
          <li>Shared, VPS, and Dedicated Hosting</li>
          <li>Cloud Hosting Solutions</li>
          <li>Domain Registration and Management</li>
          <li>Website Security and SSL Certificates</li>
          <li>Managed Server Support</li>
          <li>Email Hosting</li>
          <li>Data Backup and Recovery Services</li>
        </ul>
      </>
    ),
  },
  {
    id: 'faq-3',
    question: 'How do I create an account?',
    answer: (
      <p>
        Click <NavLink to="/register">Create Account</NavLink>, and follow the on-screen
        instructions. Once you complete the registration, you'll receive an email confirmation.
      </p>
    ),
  },
  {
    id: 'faq-4',
    question: 'How can I pay for my services?',
    answer: (
      <>
        <p>We accept multiple payment methods, including:</p>
        <ul>
          <li>Credit/Debit Cards</li>
          <li>PayPal</li>
          <li>Bank Transfers</li>
          <li>Cryptocurrency (Bitcoin, Ethereum where applicable)</li>
        </ul>
      </>
    ),
  },
  {
    id: 'faq-5',
    question: 'Do you offer refunds?',
    answer: (
      <p>
        Yes, we have a Refund Policy that applies to eligible services. Refund requests must be
        submitted within the specified refund period stated in our Refund Policy.
      </p>
    ),
  },
  {
    id: 'faq-6',
    question: 'How do I cancel my account or services?',
    answer: (
      <>
        <p>You can cancel your account by:</p>
        <ul>
          <li>
            Logging into your <NavLink to="/dashboard">Dashboard</NavLink> and submitting a
            cancellation request
          </li>
          <li>
            Contacting our support team via email at <a href="mailto:support@cloudhost247.com">support@cloudhost247.com</a>
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'faq-7',
    question: 'How do I request data deletion?',
    answer: (
      <p>
        Refer to our Data Deletion Instructions. You'll need to email{' '}
        <a href="mailto:privacy@cloudhost247.com">privacy@cloudhost247.com</a> with your account
        details, and we'll process your request in accordance with our Data Protection Standards.
      </p>
    ),
  },
  {
    id: 'faq-8',
    question: 'Do you keep my personal information safe?',
    answer: (
      <p>
        Absolutely. We follow strict Data Protection Standards that comply with GDPR, CCPA, and
        other regulations. Your data is encrypted, stored securely, and never sold to third
        parties.
      </p>
    ),
  },
  {
    id: 'faq-9',
    question: 'Do you provide 24/7 customer support?',
    answer: (
      <>
        <p>Yes, our support team is available 24/7/365 via:</p>
        <ul>
          <li>
            Email: <a href="mailto:support@cloudhost247.com">support@cloudhost247.com</a>
          </li>
          <li>Live Chat (on our website)</li>
          <li>Support Tickets in the Client Area</li>
        </ul>
      </>
    ),
  },
  {
    id: 'faq-10',
    question: 'How do I transfer my website to CloudHost247?',
    answer: (
      <p>
        We offer free migration assistance for most hosting plans. Simply{' '}
        <a href="mailto:support@cloudhost247.com">contact our support team</a> with your current
        hosting details, and we'll handle the transfer for you.
      </p>
    ),
  },
  {
    id: 'faq-11',
    question: 'What happens if my website gets hacked?',
    answer: (
      <p>
        If your website is compromised, our security team can assist with malware removal,
        security patches, and restoration from backups (if backups are active on your account).
      </p>
    ),
  },
  {
    id: 'faq-12',
    question: 'Where can I read your full policies?',
    answer: (
      <p>
        All our policies, including Privacy Policy, Terms &amp; Conditions, Refund Policy, Cookie
        Policy, and Data Protection Standards, are listed on our <NavLink to="/legal">Legal &amp; Policy Center</NavLink>.
      </p>
    ),
  },
];

export default function FaqPage() {
  usePageMeta('Frequently Asked Questions', 'Answers to common questions about CloudHost247 services and policies.');

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Frequently Asked Questions</h1>
          <p>Find answers to the most common questions about our services, policies, and processes.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          {faqItems.map((item) => (
            <article className="ch247-faq-item" key={item.id}>
              <h3>{item.question}</h3>
              {item.answer}
            </article>
          ))}
          <p>
            Can't find what you're looking for? <NavLink to="/contact">Contact our support team</NavLink>.
          </p>
        </div>
      </section>
    </div>
  );
}
