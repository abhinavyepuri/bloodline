import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  activeRole: UserRole;
  switchRole: (role: UserRole, emailOverride?: string) => Promise<void>;
  isLoading: boolean;
}

const PRESET_ACCOUNTS: Record<string, { email: string; role: UserRole }> = {
  HOSPITAL: { email: 'hospital@smartblood.org', role: 'HOSPITAL' },
  BLOOD_BANK: { email: 'bloodbank@smartblood.org', role: 'BLOOD_BANK' },
  DONOR: { email: 'alice@donor.org', role: 'DONOR' },
  DONOR_BOB: { email: 'bob@donor.org', role: 'DONOR' },
  COORDINATOR: { email: 'coordinator@smartblood.org', role: 'COORDINATOR' },
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('smartblood_token'));
  const [activeRole, setActiveRole] = useState<UserRole>(
    (localStorage.getItem('smartblood_role') as UserRole) || 'COORDINATOR'
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const loginWithCredentials = async (email: string) => {
    setIsLoading(true);
    try {
      const res = await fetch('http://localhost:8000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123' }),
      });
      if (!res.ok) throw new Error('Login failed');
      const data = await res.json();
      setToken(data.access_token);
      setActiveRole(data.role);
      localStorage.setItem('smartblood_token', data.access_token);
      localStorage.setItem('smartblood_role', data.role);

      // Fetch user profile
      const meRes = await fetch('http://localhost:8000/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (meRes.ok) {
        const meData = await meRes.json();
        setUser(meData);
      }
    } catch (err) {
      console.error('Authentication error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const switchRole = async (role: UserRole, emailOverride?: string) => {
    let email = emailOverride;
    if (!email) {
      const preset = PRESET_ACCOUNTS[role];
      email = preset ? preset.email : 'coordinator@smartblood.org';
    }
    await loginWithCredentials(email);
  };

  useEffect(() => {
    // Initial login as coordinator or remembered role
    const initialEmail =
      activeRole === 'HOSPITAL'
        ? 'hospital@smartblood.org'
        : activeRole === 'BLOOD_BANK'
        ? 'bloodbank@smartblood.org'
        : activeRole === 'DONOR'
        ? 'alice@donor.org'
        : 'coordinator@smartblood.org';

    loginWithCredentials(initialEmail);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, activeRole, switchRole, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
