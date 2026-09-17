'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch, tokenStorage } from './api';
import type { AuthResponse, MeResponse } from './types';

interface AuthContextValue {
  session: MeResponse | null;
  /** True until the stored token has been checked against the server. */
  isLoading: boolean;
  signIn: (response: AuthResponse) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the signed-in session.
 *
 * On mount it verifies the stored token with `GET /auth/me` rather than trusting
 * its contents, so a revoked or expired token never renders a logged-in shell.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<MeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const queryClient = useQueryClient();

  const loadSession = useCallback(async () => {
    if (!tokenStorage.get()) {
      setSession(null);
      setIsLoading(false);
      return;
    }

    try {
      setSession(await apiFetch<MeResponse>('/auth/me'));
    } catch {
      // apiFetch already cleared the token on a 401.
      tokenStorage.clear();
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const signIn = useCallback((response: AuthResponse) => {
    tokenStorage.set(response.accessToken);
    setSession({
      user: response.user,
      restaurant: response.restaurant,
      restaurants: response.restaurants,
    });
    setIsLoading(false);
  }, []);

  const signOut = useCallback(async () => {
    try {
      // Courtesy call: the backend has no session to destroy (stateless JWTs),
      // but it keeps the audit trail honest and lets the API log the event.
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Logging out must work even if the API is unreachable.
    }

    tokenStorage.clear();
    setSession(null);
    queryClient.clear();
    router.replace('/restaurant/login');
  }, [queryClient, router]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, isLoading, signIn, signOut, refresh: loadSession }),
    [session, isLoading, signIn, signOut, loadSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }

  return context;
}
