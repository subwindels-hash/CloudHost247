import { usePageMeta } from '../lib/usePageMeta';

/**
 * The only "About us" content that existed anywhere in this repository before this page was
 * Lorem Ipsum filler and fabricated fake team bios (e.g. "John Packet, CEO & Co Founder") shipped
 * as part of a third-party purchased WHMCS theme (templates/cloudhost247_legacy/aboutus.tpl) —
 * none of that is real CloudHost247 content, so none of it is reused here. The copy below is new,
 * written in the same brand voice as the real hero copy (see HomePage.tsx), and is intentionally
 * generic/non-specific (no fabricated team names, founding dates, or metrics) until real company
 * content is supplied.
 */
export default function AboutPage() {
  usePageMeta('About', 'What CloudHost247 provides and what we value.');

  return (
    <div className="ch247-page">
      <h1>About CloudHost247</h1>
      <p>
        CloudHost247 provides cloud hosting and related infrastructure services, with a focus on
        dependable performance, transparent billing, and support that's actually available when
        you need it — not just during business hours.
      </p>
      <p>
        We're in the middle of rebuilding our customer-facing platform on a modern, independent
        stack (this site), while keeping every existing account and service running without
        interruption on our current systems during the transition.
      </p>
      <h2>What we value</h2>
      <ul>
        <li>Clear pricing and billing, with no surprise renewal charges.</li>
        <li>Infrastructure that stays up, and honest communication when it doesn't.</li>
        <li>Support responses from people who can actually resolve the issue.</li>
      </ul>
      <p>
        <em>
          This page will be expanded with our full company story, team, and history in a later
          update.
        </em>
      </p>
    </div>
  );
}
