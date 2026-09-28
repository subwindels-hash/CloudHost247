import { Outlet } from 'react-router-dom';
import { useAuthState } from '../layout/useAuthState';

interface RequireRoleProps {
  roles: readonly string[];
}

/**
 * Frontend-only convenience gate for staff-only sections (e.g. /admin). This is UX, never the
 * security boundary: it only reads the role cached locally at login time (lib/auth.ts), so it
 * cannot be trusted on its own — every actual admin/super_admin API route re-verifies the
 * caller's *current* role directly against the database on every request (see
 * src/lib/require-role.ts on the backend and docs/API_CUSTOMER_APP.md "Authorization model"), and
 * would reject a stale/tampered client role immediately regardless of what this component renders.
 * Its only job is to avoid showing a customer a staff UI that every API call behind it would just
 * 403 anyway, and to show a clear message instead of a confusing broken page.
 */
export default function RequireRole({ roles }: RequireRoleProps) {
  const { user } = useAuthState();

  if (!user || !roles.includes(user.role)) {
    return (
      <div className="ch247-card">
        <h1>Not available</h1>
        <p>This area is only available to CloudHost247 staff accounts.</p>
      </div>
    );
  }

  return <Outlet />;
}
