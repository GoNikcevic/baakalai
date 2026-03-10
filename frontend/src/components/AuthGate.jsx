/* ===============================================================================
   BAKAL — AuthGate Component (Login / Register)
   React equivalent of BakalAuth.showLoginScreen() from the vanilla app.
   Renders a full-screen auth overlay with login/register toggle.
   =============================================================================== */

import { useState, useEffect, useRef } from 'react';
import { login, register } from '../services/auth';

/* ─── Inline styles matching the vanilla app's auth overlay ─── */
const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    background: 'var(--bg-primary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font)',
  },
  container: {
    width: '100%',
    maxWidth: 400,
    padding: 24,
  },
  header: {
    textAlign: 'center',
    marginBottom: 32,
  },
  brandRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  brandIcon: {
    width: 36,
    height: 36,
    background: 'var(--text-primary)',
    color: 'var(--bg-primary)',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 18,
  },
  brandText: {
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  brandSuffix: {
    color: 'var(--text-muted)',
  },
  subtitle: {
    color: 'var(--text-secondary)',
    fontSize: 13,
    marginTop: 8,
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: 6,
  },
  labelOptional: {
    color: 'var(--text-muted)',
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontSize: 14,
    fontFamily: 'var(--font)',
    outline: 'none',
    boxSizing: 'border-box',
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldGroupLast: {
    marginBottom: 20,
  },
  error: {
    color: 'var(--danger)',
    fontSize: 12,
    marginBottom: 12,
  },
  submitBtn: {
    width: '100%',
    padding: 11,
    background: 'var(--text-primary)',
    color: 'var(--bg-primary)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'var(--font)',
  },
  submitBtnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  toggleText: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 13,
    color: 'var(--text-muted)',
  },
  toggleLink: {
    color: 'var(--text-primary)',
    textDecoration: 'underline',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    fontFamily: 'var(--font)',
    fontSize: 13,
    padding: 0,
  },
};

export default function AuthGate({ onAuth }) {
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [company, setCompany] = useState('');

  const firstInputRef = useRef(null);

  // Focus the first input whenever mode changes
  useEffect(() => {
    const timer = setTimeout(() => {
      firstInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [isRegister]);

  function toggleMode(e) {
    e.preventDefault();
    setIsRegister((prev) => !prev);
    setError('');
    setName('');
    setEmail('');
    setPassword('');
    setCompany('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let user;
      if (isRegister) {
        user = await register(name, email, password, company);
      } else {
        user = await login(email, password);
      }
      // Notify parent of successful authentication
      if (onAuth) onAuth(user);
    } catch (err) {
      setError(err.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        {/* ─── Brand header ─── */}
        <div style={styles.header}>
          <div style={styles.brandRow}>
            <div style={styles.brandIcon}>b</div>
            <span style={styles.brandText}>
              bakal<span style={styles.brandSuffix}>.ai</span>
            </span>
          </div>
          <p style={styles.subtitle}>
            Plateforme de prospection intelligente
          </p>
        </div>

        {/* ─── Form ─── */}
        <form onSubmit={handleSubmit} autoComplete="on">
          {/* Name (register only) */}
          {isRegister && (
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="auth-name">
                Nom complet
              </label>
              <input
                ref={firstInputRef}
                type="text"
                id="auth-name"
                name="name"
                required
                autoComplete="name"
                style={styles.input}
                placeholder="Goran Nikcevic"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          {/* Email */}
          <div style={styles.fieldGroup}>
            <label style={styles.label} htmlFor="auth-email">
              Email
            </label>
            <input
              ref={isRegister ? undefined : firstInputRef}
              type="email"
              id="auth-email"
              name="email"
              required
              autoComplete="email"
              style={styles.input}
              placeholder="goran@stanko.fr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* Company (register only) */}
          {isRegister && (
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="auth-company">
                Entreprise{' '}
                <span style={styles.labelOptional}>(optionnel)</span>
              </label>
              <input
                type="text"
                id="auth-company"
                name="company"
                autoComplete="organization"
                style={styles.input}
                placeholder="Stanko"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
          )}

          {/* Password */}
          <div style={styles.fieldGroupLast}>
            <label style={styles.label} htmlFor="auth-password">
              Mot de passe
            </label>
            <input
              type="password"
              id="auth-password"
              name="password"
              required
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              style={styles.input}
              placeholder={
                isRegister
                  ? 'Min. 8 car., majuscule, chiffre'
                  : 'Votre mot de passe'
              }
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {/* Error message */}
          {error && <div style={styles.error}>{error}</div>}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.submitBtn,
              ...(loading ? styles.submitBtnDisabled : {}),
            }}
          >
            {loading
              ? 'Chargement...'
              : isRegister
                ? 'Cr\u00e9er mon compte'
                : 'Se connecter'}
          </button>

          {/* Toggle login / register */}
          <p style={styles.toggleText}>
            {isRegister ? 'D\u00e9j\u00e0 un compte ? ' : 'Pas encore de compte ? '}
            <button
              type="button"
              style={styles.toggleLink}
              onClick={toggleMode}
            >
              {isRegister ? 'Se connecter' : 'Cr\u00e9er un compte'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
