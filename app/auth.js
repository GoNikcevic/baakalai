/* ═══════════════════════════════════════════════════════════════════════════
   BAKAL — Authentication Module
   Handles login, register, token storage, refresh, and auth state.
   ═══════════════════════════════════════════════════════════════════════════ */

const BakalAuth = (() => {
  const TOKEN_KEY = 'bakal_token';
  const REFRESH_KEY = 'bakal_refresh_token';
  const USER_KEY = 'bakal_user';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getRefreshToken() {
    return localStorage.getItem(REFRESH_KEY);
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch { return null; }
  }

  function setSession(token, refreshToken, user) {
    localStorage.setItem(TOKEN_KEY, token);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function isLoggedIn() {
    return !!getToken();
  }

  async function login(email, password) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) throw new Error('offline');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      setSession(data.token, data.refreshToken, data.user);
      return data.user;
    } catch (err) {
      // Backend unreachable (GitHub Pages / offline) — demo mode
      if (err.message === 'offline' || err.name === 'TypeError') {
        const demoUser = { name: email.split('@')[0], email, role: 'demo' };
        setSession('demo-token', null, demoUser);
        return demoUser;
      }
      throw err;
    }
  }

  async function register(name, email, password, company) {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, company }),
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) throw new Error('offline');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      setSession(data.token, data.refreshToken, data.user);
      return data.user;
    } catch (err) {
      if (err.message === 'offline' || err.name === 'TypeError') {
        const demoUser = { name, email, role: 'demo' };
        setSession('demo-token', null, demoUser);
        return demoUser;
      }
      throw err;
    }
  }

  /**
   * Refresh the access token using the stored refresh token.
   * Returns the new access token, or null if refresh failed.
   */
  let _refreshPromise = null;

  async function refreshAccessToken() {
    // Deduplicate concurrent refresh calls
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = (async () => {
      const rt = getRefreshToken();
      if (!rt) return null;

      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });

        if (!res.ok) {
          clearSession();
          return null;
        }

        const data = await res.json();
        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
        return data.token;
      } catch {
        return null;
      } finally {
        _refreshPromise = null;
      }
    })();

    return _refreshPromise;
  }

  async function logout() {
    const rt = getRefreshToken();
    // Revoke refresh token on the server (best-effort)
    if (rt) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
      } catch { /* ignore */ }
    }
    clearSession();
    showLoginScreen();
  }

  async function validateToken() {
    const token = getToken();
    if (!token) return false;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        return true;
      }
      // Token expired — try refresh
      const newToken = await refreshAccessToken();
      if (!newToken) {
        clearSession();
        return false;
      }
      // Re-validate with new token
      const res2 = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + newToken },
      });
      if (!res2.ok) {
        clearSession();
        return false;
      }
      const data2 = await res2.json();
      localStorage.setItem(USER_KEY, JSON.stringify(data2.user));
      return true;
    } catch {
      return false;
    }
  }

  /* ─── Login/Register UI ─── */

  function showLoginScreen() {
    let overlay = document.getElementById('auth-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'auth-overlay';
      document.body.prepend(overlay);
    }

    overlay.style.cssText = `
      position:fixed;inset:0;z-index:10000;
      background:var(--bg-primary);
      display:flex;align-items:center;justify-content:center;
      font-family:var(--font);
    `;

    overlay.innerHTML = `
      <div style="width:100%;max-width:400px;padding:24px;">
        <div style="text-align:center;margin-bottom:32px;">
          <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:8px;">
            <div style="width:36px;height:36px;background:var(--text-primary);color:var(--bg-primary);border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;">b</div>
            <span style="font-size:22px;font-weight:600;color:var(--text-primary);">bakal<span style="color:var(--text-muted)">.ai</span></span>
          </div>
          <p style="color:var(--text-secondary);font-size:13px;margin-top:8px;">Plateforme de prospection intelligente</p>
        </div>

        <div id="auth-form-container">
          ${renderLoginForm()}
        </div>
      </div>
    `;

    bindAuthForm();
  }

  function renderLoginForm() {
    return `
      <form id="auth-form" autocomplete="on">
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">Email</label>
          <input type="email" name="email" id="auth-email" required autocomplete="email"
            style="width:100%;padding:10px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;font-family:var(--font);outline:none;"
            placeholder="goran@stanko.fr">
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">Mot de passe</label>
          <input type="password" name="password" id="auth-password" required autocomplete="current-password"
            style="width:100%;padding:10px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;font-family:var(--font);outline:none;"
            placeholder="Votre mot de passe" minlength="8">
        </div>
        <div id="auth-error" style="color:var(--danger);font-size:12px;margin-bottom:12px;display:none;"></div>
        <button type="submit" id="auth-submit"
          style="width:100%;padding:11px;background:var(--text-primary);color:var(--bg-primary);border:none;border-radius:var(--radius-sm);font-size:14px;font-weight:600;cursor:pointer;font-family:var(--font);">
          Se connecter
        </button>
        <p style="text-align:center;margin-top:16px;font-size:13px;color:var(--text-muted);">
          Pas encore de compte ?
          <a href="#" id="auth-toggle" style="color:var(--text-primary);text-decoration:underline;cursor:pointer;">Cr\u00e9er un compte</a>
        </p>
      </form>
    `;
  }

  function renderRegisterForm() {
    return `
      <form id="auth-form" autocomplete="on">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">Nom complet</label>
          <input type="text" name="name" id="auth-name" required autocomplete="name"
            style="width:100%;padding:10px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;font-family:var(--font);outline:none;"
            placeholder="Goran Nikcevic">
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">Email</label>
          <input type="email" name="email" id="auth-email" required autocomplete="email"
            style="width:100%;padding:10px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;font-family:var(--font);outline:none;"
            placeholder="goran@stanko.fr">
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">Entreprise <span style="color:var(--text-muted);">(optionnel)</span></label>
          <input type="text" name="company" id="auth-company" autocomplete="organization"
            style="width:100%;padding:10px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;font-family:var(--font);outline:none;"
            placeholder="Stanko">
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px;">Mot de passe</label>
          <input type="password" name="password" id="auth-password" required autocomplete="new-password"
            style="width:100%;padding:10px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;font-family:var(--font);outline:none;"
            placeholder="Min. 8 car., majuscule, chiffre" minlength="8">
        </div>
        <div id="auth-error" style="color:var(--danger);font-size:12px;margin-bottom:12px;display:none;"></div>
        <button type="submit" id="auth-submit"
          style="width:100%;padding:11px;background:var(--text-primary);color:var(--bg-primary);border:none;border-radius:var(--radius-sm);font-size:14px;font-weight:600;cursor:pointer;font-family:var(--font);">
          Cr\u00e9er mon compte
        </button>
        <p style="text-align:center;margin-top:16px;font-size:13px;color:var(--text-muted);">
          D\u00e9j\u00e0 un compte ?
          <a href="#" id="auth-toggle" style="color:var(--text-primary);text-decoration:underline;cursor:pointer;">Se connecter</a>
        </p>
      </form>
    `;
  }

  let isRegisterMode = false;

  function bindAuthForm() {
    const container = document.getElementById('auth-form-container');
    const toggleBtn = document.getElementById('auth-toggle');
    const form = document.getElementById('auth-form');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        isRegisterMode = !isRegisterMode;
        container.innerHTML = isRegisterMode ? renderRegisterForm() : renderLoginForm();
        bindAuthForm();
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('auth-error');
        const btn = document.getElementById('auth-submit');
        const origText = btn.textContent;

        errEl.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Chargement...';

        try {
          if (isRegisterMode) {
            const name = document.getElementById('auth-name').value.trim();
            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            const company = document.getElementById('auth-company')?.value?.trim() || '';
            await register(name, email, password, company);
          } else {
            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            await login(email, password);
          }

          // Success — hide overlay and boot app
          hideLoginScreen();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = origText;
        }
      });
    }

    // Focus first input
    const firstInput = form?.querySelector('input');
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
  }

  function hideLoginScreen() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
      overlay.style.transition = 'opacity 0.3s';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    }
    // Boot the app
    if (typeof bootApp === 'function') bootApp();
  }

  function updateUserDisplay() {
    const user = getUser();
    if (!user) return;

    // Update sidebar user display if it exists
    const userEl = document.getElementById('sidebar-user-name');
    if (userEl) userEl.textContent = user.name;

    const emailEl = document.getElementById('sidebar-user-email');
    if (emailEl) emailEl.textContent = user.email;
  }

  return {
    getToken,
    getRefreshToken,
    getUser,
    isLoggedIn,
    login,
    register,
    logout,
    refreshAccessToken,
    validateToken,
    showLoginScreen,
    hideLoginScreen,
    updateUserDisplay,
  };
})();
