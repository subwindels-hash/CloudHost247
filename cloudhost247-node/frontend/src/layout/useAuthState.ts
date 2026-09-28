import { useEffect, useState } from 'react';
import { getStoredUser, getToken, subscribeToAuthChanges, type StoredUser } from '../lib/auth';

export interface AuthState {
  token: string | null;
  user: StoredUser | null;
}

/** Re-renders whenever the locally-stored auth session changes (login, register, logout). */
export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>(() => ({ token: getToken(), user: getStoredUser() }));

  useEffect(() => {
    const refresh = () => setState({ token: getToken(), user: getStoredUser() });
    return subscribeToAuthChanges(refresh);
  }, []);

  return state;
}
