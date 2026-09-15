// baakalai — LinkedIn Connect.
// Une seule mission : relier la session LinkedIn de l'utilisateur à son compte
// baakalai en un clic (le cookie li_at n'est lisible que par une extension —
// il est httpOnly, aucun bookmarklet ne peut le faire). L'envoi initial est
// TOUJOURS un geste explicite de l'utilisateur ; ensuite background.js
// maintient la connexion à jour automatiquement.
// Décision de périmètre : voir README.md (pas de scraping, pas d'overlay).

const STORAGE_KEY = 'baakalai_token';
const REFRESH_KEY = 'baakalai_refresh';
const LAST_SYNCED_KEY = 'baakalai_liat_last_synced';
const DEFAULT_API_BASE = 'https://app.baakal.ai/api';

let API_BASE = DEFAULT_API_BASE;

const content = document.getElementById('content');

// ── Init ──

async function init() {
  // Base API surchargée en test (staging) via chrome.storage 'baakalai_api'.
  API_BASE = (await storageGet('baakalai_api')).baakalai_api || DEFAULT_API_BASE;

  const token = await getToken();
  if (!token) {
    // Try auto-detect from open Baakalai tab first
    const detected = await detectFromBaakalaiTab();
    if (detected) { init(); return; }
    showLoginForm();
    return;
  }

  // Verify token
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const refreshed = await tryRefreshToken();
      if (!refreshed) {
        await clearTokens();
        showLoginForm();
        return;
      }
    }
  } catch { /* offline — assume valid */ }

  // LinkedIn check
  const cookie = await getLinkedInCookie();
  try {
    const res = await fetch(`${API_BASE}/signals/linkedin/status`, {
      headers: { Authorization: `Bearer ${await getToken()}` },
    });
    const data = await res.json();
    if (data.connected) showConnected(data.name, data.counts, cookie);
    else if (cookie) showReadyToConnect(cookie);
    else showNoLinkedIn();
  } catch {
    if (cookie) showReadyToConnect(cookie);
    else showNoLinkedIn();
  }
}

// ── Auto-detect token from any open baakalai tab (prod ou staging) ──
// C'est LE chemin de connexion pour les comptes Google OAuth : pas de mot de
// passe à taper, l'extension emprunte la session de l'app ouverte. La base
// API suit l'origine de l'onglet détecté — détecter depuis staging branche
// automatiquement l'extension sur staging.

const APP_URLS = ['https://app.baakal.ai/*', 'https://baakal-staging.up.railway.app/*'];

async function detectFromBaakalaiTab() {
  try {
    const tabs = await chrome.tabs.query({ url: APP_URLS });
    for (const tab of tabs) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            token: localStorage.getItem('bakal_token'),
            refresh: localStorage.getItem('bakal_refresh_token'),
          }),
        });
        const data = results?.[0]?.result;
        if (data?.token) {
          await saveTokens(data.token, data.refresh);
          API_BASE = `${new URL(tab.url).origin}/api`;
          await new Promise((resolve) => chrome.storage.local.set({ baakalai_api: API_BASE }, resolve));
          return true;
        }
      } catch { /* tab not accessible */ }
    }
  } catch { /* no tabs permission or no tabs */ }
  return false;
}

// ── LinkedIn cookie ──

function getLinkedInCookie() {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'li_at' }, (cookie) => {
      resolve(cookie?.value || null);
    });
  });
}

// ── Storage helpers ──

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function getToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (data) => resolve(data[STORAGE_KEY] || null));
  });
}
function getRefreshToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(REFRESH_KEY, (data) => resolve(data[REFRESH_KEY] || null));
  });
}
function saveTokens(token, refreshToken) {
  return new Promise((resolve) => {
    const data = { [STORAGE_KEY]: token };
    if (refreshToken) data[REFRESH_KEY] = refreshToken;
    chrome.storage.local.set(data, resolve);
  });
}
function clearTokens() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEY, REFRESH_KEY, LAST_SYNCED_KEY], resolve);
  });
}

async function tryRefreshToken() {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    await saveTokens(data.token, data.refreshToken);
    return true;
  } catch { return false; }
}

// ── Views ──

function showLoginForm() {
  content.innerHTML = `
    <div class="status disconnected">
      <div class="label">Connexion à baakalai</div>
      <div class="detail">Ouvrez baakalai dans un onglet et connectez-vous (Google inclus), puis cliquez sur Détecter : l'extension reprend votre session.</div>
    </div>
    <button class="btn btn-primary" id="auto-detect" style="margin-bottom:8px;">
      Détecter depuis baakalai
    </button>
    <div style="text-align:center;margin:6px 0;">
      <span style="font-size:11px;color:#737373;">ou connexion par email + mot de passe</span>
    </div>
    <input id="email" type="email" placeholder="Email" autocomplete="email"
      style="width:100%;padding:8px 12px;border:1px solid #E5E5E3;border-radius:8px;font-size:12px;margin-bottom:8px;">
    <input id="password" type="password" placeholder="Mot de passe" autocomplete="current-password"
      style="width:100%;padding:8px 12px;border:1px solid #E5E5E3;border-radius:8px;font-size:12px;margin-bottom:8px;">
    <button class="btn" id="login-btn" style="width:100%;background:#fff;border:1px solid #E5E5E3;color:#0A0A0A;">Se connecter</button>
    <div style="text-align:center;margin-top:8px;">
      <a href="https://app.baakal.ai" target="_blank" style="font-size:11px;color:#6E57FA;text-decoration:none;">
        Ouvrir baakalai d'abord si besoin →
      </a>
    </div>
    <div id="msg"></div>
  `;

  document.getElementById('auto-detect').onclick = async () => {
    const btn = document.getElementById('auto-detect');
    btn.disabled = true; btn.textContent = 'Détection...';
    const found = await detectFromBaakalaiTab();
    if (found) {
      showMsg('success', 'Connecté !');
      setTimeout(init, 600);
    } else {
      showMsg('error', 'Aucun onglet baakalai trouvé. Ouvrez app.baakal.ai et connectez-vous d\'abord.');
      btn.disabled = false; btn.textContent = 'Détecter depuis baakalai';
    }
  };

  document.getElementById('login-btn').onclick = handleLogin;
  document.getElementById('password').onkeydown = (e) => { if (e.key === 'Enter') handleLogin(); };
}

