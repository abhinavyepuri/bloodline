import React, { useState } from 'react';
import { Activity, AlertCircle, Building2, Droplet, Heart, LogIn, Shield, UserPlus } from 'lucide-react';
import { useAuth, RegisterPayload } from '../context/AuthContext';

interface SeededAccount {
  label: string;
  email: string;
  password: string;
  role: string;
  bloodType?: string;
}

const PRESET_ACCOUNTS: SeededAccount[] = [
  { label: 'Hospital – Metro General', email: 'hospital@smartblood.org', password: 'password123', role: 'HOSPITAL' },
  { label: 'Hospital – St. Jude', email: 'stjude@smartblood.org', password: 'password123', role: 'HOSPITAL' },
  { label: 'Blood Bank Staff', email: 'bloodbank@smartblood.org', password: 'password123', role: 'BLOOD_BANK' },
  { label: 'System Admin', email: 'admin@smartblood.org', password: 'password123', role: 'ADMIN' },
  // Universal donors and emergency O types
  { label: 'Alice Chen', email: 'alice@donor.org', password: 'password123', role: 'DONOR', bloodType: 'O-' },
  { label: 'Jessica Taylor', email: 'jessica@donor.org', password: 'password123', role: 'DONOR', bloodType: 'O-' },
  { label: 'Bob Okafor', email: 'bob@donor.org', password: 'password123', role: 'DONOR', bloodType: 'O-' },
  { label: 'Helen Kozlov', email: 'helen@donor.org', password: 'password123', role: 'DONOR', bloodType: 'O+' },
  { label: 'Noah Kim', email: 'noah@donor.org', password: 'password123', role: 'DONOR', bloodType: 'O+' },
  // A types
  { label: 'Ian Wright', email: 'ian@donor.org', password: 'password123', role: 'DONOR', bloodType: 'A-' },
  { label: 'Kiran Patel', email: 'kiran@donor.org', password: 'password123', role: 'DONOR', bloodType: 'A-' },
  { label: 'Charlie Nguyen', email: 'charlie@donor.org', password: 'password123', role: 'DONOR', bloodType: 'A+' },
  { label: 'Samuel Green', email: 'samuel@donor.org', password: 'password123', role: 'DONOR', bloodType: 'A+' },
  // B types
  { label: 'Diana Patel', email: 'diana@donor.org', password: 'password123', role: 'DONOR', bloodType: 'B-' },
  { label: 'Priya Nair', email: 'priya@donor.org', password: 'password123', role: 'DONOR', bloodType: 'B-' },
  { label: 'Evan Torres', email: 'evan@donor.org', password: 'password123', role: 'DONOR', bloodType: 'B+' },
  { label: 'Liam O’Connor', email: 'liam@donor.org', password: 'password123', role: 'DONOR', bloodType: 'B+' },
  // AB types
  { label: 'Fatima Al-Hassan', email: 'fatima@donor.org', password: 'password123', role: 'DONOR', bloodType: 'AB-' },
  { label: 'George Mensah', email: 'george@donor.org', password: 'password123', role: 'DONOR', bloodType: 'AB+' },
  { label: 'Maya Sharma', email: 'maya@donor.org', password: 'password123', role: 'DONOR', bloodType: 'AB+' },
];

