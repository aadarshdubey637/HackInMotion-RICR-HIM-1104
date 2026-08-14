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
  /**
   * `identifier` is a Gmail address, or a username on an account old enough to
   * have one — registration no longer asks for a username.
   */
  login: (identifier: string, password: string) => Promise<void>;
  /**
   * Create the account, sign in, and land on email verification.
   *
   * Unlike `login`, this does *not* go on to the dashboard: it stops at
   * `/verify-email`. The tokens are stored first because both OTP endpoints are
   * authenticated — the code is emailed to the address on the account, never to
   * one supplied in a request — so the farmer must already hold a session by the
   * time that screen loads. `continueToApp` finishes the journey.
   */
  register: (input: {
    name: string;
    email: string;
    phone: string;
    password: string;
    confirmPassword: string;
    /** Language chosen on the sign-up screen, saved with the account. */
    language?: string;
  }) => Promise<void>;
  /**
   * Sign in with the ID token Google handed the browser. Covers sign-up too —
   * the backend creates the account when it has never seen this Google user.
   */
  loginWithGoogle: (idToken: string, language?: string) => Promise<void>;
  logout: () => void;
  /**
   * Load farms and move on to the app — the tail of a sign-in, on its own.
   *
   * `/verify-email` calls this once the code is accepted, so registration ends
   * in exactly the same place a login does. Split out of `afterAuth` rather than
   * duplicated, so "where does a signed-in farmer land" stays one decision.
   */
  continueToApp: () => Promise<void>;
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

  /**
   * Load farms and route onward. The tail end of every successful sign-in.
   *
   * A farmer with no farm goes straight to setup — the profile drives every
   * other feature, so there is nothing useful to show without it.
   */
  const continueToApp = useCallback(async () => {
    const list = await loadFarms();
    router.push(list.length === 0 ? '/onboarding' : '/dashboard');
  }, [loadFarms, router]);

  const afterAuth = useCallback(
    async (result: { user: User; tokens: Parameters<typeof tokenStore.set>[0] }) => {
      tokenStore.set(result.tokens);
      setUser(result.user);
      await continueToApp();
    },
    [continueToApp],
  );

  const login = useCallback(
    async (identifier: string, password: string) => {
      await afterAuth(await api.auth.login(identifier, password));
    },
    [afterAuth],
  );

  /**
   * Registration signs the farmer in, then stops at email verification.
   *
   * "Registered means signed in" still holds — the endpoint returns the same
   * `{ user, tokens }` as login and the tokens are stored here, which is what
   * lets the authenticated OTP endpoints work on the next screen. What differs
   * is only the destination: `/verify-email` instead of the dashboard.
   *
   * Farms are deliberately not loaded yet. A brand-new account has none, so the
   * request would be a wasted round trip on the slowest connection in the
   * journey; `continueToApp` does it after the code is accepted.
   */
  const register = useCallback(
    async (input: {
      name: string;
      email: string;
      phone: string;
      password: string;
      confirmPassword: string;
      language?: string;
    }) => {
      const result = await api.auth.register(input);
      tokenStore.set(result.tokens);
      setUser(result.user);
      router.push('/verify-email');
    },
    [router],
  );

  const loginWithGoogle = useCallback(
    async (idToken: string, language?: string) => {
      await afterAuth(await api.auth.google(idToken, language));
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
        loginWithGoogle,
        logout,
        continueToApp,
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
