/**
 * Generic pattern for legal/policy pages (Privacy Policy, Terms of Service, Refund Policy, etc.).
 * This intentionally does NOT contain real legal text — drafting binding legal policy content
 * requires actual legal review, and fabricating placeholder legal terms that look authoritative
 * would be actively misleading to a visitor. Real legal pages already exist and are live on the
 * current WHMCS site (e.g. privacy-policy.php, refund-policy.php) and remain the authoritative
 * versions until this app's legal pages are reviewed and approved to replace them.
 *
 * Usage: add one entry per policy page and route to <LegalPage {...entry} />.
 */
export interface LegalPageProps {
  title: string;
  /** Where the current, legally-reviewed version of this policy lives today. */
  currentVersionNote: string;
}

export default function LegalPage({ title, currentVersionNote }: LegalPageProps) {
  return (
    <div className="ch247-page">
      <h1>{title}</h1>
      <p className="ch247-placeholder-notice">
        <strong>This page is a placeholder.</strong> The legally-reviewed, currently-in-effect
        version of this policy is {currentVersionNote}. This page will be replaced with reviewed
        content once the new platform is ready to take over as the authoritative source for legal
        pages.
      </p>
    </div>
  );
}
