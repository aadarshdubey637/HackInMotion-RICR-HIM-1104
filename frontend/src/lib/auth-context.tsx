'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, tokenStore, activeFarm, ApiError } from './api';
import { clearCache, clearQueue } from './offline';
import type { User, Farm } from './types';

interface AuthState {
  user: User | null;
  farms: Farm[];
  currentFarm: Farm | null;
  /** True until the initial session check finishes. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    name: string;
    phone?: string;
    /** Language chosen on the sign-up screen, saved with the account. */
    language?: string;
  }) => Promise<void>;
  logout: () => void;
  selectFarm: (farmId: string) => void;
  /** Re-fetch farms after creating or editing one. */
  refreshFarms: () => Promise<Farm[]>;
  /** Replace the cached profile after the settings page saves a change. */
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [currentFarm, setCurrentFarm] = useState<Farm | null>(null);
  const [loading, setLoading] = useState(true);

  /** Load farms and resolve which one is active. */
  const loadFarms = useCallback(async (): Promise<Farm[]> => {
    const { farms: list } = await api.farms.list();
    setFarms(list);

    const savedId = activeFarm.get();
    const selected = list.find((f) => f.id === savedId) ?? list[0] ?? null;
    setCurrentFarm(selected);
    if (selected) activeFarm.set(selected.id);

    return list;
  }, []);

  // Restore the session on first load.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!tokenStore.get()) {
        setLoading(false);
        return;
      }

      try {
        const { user: me } = await api.auth.me();
        if (cancelled) return;
        setUser(me);
        await loadFarms();
      } catch (err) {
        // An expired or invalid token just means "not signed in".
        if (err instanceof ApiError && err.isAuthError) tokenStore.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadFarms]);

  const afterAuth = useCallback(
    async (result: { user: User; tokens: Parameters<typeof tokenStore.set>[0] }) => {
      tokenStore.set(result.tokens);
      setUser(result.user);

      const list = await loadFarms();
      // A farmer with no farm goes straight to setup — the profile drives
      // every other feature, so there is nothing useful to show without it.
      router.push(list.length === 0 ? '/onboarding' : '/dashboard');
    },
    [loadFarms, router],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      await afterAuth(await api.auth.login(email, password));
    },
    [afterAuth],
  );

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      name: string;
      phone?: string;
      language?: string;
    }) => {
      await afterAuth(await api.auth.register(input));
    },
    [afterAuth],
  );

  const logout = useCallback(() => {
    const refresh = tokenStore.getRefresh();
    // Fire and forget — the local session is cleared regardless.
    if (refresh) void api.auth.logout(refresh).catch(() => undefined);

    tokenStore.clear();
    // Cached dashboards are per-account; leaving them would show one farmer's
    // data to the next person who signs in on a shared phone.
    clearCache();
    clearQueue();
    setUser(null);
    setFarms([]);
    setCurrentFarm(null);
    router.push('/login');
  }, [router]);

  const selectFarm = useCallback(
    (farmId: string) => {
      const farm = farms.find((f) => f.id === farmId);
      if (!farm) return;
      setCurrentFarm(farm);
      activeFarm.set(farmId);
    },
    [farms],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        farms,
        currentFarm,
        loading,
        login,
        register,
        logout,
        selectFarm,
        refreshFarms: loadFarms,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
