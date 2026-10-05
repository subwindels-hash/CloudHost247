import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi, store, ApiError } from './api.js';

const AuthContext = createContext({ user: null, loading: true, signIn: () => {}, signOut: () => {} });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(store.token));

  const refresh = useCallback(async () => {
    if (!store.token) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const data = await authApi.me();
      setUser(data.user);
      store.save({ user: data.user });
      return data;
    } catch (err) {
      // A 401 here means the session is truly dead (refresh already attempted), so drop it.
      if (err instanceof ApiError && err.status === 401) store.clear();
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Local sign-out must succeed even if the server is unreachable.
    }
    store.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, setUser, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