export const LoginScreen: React.FC = () => {
  const { login, register, isLoading, error } = useAuth();

  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Registration fields
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [regRole, setRegRole] = useState<'HOSPITAL' | 'BLOOD_BANK' | 'DONOR'>('HOSPITAL');
  const [regBloodGroup, setRegBloodGroup] = useState('O-');
  const [facilityAddress, setFacilityAddress] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [credFilter, setCredFilter] = useState<string>('ALL');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (isRegistering) {
      if (!fullName.trim()) {
        setLocalError('Please enter your full name or facility name.');
        return;
      }
      if (!phoneNumber.trim()) {
        setLocalError('Please enter a valid contact phone number.');
        return;
      }
      try {
        const payload: RegisterPayload = {
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          phone_number: phoneNumber.trim(),
          role: regRole,
          blood_group: regRole === 'DONOR' ? regBloodGroup : undefined,
          facility_address: facilityAddress.trim() || undefined,
        };
        await register(payload);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Registration failed.');
      }
      return;
    }

    try {
      await login(email.trim(), password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  const handleSelectPreset = async (preset: SeededAccount) => {
    setIsRegistering(false);
    setEmail(preset.email);
    setPassword(preset.password);
    setLocalError(null);
    try {
      await login(preset.email, preset.password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.75rem 0.95rem',
    fontSize: '0.9rem',
    borderRadius: '8px',
    border: '1px solid var(--border-subtle)',
    background: 'var(--color-bg)',
    color: 'var(--text-main)',
    outline: 'none',
    transition: 'border-color 0.15s ease',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1rem',
        background: 'var(--color-bg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '560px' }}>
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '60px',
              height: '60px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, var(--crimson-500), #991b1b)',
              boxShadow: '0 8px 24px var(--crimson-glow)',
              color: 'white',
              marginBottom: '0.85rem',
            }}
          >
            <Activity size={32} />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-main)' }}>
            SmartBlood
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            Unified Emergency Blood Coordination & Dispatch Network
          </p>
        </div>

        {/* Card Form */}
        <div
          style={{
            background: 'var(--color-surface, #fff)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '16px',
            padding: '1.75rem',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.06)',
          }}
        >
          {/* Mode Switch Tabs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.5rem',
              marginBottom: '1.5rem',
              background: 'var(--color-bg)',
              padding: '0.3rem',
              borderRadius: '10px',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setIsRegistering(false);
                setLocalError(null);
              }}
              style={{
                padding: '0.55rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                borderRadius: '8px',
                border: 'none',
                background: !isRegistering ? 'var(--crimson-500)' : 'transparent',
                color: !isRegistering ? 'white' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                transition: 'all 0.15s ease',
              }}
            >
              <LogIn size={15} />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRegistering(true);
                setLocalError(null);
              }}
              style={{
                padding: '0.55rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                borderRadius: '8px',
                border: 'none',
                background: isRegistering ? 'var(--crimson-500)' : 'transparent',
                color: isRegistering ? 'white' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                transition: 'all 0.15s ease',
              }}
            >
              <UserPlus size={15} />
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {isRegistering && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                    Full Name / Facility Name
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Metro Trauma Center / Dr. Sarah Smith"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                    Contact Phone Number
                  </label>
                  <input
                    type="tel"
                    required
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="e.g. +1-555-0199"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                    Select Your Role / Operation
                  </label>
                  <select
                    className="select-field"
                    value={regRole}
                    onChange={(e) => setRegRole(e.target.value as any)}
                    style={inputStyle}
                  >
                    <option value="HOSPITAL">Hospital Emergency Department</option>
                    <option value="BLOOD_BANK">Blood Bank & Cold-Chain Logistics</option>
                    <option value="DONOR">Voluntary Blood Donor</option>
                  </select>
                </div>

                {regRole === 'DONOR' && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                      Your Blood Group
                    </label>
                    <select
                      className="select-field"
                      value={regBloodGroup}
                      onChange={(e) => setRegBloodGroup(e.target.value)}
                      style={inputStyle}
                    >
                      {['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'].map((bg) => (
                        <option key={bg} value={bg}>{bg}</option>
                      ))}
                    </select>
                  </div>
                )}

                {(regRole === 'HOSPITAL' || regRole === 'BLOOD_BANK') && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                      Facility Physical Address
                    </label>
                    <input
                      type="text"
                      value={facilityAddress}
                      onChange={(e) => setFacilityAddress(e.target.value)}
                      placeholder="e.g. 100 Medical Center Blvd"
                      style={inputStyle}
                    />
                  </div>
                )}
              </>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                Email Address
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@smartblood.org"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                Password
              </label>
              <input
                type="password"
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="•••••••• (minimum 6 characters)"
                style={inputStyle}
              />
            </div>

            {(error || localError) && (
              <div
                role="alert"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: 'var(--crimson-500)',
                  fontSize: '0.82rem',
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{localError || error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: '100%',
                marginTop: '0.5rem',
                padding: '0.85rem',
                fontSize: '0.92rem',
                fontWeight: 700,
                borderRadius: '8px',
                border: 'none',
                background: 'var(--crimson-500)',
                color: 'white',
                cursor: isLoading ? 'wait' : 'pointer',
                opacity: isLoading ? 0.7 : 1,
                boxShadow: '0 4px 14px var(--crimson-glow)',
                transition: 'all 0.15s ease',
              }}
            >
              {isLoading
                ? 'Authenticating...'
                : isRegistering
                ? 'Create Account & Enter Portal'
                : 'Sign In to Portal'}
            </button>
          </form>

          {/* Credential Reference Table */}
          {/* Credential Reference Table */}
          <div
            style={{
              marginTop: '1.5rem',
              paddingTop: '1.25rem',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.65rem',
                flexWrap: 'wrap',
                gap: '0.4rem',
              }}
            >
              <div
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Demo Credentials — click any row to sign in
              </div>

              {/* Blood group and role filter chips */}
              <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                {['ALL', 'FACILITY', 'O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'].map((flt) => (
                  <button
                    key={flt}
                    type="button"
                    onClick={() => setCredFilter(flt)}
                    style={{
                      padding: '0.15rem 0.45rem',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      borderRadius: '4px',
                      cursor: 'pointer',
                      border: '1px solid var(--border-subtle)',
                      background: credFilter === flt ? 'var(--color-primary, #e11d48)' : 'var(--color-bg)',
                      color: credFilter === flt ? '#fff' : 'var(--text-muted)',
                      transition: 'all 0.12s ease',
                    }}
                  >
                    {flt === 'ALL' ? 'All' : flt === 'FACILITY' ? 'Admin & Hospital' : flt}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ maxHeight: '270px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr
                    style={{
                      background: 'var(--color-bg)',
                      borderBottom: '1px solid var(--border-subtle)',
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                    }}
                  >
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Name / Role</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)' }}>Email</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Blood Group</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)' }}>Password</th>
                  </tr>
                </thead>
                <tbody>
                  {PRESET_ACCOUNTS
                    .filter((preset) => {
                      if (credFilter === 'ALL') return true;
                      if (credFilter === 'FACILITY') return preset.role !== 'DONOR';
                      return preset.bloodType === credFilter;
                    })
                    .map((preset, idx, arr) => {
                      const bg = preset.bloodType;
                      let badgeStyle = {
                        bg: 'rgba(239, 68, 68, 0.14)',
                        color: 'var(--crimson-500)',
                        border: 'rgba(239, 68, 68, 0.35)',
                      };
                      if (bg?.startsWith('A') && !bg?.startsWith('AB')) {
                        badgeStyle = { bg: 'rgba(245, 158, 11, 0.14)', color: 'var(--amber-500)', border: 'rgba(245, 158, 11, 0.35)' };
                      } else if (bg?.startsWith('B')) {
                        badgeStyle = { bg: 'rgba(6, 182, 212, 0.14)', color: 'var(--cyan-400)', border: 'rgba(6, 182, 212, 0.35)' };
                      } else if (bg?.startsWith('AB')) {
                        badgeStyle = { bg: 'rgba(168, 85, 247, 0.14)', color: '#c084fc', border: 'rgba(168, 85, 247, 0.35)' };
                      }

                      return (
                        <tr
                          key={preset.email}
                          onClick={() => {
                            if (!isLoading) void handleSelectPreset(preset);
                          }}
                          style={{
                            cursor: 'pointer',
                            borderBottom: idx < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                            background: 'var(--color-surface, #fff)',
                            transition: 'background 0.12s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-surface, #fff)')}
                        >
                          <td style={{ padding: '0.55rem 0.75rem', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              {preset.role === 'HOSPITAL' && <Building2 size={13} color="var(--crimson-500)" style={{ flexShrink: 0 }} />}
                              {preset.role === 'BLOOD_BANK' && <Droplet size={13} color="var(--amber-500)" style={{ flexShrink: 0 }} />}
                              {preset.role === 'DONOR' && <Heart size={13} color="var(--emerald-500)" style={{ flexShrink: 0 }} />}
                              {preset.role === 'ADMIN' && <Shield size={13} color="var(--purple-400)" style={{ flexShrink: 0 }} />}
                              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{preset.label}</span>
                            </div>
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>
                            {preset.email}
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', textAlign: 'center' }}>
                            {preset.bloodType ? (
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '0.15rem 0.5rem',
                                  borderRadius: '4px',
                                  fontSize: '0.72rem',
                                  fontWeight: 800,
                                  background: badgeStyle.bg,
                                  color: badgeStyle.color,
                                  border: `1px solid ${badgeStyle.border}`,
                                }}
                              >
                                {preset.bloodType}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.74rem', letterSpacing: '0.05em' }}>
                            {preset.password}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
