/**
 * Fraud Sentinel module shell: page heading + permission-filtered section navigation.
 *
 * Menu filtering is UX only — every API behind these links re-verifies the caller's role and
 * permission server-side (src/fraud-sentinel/permissions.ts), so hiding an entry can never grant or
 * withhold access on its own.
 *
 * The heading carries one fixed line describing what the module is. The server's own advisory
 * STATEMENT — the wording it publishes in `ADVISORY_ONLY` — is rendered by `AdvisoryNotice` on the
 * screens that show a score, so a page never says the same sentence twice and the shell never has to
 * paraphrase a contract it does not own.
 */
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { fsPermissionsForRole, type FsPermission } from '../../lib/fraud-sentinel-api';
import { useAuthState } from '../../layout/useAuthState';

interface NavItem {
  to: string;
  label: string;
  permission: FsPermission;
}

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Overview',
    items: [
      { to: '/admin/fraud-sentinel', label: 'Dashboard', permission: 'fraud_sentinel.view' },
      { to: '/admin/fraud-sentinel/alerts', label: 'Alert Queue', permission: 'fraud_sentinel.view' },
      { to: '/admin/fraud-sentinel/investigations', label: 'Investigation Ledger', permission: 'fraud_sentinel.view' },
    ],
  },
  {
    title: 'Subjects',
    items: [
      { to: '/admin/fraud-sentinel/assessments', label: 'Assessments', permission: 'fraud_sentinel.view' },
      { to: '/admin/fraud-sentinel/customers', label: 'Customer Risk', permission: 'fraud_sentinel.view' },
      { to: '/admin/fraud-sentinel/transactions', label: 'Transaction Ledger', permission: 'fraud_sentinel.view' },
    ],
  },
  {
    title: 'Detection',
    items: [
      // Rule history and the reviewer-disagreement report are sections of this screen, not routes of
      // their own: a nav entry must point at something the router serves.
      { to: '/admin/fraud-sentinel/rules', label: 'Rule Catalogue', permission: 'fraud_sentinel.view' },
    ],
  },
  {
    title: 'System',
    items: [
      // Jobs, the run ledger, an on-demand scan and the settings (readable by every viewer, writable
      // only by a super administrator — the page hides the controls it may not use).
      { to: '/admin/fraud-sentinel/operations', label: 'Operations & Settings', permission: 'fraud_sentinel.view' },
    ],
  },
];

export default function FSLayout({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user } = useAuthState();
  const permissions = fsPermissionsForRole(user?.role);

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h1 style={{ marginBottom: '0.15rem' }}>Fraud Sentinel</h1>
            <p className="ch247-page__hint">
              Read-only fraud detection and investigation — it reports, it never enforces.
            </p>
          </div>
          {actions}
        </div>
        <nav style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => permissions.includes(item.permission));
            if (items.length === 0) return null;
            return (
              <div key={section.title} style={{ minWidth: '9rem' }}>
                <p className="ch247-page__hint" style={{ fontWeight: 700, marginBottom: '0.2rem' }}>
                  {section.title}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/admin/fraud-sentinel'}
                      style={({ isActive }) => ({ fontWeight: isActive ? 700 : 400, fontSize: '0.9rem' })}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </div>
      <div className="ch247-card">
        <h2>{title}</h2>
        {hint ? <p className="ch247-page__hint">{hint}</p> : null}
        {children}
      </div>
    </div>
  );
}