async function handleLogin() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) return;

  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = 'Connexion...';

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Échec de connexion');

    await saveTokens(data.token, data.refreshToken);
    showMsg('success', 'Connecté !');
    setTimeout(init, 600);
  } catch (err) {
    showMsg('error', err.message);
    btn.disabled = false; btn.textContent = 'Se connecter';
  }
}

function showNoLinkedIn() {
  content.innerHTML = `
    <div class="status connected" style="border-color:var(--border);">
      <div class="label">✅ baakalai connecté</div>
      <div class="detail">Session LinkedIn introuvable. Connectez-vous à linkedin.com puis rouvrez ce popup.</div>
    </div>
    <a href="https://www.linkedin.com/login" target="_blank" class="btn btn-primary" style="display:block;text-align:center;text-decoration:none;color:#fff;">
      Ouvrir LinkedIn
    </a>
    <button class="btn btn-danger" id="logout-ext">Se déconnecter</button>
  `;
  document.getElementById('logout-ext').onclick = async () => { await clearTokens(); init(); };
}

function showReadyToConnect(cookie) {
  const preview = cookie.slice(0, 12) + '...' + cookie.slice(-6);
  content.innerHTML = `
    <div class="status disconnected">
      <div class="label">Session LinkedIn détectée</div>
      <div class="detail">Cookie : ${preview}</div>
    </div>
    <button class="btn btn-primary" id="connect-btn">Connecter LinkedIn à baakalai</button>
    <div style="font-size:11px;color:#737373;margin-top:8px;text-align:center;">
      Ensuite la connexion se maintient toute seule, même quand la session change.
    </div>
    <div id="msg"></div>
  `;
  document.getElementById('connect-btn').onclick = () => sendCookie(cookie);
}

function showConnected(name, counts, cookie) {
  content.innerHTML = `
    <div class="status connected">
      <div class="label">LinkedIn connecté</div>
      <div class="detail">${name || 'Connecté'} · maintenu à jour automatiquement</div>
      ${counts ? `<div class="detail" style="margin-top:4px;">
        Aujourd'hui : ${counts.connections || 0}/30 invitations · ${counts.views || 0}/50 visites · ${counts.messages || 0}/20 messages
      </div>` : ''}
    </div>
    <button class="btn btn-primary" id="refresh-btn">Resynchroniser maintenant</button>
    <button class="btn btn-danger" id="disconnect-btn">Déconnecter LinkedIn</button>
    <button class="btn" id="logout-ext" style="width:100%;margin-top:4px;background:transparent;color:#737373;border:1px solid #E5E5E3;font-size:11px;">
      Se déconnecter de baakalai
    </button>
    <div id="msg"></div>
  `;
  document.getElementById('refresh-btn').onclick = async () => {
    const newCookie = await getLinkedInCookie();
    if (newCookie) sendCookie(newCookie);
    else showMsg('error', 'Aucune session LinkedIn trouvée.');
  };
  document.getElementById('disconnect-btn').onclick = () => disconnectLinkedIn();
  document.getElementById('logout-ext').onclick = async () => { await clearTokens(); init(); };
}

// ── Actions ──

async function sendCookie(cookie) {
  const btn = document.getElementById('connect-btn') || document.getElementById('refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Connexion...'; }

  try {
    const token = await getToken();
    const res = await fetch(`${API_BASE}/settings/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ keys: { linkedinKey: cookie } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Le resync automatique (background.js) ne démarre qu'après ce premier
    // partage explicite — c'est lui qu'on enregistre ici comme référence.
    chrome.runtime.sendMessage({ type: 'liat-synced', cookie });
    showMsg('success', 'LinkedIn connecté !');
    setTimeout(init, 1500);
  } catch (err) {
    showMsg('error', `Échec : ${err.message}`);
    if (btn) { btn.disabled = false; btn.textContent = 'Réessayer'; }
  }
}

async function disconnectLinkedIn() {
  try {
    const token = await getToken();
    const res = await fetch(`${API_BASE}/settings/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ keys: { linkedinKey: '' } }),
    });
    // Sans cette vérification, un refus du serveur affichait quand même
    // « Déconnecté » : l'utilisateur croyait son cookie de session LinkedIn
    // supprimé alors qu'il restait en base. C'est le chemin où un faux positif
    // coûte le plus cher.
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    // Stoppe aussi le resync automatique (la référence disparaît).
    chrome.storage.local.remove(LAST_SYNCED_KEY);
    showMsg('success', 'Déconnecté.');
    setTimeout(init, 1500);
  } catch (err) { showMsg('error', `Échec de la déconnexion : ${err.message}`); }
}

function showMsg(type, text) {
  const el = document.getElementById('msg');
  if (el) el.innerHTML = `<div class="${type}">${text}</div>`;
}

init();
