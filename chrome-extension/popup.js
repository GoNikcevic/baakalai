// ⚠️ EXTENSION PARQUÉE — ne pas publier. Voir README.md pour la décision et
// ses raisons. En particulier : getLinkedInCookie() plus bas capture le cookie
// de session `li_at`, ce qui donne un accès complet et permanent au compte
// LinkedIn de l'utilisateur. Interdit par les CGU LinkedIn, et le compte banni
// serait celui du client. Ne pas réactiver sans avoir tranché ce point.

const API_BASE = 'https://app.baakal.ai/api';
const STORAGE_KEY = 'baakalai_token';
const REFRESH_KEY = 'baakalai_refresh';

const content = document.getElementById('content');

// ── Init ──

async function init() {
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

// ── Auto-detect token from any open app.baakal.ai tab ──

async function detectFromBaakalaiTab() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://app.baakal.ai/*' });
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

// ── Token storage ──

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
    chrome.storage.local.remove([STORAGE_KEY, REFRESH_KEY], resolve);
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
      <div class="label">Connect to Baakalai</div>
      <div class="detail">Log in or auto-detect from an open Baakalai tab.</div>
    </div>
    <button class="btn btn-primary" id="auto-detect" style="margin-bottom:8px;">
      🔍 Auto-detect from Baakalai
    </button>
    <div style="text-align:center;margin:6px 0;">
      <span style="font-size:11px;color:#737373;">or log in manually</span>
    </div>
    <input id="email" type="email" placeholder="Email" autocomplete="email"
      style="width:100%;padding:8px 12px;border:1px solid #E5E5E3;border-radius:8px;font-size:12px;margin-bottom:8px;">
    <input id="password" type="password" placeholder="Password" autocomplete="current-password"
      style="width:100%;padding:8px 12px;border:1px solid #E5E5E3;border-radius:8px;font-size:12px;margin-bottom:8px;">
    <button class="btn" id="login-btn" style="width:100%;background:#fff;border:1px solid #E5E5E3;color:#0A0A0A;">Log in</button>
    <div style="text-align:center;margin-top:8px;">
      <a href="https://app.baakal.ai" target="_blank" style="font-size:11px;color:#6E57FA;text-decoration:none;">
        Open Baakalai first if not logged in →
      </a>
    </div>
    <div id="msg"></div>
  `;

  document.getElementById('auto-detect').onclick = async () => {
    const btn = document.getElementById('auto-detect');
    btn.disabled = true; btn.textContent = 'Detecting...';
    const found = await detectFromBaakalaiTab();
    if (found) {
      showMsg('success', 'Connected!');
      setTimeout(init, 600);
    } else {
      showMsg('error', 'No Baakalai tab found. Open app.baakal.ai and log in first.');
      btn.disabled = false; btn.textContent = '🔍 Auto-detect from Baakalai';
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
  btn.disabled = true; btn.textContent = 'Logging in...';

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    await saveTokens(data.token, data.refreshToken);
    showMsg('success', 'Logged in!');
    setTimeout(init, 600);
  } catch (err) {
    showMsg('error', err.message);
    btn.disabled = false; btn.textContent = 'Log in';
  }
}

function showNoLinkedIn() {
  content.innerHTML = `
    <div class="status connected" style="border-color:var(--border);">
      <div class="label">✅ Baakalai connected</div>
      <div class="detail">LinkedIn not detected — log in to linkedin.com first.</div>
    </div>
    <a href="https://www.linkedin.com/login" target="_blank" class="btn btn-primary" style="display:block;text-align:center;text-decoration:none;color:#fff;">
      Open LinkedIn
    </a>
    <button class="btn btn-danger" id="logout-ext">Log out</button>
  `;
  document.getElementById('logout-ext').onclick = async () => { await clearTokens(); init(); };
}

function showReadyToConnect(cookie) {
  const preview = cookie.slice(0, 12) + '...' + cookie.slice(-6);
  content.innerHTML = `
    <div class="status disconnected">
      <div class="label">LinkedIn session found</div>
      <div class="detail">Cookie: ${preview}</div>
    </div>
    <button class="btn btn-primary" id="connect-btn">Connect LinkedIn to Baakalai</button>
    <div id="msg"></div>
  `;
  document.getElementById('connect-btn').onclick = () => sendCookie(cookie);
}

function showConnected(name, counts, cookie) {
  content.innerHTML = `
    <div class="status connected">
      <div class="label">LinkedIn connected</div>
      <div class="detail">${name || 'Connected'}</div>
      ${counts ? `<div class="detail" style="margin-top:4px;">
        Today: ${counts.connections || 0}/30 · ${counts.views || 0}/50 · ${counts.messages || 0}/20
      </div>` : ''}
    </div>
    <button class="btn btn-primary" id="refresh-btn">Refresh cookie</button>
    <button class="btn btn-danger" id="disconnect-btn">Disconnect LinkedIn</button>
    <button class="btn" id="logout-ext" style="width:100%;margin-top:4px;background:transparent;color:#737373;border:1px solid #E5E5E3;font-size:11px;">
      Log out of Baakalai
    </button>
    <div id="msg"></div>
  `;
  document.getElementById('refresh-btn').onclick = async () => {
    const newCookie = await getLinkedInCookie();
    if (newCookie) sendCookie(newCookie);
    else showMsg('error', 'No LinkedIn cookie found.');
  };
  document.getElementById('disconnect-btn').onclick = () => disconnectLinkedIn();
  document.getElementById('logout-ext').onclick = async () => { await clearTokens(); init(); };
}

// ── Actions ──

async function sendCookie(cookie) {
  const btn = document.getElementById('connect-btn') || document.getElementById('refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting...'; }

  try {
    const token = await getToken();
    const res = await fetch(`${API_BASE}/settings/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ keys: { linkedinKey: cookie } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showMsg('success', 'LinkedIn connected!');
    setTimeout(init, 1500);
  } catch (err) {
    showMsg('error', `Failed: ${err.message}`);
    if (btn) { btn.disabled = false; btn.textContent = 'Try again'; }
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
    // « Disconnected » : l'utilisateur croyait son cookie de session LinkedIn
    // supprimé alors qu'il restait en base. C'est le chemin où un faux positif
    // coûte le plus cher.
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    showMsg('success', 'Disconnected.');
    setTimeout(init, 1500);
  } catch (err) { showMsg('error', `Disconnect failed: ${err.message}`); }
}

function showMsg(type, text) {
  const el = document.getElementById('msg');
  if (el) el.innerHTML = `<div class="${type}">${text}</div>`;
}

init();
