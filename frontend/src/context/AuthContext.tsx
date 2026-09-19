import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { User, UserRole } from '../types';
import { api, loginRequest, setAuthToken, setUnauthorizedHandler } from '../lib/api';

interface LoginResponse {
  access_token: string;
  token_type: string;
  role: UserRole;
  user_id: string;
  full_name: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  full_name: string;
  phone_number: string;
  role: 'HOSPITAL' | 'BLOOD_BANK' | 'DONOR';
  blood_group?: string;
  facility_address?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  activeRole: UserRole | null;
  isBootstrapping: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
}

const TOKEN_STORAGE_KEY = 'smartblood_token';
const ROLE_STORAGE_KEY = 'smartblood_role';

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

  // When API client receives a 401 Unauthorized, automatically clear stale session
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
        const data = await loginRequest<LoginResponse>('/auth/login', {
          email: email.trim().toLowerCase(),
          password,
        });
        await loadProfile(data.access_token, data.role);
      } catch (err) {
        clearSession();
        const msg = err instanceof Error ? err.message : 'Sign-in failed. Please verify your credentials.';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [clearSession, loadProfile]
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      setIsLoading(true);
      setError(null);
      try {
        await api.post<User>('/auth/register', {
          email: payload.email.trim().toLowerCase(),
          password: payload.password,
          full_name: payload.full_name.trim(),
          phone_number: payload.phone_number.trim(),
          role: payload.role,
          blood_group: payload.blood_group,
          facility_address: payload.facility_address,
        });
        // Log in immediately after successful registration
        await login(payload.email.trim().toLowerCase(), payload.password);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Registration failed. Please check your details.';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [login]
  );

  const logout = useCallback(() => {
    clearSession();
    setError(null);
  }, [clearSession]);

  // Resume a persisted session on mount
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    const storedRole = localStorage.getItem(ROLE_STORAGE_KEY) as UserRole | null;

    if (!storedToken || !storedRole) {
      setIsBootstrapping(false);
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        await loadProfile(storedToken, storedRole);
      } catch {
        if (isMounted) clearSession();
      } finally {
        if (isMounted) setIsBootstrapping(false);
      }
    })();

    return () => {
      isMounted = false;
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
      register,
      logout,
    }),
    [user, token, activeRole, isBootstrapping, isLoading, error, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
