/* ===============================================================================
   BAKAL — AuthGate Component (Login / Register)
   React equivalent of BakalAuth.showLoginScreen() from the vanilla app.
   Renders a full-screen auth overlay with login/register toggle.
   =============================================================================== */

import { useState, useEffect, useRef } from 'react';
import { login, register, resendVerification } from '../services/auth';

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
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  // Check-email screen (post-registration, before verification)
  const [registeredEmail, setRegisteredEmail] = useState(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendMessage, setResendMessage] = useState('');

  // Verified banner (user just clicked the email link → redirected here)
  const [verifiedBanner, setVerifiedBanner] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [company, setCompany] = useState('');

  const firstInputRef = useRef(null);

  // Detect ?verified=true or ?error=invalid_token in the URL after email link click
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('verified') === 'true') {
      setVerifiedBanner(true);
      // Clean the URL so the banner doesn't reappear on refresh
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('error') === 'invalid_token') {
      setError('Lien de vérification invalide ou expiré. Demande un nouveau lien ci-dessous.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Focus the first input whenever mode changes
  useEffect(() => {
    const timer = setTimeout(() => {
      firstInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [isRegister]);

  // Resend cooldown ticker
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  async function handleResendVerification() {
    if (resendCooldown > 0 || !registeredEmail) return;
    setResendMessage('');
    try {
      await resendVerification(registeredEmail);
      setResendMessage('Email renvoyé — vérifie ta boîte de réception (et les spams).');
      setResendCooldown(30);
    } catch (err) {
      setResendMessage(err.message || 'Erreur lors de l\'envoi');
    }
  }

  function toggleMode(e) {
    e.preventDefault();
    setIsRegister((prev) => !prev);
    setError('');
    setName('');
    setEmail('');
    setPassword('');
    setCompany('');
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    if (!forgotEmail) { setError('Entrez votre email'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erreur'); return; }
      setForgotSent(true);
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setVerifiedBanner(false);
    setLoading(true);

    try {
      if (isRegister) {
        const result = await register(name, email, password, company);
        // Offline/demo mode → register() still auto-logs in, onAuth directly
        if (result._demo) {
          if (onAuth) onAuth(result);
          return;
        }
        // Normal flow → show "check your email" screen, do NOT auto-login
        setRegisteredEmail(result.email);
      } else {
        const user = await login(email, password);
        if (onAuth) onAuth(user);
      }
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
              baakal<span style={styles.brandSuffix}>.ai</span>
            </span>
          </div>
          <p style={styles.subtitle}>
            Plateforme de prospection intelligente
          </p>
        </div>

        {/* ─── Check-email screen (post-registration) ─── */}
        {registeredEmail ? (
          <div>
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: 20,
              marginBottom: 16,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📬</div>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
                Vérifie ta boîte de réception
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 4 }}>
                On vient d'envoyer un lien de confirmation à&nbsp;:
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 12 }}>
                {registeredEmail}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Clique sur le lien dans l'email pour activer ton compte Baakalai, puis reviens ici pour te connecter.
              </p>
            </div>

            {resendMessage && (
              <div style={{
                fontSize: 12,
                color: resendMessage.startsWith('Email renvoyé') ? 'var(--success, #16a34a)' : 'var(--danger)',
                marginBottom: 12,
                textAlign: 'center',
              }}>
                {resendMessage}
              </div>
            )}

            <button
              type="button"
              onClick={handleResendVerification}
              disabled={resendCooldown > 0}
              style={{
                ...styles.submitBtn,
                marginBottom: 10,
                ...(resendCooldown > 0 ? styles.submitBtnDisabled : {}),
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
              }}
            >
              {resendCooldown > 0
                ? `Renvoyer dans ${resendCooldown}s`
                : 'Je n\'ai rien reçu — Renvoyer l\'email'}
            </button>

            <button
              type="button"
              onClick={() => {
                setRegisteredEmail(null);
                setResendMessage('');
                setResendCooldown(0);
                setIsRegister(false);
                setName('');
                setPassword('');
                setCompany('');
              }}
              style={styles.submitBtn}
            >
              Retour à la connexion
            </button>
          </div>
        ) :
        /* ─── Forgot password flow ─── */
        showForgot ? (
          <div>
            {forgotSent ? (
              <div>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                  Si cette adresse est associée à un compte, un email de réinitialisation a été envoyé. Vérifiez votre boîte de réception.
                </p>
                <button
                  type="button"
                  onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(''); setError(''); }}
                  style={styles.submitBtn}
                >
                  Retour à la connexion
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword}>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                  Entrez votre email et nous vous enverrons un lien de réinitialisation.
                </p>
                <div style={styles.fieldGroupLast}>
                  <label style={styles.label} htmlFor="forgot-email">Email</label>
                  <input
                    ref={firstInputRef}
                    type="email"
                    id="forgot-email"
                    required
                    autoComplete="email"
                    style={styles.input}
                    placeholder="votre@email.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                  />
                </div>
                {error && <div style={styles.error}>{error}</div>}
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    ...styles.submitBtn,
                    ...(loading ? styles.submitBtnDisabled : {}),
                  }}
                >
                  {loading ? 'Envoi...' : 'Envoyer le lien'}
                </button>
                <p style={styles.toggleText}>
                  <button
                    type="button"
                    style={styles.toggleLink}
                    onClick={() => { setShowForgot(false); setError(''); }}
                  >
                    Retour
                  </button>
                </p>
              </form>
            )}
          </div>
        ) : (
        /* ─── Form ─── */
        <>
        <div>
          {/* Google OAuth button */}
          <button
            type="button"
            onClick={() => { window.location.href = '/api/auth/google'; }}
            style={{
              width: '100%', padding: 11, marginBottom: 16,
              background: 'var(--bg-card)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              fontSize: 14, fontWeight: 500, cursor: 'pointer',
              fontFamily: 'var(--font)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 10,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-muted)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Se connecter avec Google
          </button>

          <div style={{ textAlign: 'center', margin: '12px 0', fontSize: 12, color: 'var(--text-muted)' }}>ou</div>
        </div>

        {verifiedBanner && !isRegister && (
          <div style={{
            background: 'rgba(22, 163, 74, 0.1)',
            border: '1px solid rgba(22, 163, 74, 0.3)',
            color: 'var(--success, #16a34a)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span>✅</span>
            <span>Email vérifié. Tu peux maintenant te connecter.</span>
          </div>
        )}

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
          <div style={{ marginBottom: 8 }}>
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

          {/* Forgot password link (login only) */}
          {!isRegister && (
            <div style={{ textAlign: 'right', marginBottom: 16 }}>
              <button
                type="button"
                style={{ ...styles.toggleLink, fontSize: 12, color: 'var(--text-muted)' }}
                onClick={() => { setShowForgot(true); setError(''); }}
              >
                Mot de passe oublié ?
              </button>
            </div>
          )}
          {isRegister && <div style={{ marginBottom: 12 }} />}

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
                ? 'Créer mon compte'
                : 'Se connecter'}
          </button>

          {/* Toggle login / register */}
          <p style={styles.toggleText}>
            {isRegister ? 'Déjà un compte ? ' : 'Pas encore de compte ? '}
            <button
              type="button"
              style={styles.toggleLink}
              onClick={toggleMode}
            >
              {isRegister ? 'Se connecter' : 'Créer un compte'}
            </button>
          </p>
        </form>
        </>
        )}
      </div>
    </div>
  );
}
