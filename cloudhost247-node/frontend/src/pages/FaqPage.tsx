import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { Markdown } from '../lib/markdown';
import faqJson from '../content/faq.generated.json';

/**
 * The published FAQ.
 *
 * The questions and answers are authored once in `shared/site/content/faq.json` and projected into
 * `faq.generated.json` by `node scripts/site/generate.mjs`; the site-search corpus is built from the
 * same file, so the page a customer reads and the index a customer searches cannot drift apart.
 * The wording is the real published FAQ (faqs.php). Internal links point at the pages that actually
 * exist on this platform — the client-area login/signup reference goes to /register, "cancel from the
 * Client Area" goes to /dashboard, and the policy index goes to /legal — and a feature this app does
 * not have is left as descriptive text rather than linked to a page that is not there.
 */
interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const faqItems: FaqItem[] = (faqJson.items ?? []) as FaqItem[];

export default function FaqPage() {
  usePageMeta('Frequently Asked Questions', 'Answers to common questions about CloudHost247 services and policies.');

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact ch247-hero--photo ch247-hero--support">
        <div className="ch247-hero__inner">
          <h1>Frequently Asked Questions</h1>
          <p>Find answers to the most common questions about our services, policies, and processes.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          {faqItems.map((item) => (
            <article className="ch247-faq-item" id={item.id} key={item.id}>
              <h3>{item.question}</h3>
              {/* Answers are Markdown rendered to React elements — no HTML string is ever injected. */}
              <Markdown source={item.answer} internalLinks />
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
