import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { User, UserRole } from '../types';
import { DEV_ROLE_SWITCHER } from '../config';
import { api, loginRequest, setAuthToken, setUnauthorizedHandler } from '../lib/api';

interface LoginResponse {
  access_token: string;
  token_type: string;
  role: UserRole;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  activeRole: UserRole | null;
  /** True until the persisted session has been checked, so we don't flash the login screen. */
  isBootstrapping: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Demo convenience only — compiled out of production builds. */
  switchRole: (role: UserRole, emailOverride?: string) => Promise<void>;
}

const TOKEN_STORAGE_KEY = 'smartblood_token';
const ROLE_STORAGE_KEY = 'smartblood_role';

/** Preset demo accounts, used only by the development role switcher. */
const PRESET_ACCOUNTS: Record<string, string> = {
  HOSPITAL: 'hospital@smartblood.org',
  BLOOD_BANK: 'bloodbank@smartblood.org',
  DONOR: 'alice@donor.org',
  COORDINATOR: 'coordinator@smartblood.org',
  ADMIN: 'admin@smartblood.org',
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<UserRole | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
    setActiveRole(null);
    setAuthToken(null);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(ROLE_STORAGE_KEY);
  }, []);

  // The API client calls this when it sees a 401, so an expired token drops the
  // user back to the login screen instead of leaving every dashboard silently empty.
  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  const loadProfile = useCallback(async (accessToken: string, role: UserRole) => {
    setAuthToken(accessToken);
    setToken(accessToken);
    setActiveRole(role);
    localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
    localStorage.setItem(ROLE_STORAGE_KEY, role);

    const profile = await api.get<User>('/auth/me');
    setUser(profile);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await loginRequest<LoginResponse>('/auth/login', { email, password });
        await loadProfile(data.access_token, data.role);
      } catch (err) {
        clearSession();
        setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [clearSession, loadProfile]
  );

  const logout = useCallback(() => {
    clearSession();
    setError(null);
  }, [clearSession]);

  const switchRole = useCallback(
    async (role: UserRole, emailOverride?: string) => {
      const email = emailOverride ?? PRESET_ACCOUNTS[role] ?? PRESET_ACCOUNTS.COORDINATOR;
      await login(email, 'password123');
    },
    [login]
  );

  // Resume a persisted session once, on mount.
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    const storedRole = localStorage.getItem(ROLE_STORAGE_KEY) as UserRole | null;

    if (!storedToken || !storedRole) {
      setIsBootstrapping(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await loadProfile(storedToken, storedRole);
      } catch {
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearSession, loadProfile]);

  const value = useMemo(
    () => ({
      user,
      token,
      activeRole,
      isBootstrapping,
      isLoading,
      error,
      login,
      logout,
      switchRole: DEV_ROLE_SWITCHER ? switchRole : async () => {},
    }),
    [user, token, activeRole, isBootstrapping, isLoading, error, login, logout, switchRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
