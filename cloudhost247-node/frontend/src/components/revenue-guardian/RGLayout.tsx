/**
 * Revenue Guardian module shell: page heading + permission-filtered section navigation.
 * Menu filtering is UX only — every API behind these links re-verifies permissions server-side.
 */
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthState } from '../../layout/useAuthState';
import { rgPermissionsForRole, type RgPermission } from '../../lib/revenue-guardian-api';

interface NavItem {
  to: string;
  label: string;
  permission: RgPermission;
}

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Overview',
    items: [
      { to: '/admin/revenue-guardian', label: 'Dashboard', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/my-work', label: 'My Work', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/revenue-at-risk', label: 'Revenue at Risk', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/customer-health', label: 'Customer Health', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/high-value', label: 'High-Value Customers', permission: 'revenue_guardian.view' },
    ],
  },
  {
    title: 'Recovery',
    items: [
      { to: '/admin/revenue-guardian/recovery', label: 'Recovery Queue', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/kanban', label: 'Kanban Board', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/follow-ups', label: 'Follow-ups', permission: 'revenue_guardian.followups' },
      { to: '/admin/revenue-guardian/promises', label: 'Payment Promises', permission: 'revenue_guardian.promises' },
      { to: '/admin/revenue-guardian/assignments', label: 'Assignments', permission: 'revenue_guardian.view' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { to: '/admin/revenue-guardian/orders', label: 'Orders', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/renewals', label: 'Renewals', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/renewal-rescue', label: 'Renewal Rescue', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/expiring-services', label: 'Expiring Services', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/pre-suspension', label: 'Pre-Suspension', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/pre-termination', label: 'Pre-Termination', permission: 'revenue_guardian.view' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/admin/revenue-guardian/risk-analysis', label: 'Risk Analysis', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/forecast', label: 'Forecast', permission: 'revenue_guardian.view_financials' },
      { to: '/admin/revenue-guardian/reports', label: 'Reports', permission: 'revenue_guardian.reports' },
      { to: '/admin/revenue-guardian/staff-performance', label: 'Staff Performance', permission: 'revenue_guardian.staff_performance' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/admin/revenue-guardian/automation', label: 'Automation', permission: 'revenue_guardian.automation' },
      { to: '/admin/revenue-guardian/automation/runs', label: 'Automation Runs', permission: 'revenue_guardian.automation' },
      { to: '/admin/revenue-guardian/activity', label: 'Activity Log', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/email-logs', label: 'Communication Log', permission: 'revenue_guardian.view' },
      { to: '/admin/revenue-guardian/module-health', label: 'Module Health', permission: 'revenue_guardian.automation' },
      { to: '/admin/revenue-guardian/settings', label: 'Settings', permission: 'revenue_guardian.settings' },
    ],
  },
];

export default function RGLayout({ title, hint, actions, children }: { title: string; hint?: string; actions?: ReactNode; children: ReactNode }) {
  const { user } = useAuthState();
  const permissions = rgPermissionsForRole(user?.role);

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h1 style={{ marginBottom: '0.15rem' }}>Revenue Guardian</h1>
            <p className="ch247-page__hint">Revenue recovery management — built on the CloudHost247 billing ledger.</p>
          </div>
          {actions}
        </div>
        <nav style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((i) => permissions.includes(i.permission));
            if (items.length === 0) return null;
            return (
              <div key={section.title} style={{ minWidth: '9rem' }}>
                <p className="ch247-page__hint" style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{section.title}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/admin/revenue-guardian' || item.to === '/admin/revenue-guardian/automation'}
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
