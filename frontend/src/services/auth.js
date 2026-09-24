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

/**
 * La session est morte pour de bon : on vide le stockage ET on prévient l'app.
 * App.jsx ne relit isLoggedIn() qu'au montage ; sans ce signal, l'interface
 * restait affichée après un clearSession() et chaque appel retombait dans son
 * `.catch()`, ce qui se voyait comme des listes vides et un CRM « déconnecté »
 * au lieu d'un retour au login.
 *
 * À n'appeler que sur un vrai échec d'authentification, jamais sur une panne
 * passagère (429, 5xx, réseau) : sinon un redéploiement déloge tout le monde.
 */
export function expireSession() {
  const wasLoggedIn = !!getToken();
  clearSession();
  if (wasLoggedIn && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bakal:session-expired'));
  }
}

export function isLoggedIn() {
  return !!getToken();
}

export async function login(email, password, rememberMe = true) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, rememberMe }),
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
        // Seul un refus d'authentification signifie que la session est morte.
        // Un 429 (rate limit), un 502 pendant un redéploiement Railway ou un
        // 5xx sont passagers : on renvoie null sans rien effacer, l'appel
        // suivant réessaiera avec le refresh token toujours en place.
        if (res.status === 401 || res.status === 403) expireSession();
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
  // Revoke refresh token on the server (best-effort).
  // Le serveur ne révoque plus que la session présentée : on lui donne de quoi
  // l'identifier, sinon il retombe sur une révocation globale qui tuerait les
  // autres appareils.
  const rt = getRefreshToken();
  try {
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      credentials: 'include', // sends httpOnly cookie for server-side cleanup
      body: JSON.stringify(rt ? { refreshToken: rt } : {}),
    };
    const res = await fetch('/api/auth/logout', opts);
    // La session locale part de toute façon, mais un refus ici veut dire que le
    // refresh token reste vivant côté serveur : ça ne doit pas passer en silence.
    if (!res.ok) console.warn('[auth] révocation serveur refusée:', res.status);
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
    // Backend en vrac (5xx, proxy Railway en cours de redéploiement) : on ne
    // touche pas à la session, elle est probablement intacte.
    if (res.status !== 401) return false;

    // Token expiré : on tente le refresh. refreshAccessToken() se charge
    // lui-même d'expirer la session si le refus est authentifié ; ici un null
    // peut aussi venir d'une panne passagère, auquel cas on ne détruit rien.
    const newToken = await refreshAccessToken();
    if (!newToken) return false;

    // Re-validate with new token
    const res2 = await fetch('/api/auth/me', {
      headers: { Authorization: 'Bearer ' + newToken },
    });
    if (!res2.ok) {
      // Refusé avec un token tout juste émis : la session n'est plus valable.
      if (res2.status === 401 || res2.status === 403) expireSession();
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
