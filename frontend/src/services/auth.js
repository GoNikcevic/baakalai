/* ===============================================================================
   BAKAL — Authentication Service (ES Module)
   Pure logic functions for login, register, token storage, refresh, and auth state.
   Ported from /app/auth.js — no DOM manipulation.
   =============================================================================== */

const TOKEN_KEY = 'bakal_token';
const REFRESH_KEY = 'bakal_refresh_token';
const USER_KEY = 'bakal_user';

// Deduplication guard for concurrent refresh calls
let _refreshPromise = null;

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

export function setSession(token, refreshToken, user) {
  localStorage.setItem(TOKEN_KEY, token);
  // Refresh token is now stored in httpOnly cookie by the backend.
  // Keep localStorage fallback for Chrome extension compatibility.
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem('bakal_onboarding_complete');
  localStorage.removeItem('bakal_checklist_dismissed');
  localStorage.removeItem('bakal_profile');
}

export function isLoggedIn() {
  return !!getToken();
}

export async function login(email, password) {
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
    // Sync onboarding flag from server
    if (data.user.onboarding_complete) {
      localStorage.setItem('bakal_onboarding_complete', 'true');
    } else {
      localStorage.removeItem('bakal_onboarding_complete');
    }
    return data.user;
  } catch (err) {
    throw err;
  }
}

export async function register(name, email, password, company) {
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
    // NOTE: on ne stocke pas la session ici — l'utilisateur doit
    // d'abord confirmer son email via le lien reçu, puis se connecter.
    return { email: data.user.email, name: data.user.name };
  } catch (err) {
    throw err;
  }
}

export async function resendVerification(email) {
  const res = await fetch('/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur réseau');
  return data;
}

/**
 * Refresh the access token using the stored refresh token.
 * Deduplicates concurrent calls. Returns the new token, or null on failure.
 */
export async function refreshAccessToken() {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    const rt = getRefreshToken();

    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // sends httpOnly cookie
        body: JSON.stringify(rt ? { refreshToken: rt } : {}),
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

export async function deleteAccount(password) {
  const token = getToken();
  const res = await fetch('/api/auth/account', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to delete account');
  clearSession();
  return data;
}

export async function logout() {
  // Revoke refresh token on the server (best-effort)
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      credentials: 'include', // sends httpOnly cookie for server-side cleanup
    });
  } catch { /* ignore */ }
  clearSession();
}

export async function validateToken() {
  const token = getToken();
  if (!token) return false;
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      // Sync onboarding flag from server (authoritative source)
      if (data.user.onboarding_complete) {
        localStorage.setItem('bakal_onboarding_complete', 'true');
      } else {
        localStorage.removeItem('bakal_onboarding_complete');
      }
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
    if (data2.user.onboarding_complete) {
      localStorage.setItem('bakal_onboarding_complete', 'true');
    } else {
      localStorage.removeItem('bakal_onboarding_complete');
    }
    return true;
  } catch {
    return false;
  }
}
