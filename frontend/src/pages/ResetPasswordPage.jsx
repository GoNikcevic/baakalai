import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { BrandLockup } from '../components/BrandMark';

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    background: 'radial-gradient(900px 420px at 50% -8%, var(--accent-glow) 0%, transparent 70%), var(--bg-primary)',
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
    marginBottom: 24,
  },
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-lg)',
    padding: '26px 24px',
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    background: 'var(--paper-2)',
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
  error: {
    color: 'var(--danger)',
    fontSize: 12,
    marginBottom: 12,
  },
  success: {
    color: 'var(--success, #22c55e)',
    fontSize: 14,
    lineHeight: 1.6,
    marginBottom: 20,
  },
  /* Même bouton de marque que l'écran de connexion : violet, et --paper en
     couleur de texte pour rester lisible quand le thème sombre éclaircit
     --primary. */
  submitBtn: {
    width: '100%',
    padding: 11,
    background: 'var(--primary)',
    color: 'var(--paper)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'var(--font)',
    boxShadow: '0 2px 12px rgba(110, 87, 250, 0.25)',
    transition: 'background 0.15s, box-shadow 0.15s',
  },
  submitBtnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  link: {
    color: 'var(--primary)',
    textDecoration: 'underline',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    fontFamily: 'var(--font)',
    fontSize: 13,
    padding: 0,
  },
};

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { lang } = useI18n();
  const en = lang === 'en';
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // 'success' | null
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError(en ? 'Passwords do not match' : 'Les mots de passe ne correspondent pas'); return; }
    if (password.length < 8) { setError(en ? 'Min. 8 characters' : 'Min. 8 caractères'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || (en ? 'Error' : 'Erreur')); return; }
      setStatus('success');
    } catch {
      setError(en ? 'Network error' : 'Erreur réseau');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div style={styles.overlay}>
        <div style={styles.container}>
          <div style={styles.header}>
            <BrandLockup size={36} fontSize={25} gap={9} glow />
          </div>
          <div style={styles.card}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>
              {en ? 'Invalid or missing reset link.' : 'Lien de réinitialisation invalide ou manquant.'}
            </p>
            <button style={styles.submitBtn} onClick={() => navigate('/login')}>
              {en ? 'Back to login' : 'Retour à la connexion'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        <div style={styles.header}>
          <BrandLockup size={36} fontSize={25} gap={9} glow />
        </div>

        <div style={styles.card}>
        {status === 'success' ? (
          <div>
            <p style={styles.success}>
              {en ? 'Your password has been successfully reset. You can now log in.' : 'Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.'}
            </p>
            <button style={styles.submitBtn} onClick={() => navigate('/login')}>
              {en ? 'Log in' : 'Se connecter'}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
              {en ? 'Choose a new password for your account.' : 'Choisissez un nouveau mot de passe pour votre compte.'}
            </p>
            <div style={styles.fieldGroup}>
              <label style={styles.label} htmlFor="reset-password">{en ? 'New password' : 'Nouveau mot de passe'}</label>
              <input
                type="password"
                id="reset-password"
                required
                autoComplete="new-password"
                style={styles.input}
                placeholder={en ? 'Min. 8 characters' : 'Min. 8 caractères'}
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={styles.label} htmlFor="reset-confirm">{en ? 'Confirm password' : 'Confirmer le mot de passe'}</label>
              <input
                type="password"
                id="reset-confirm"
                required
                autoComplete="new-password"
                style={styles.input}
                placeholder={en ? 'Retype your password' : 'Retapez votre mot de passe'}
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
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
              {loading ? (en ? 'Resetting...' : 'Réinitialisation...') : (en ? 'Reset password' : 'Réinitialiser le mot de passe')}
            </button>
          </form>
        )}
        </div>
      </div>
    </div>
  );
}
