import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthState } from '../layout/useAuthState';

/**
 * Client-side route guard for the authenticated application shell (/dashboard, /account, etc.).
 *
 * This is a *convenience* redirect, not the security boundary — consistent with the rest of this
 * app's auth design (see lib/auth.ts): the server independently re-verifies the token on every
 * protected API call (src/lib/require-auth.ts), including rejecting tokens that were explicitly
 * revoked via /api/auth/logout (see database/migrations/0003_create_revoked_tokens.sql). A user
 * with no token stored locally is redirected straight to /login instead of ever rendering a page
 * that would just show "please log in" after an API call fails; a user whose token *looks* present
 * locally but has actually expired or been revoked server-side is caught by apiFetch's centralized
 * 401 handling (lib/api.ts), which clears the local session and lets this guard redirect on the
 * next render.
 */
export default function RequireAuth() {
  const { token } = useAuthState();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <Outlet />;
}
