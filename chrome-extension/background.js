/**
 * baakalai : LinkedIn Connect : resync automatique du cookie li_at.
 *
 * Le point de douleur n'est pas seulement la première connexion (le popup la
 * règle en un clic) : c'est l'EXPIRATION. Un cookie li_at meurt au bout de
 * quelques semaines et toutes les étapes LinkedIn des workflows s'arrêtent en
 * silence. Ce worker maintient la connexion :
 *  - à chaque changement du cookie li_at (reconnexion LinkedIn, rotation),
 *  - et par une alarme de rattrapage toutes les 12 h,
 * le cookie courant est renvoyé au backend s'il diffère du dernier envoyé.
 *
 * Ne fait rien tant que l'utilisateur ne s'est pas connecté à baakalai dans le
 * popup (pas de token → pas d'envoi) ni tant qu'il n'a pas connecté LinkedIn
 * une première fois lui-même (lastSynced vide → on n'envoie jamais un cookie
 * que l'utilisateur n'a pas explicitement partagé).
 */

const STORAGE_KEY = 'baakalai_token';
const REFRESH_KEY = 'baakalai_refresh';
const LAST_SYNCED_KEY = 'baakalai_liat_last_synced';
const DEFAULT_API_BASE = 'https://app.baakal.ai/api';

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

async function apiBase() {
  const data = await storageGet('baakalai_api');
  return data.baakalai_api || DEFAULT_API_BASE;
}

function getLinkedInCookie() {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'li_at' }, (cookie) => {
      resolve(cookie?.value || null);
    });
  });
}

async function tryRefreshToken() {
  const data = await storageGet(REFRESH_KEY);
  const refreshToken = data[REFRESH_KEY];
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${await apiBase()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    await storageSet({ [STORAGE_KEY]: body.token, [REFRESH_KEY]: body.refreshToken });
    return body.token;
  } catch { return null; }
}

async function pushCookie(cookie, token) {
  const res = await fetch(`${await apiBase()}/settings/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ keys: { linkedinKey: cookie } }),
  });
  return res.ok ? 'ok' : (res.status === 401 ? 'unauthorized' : 'failed');
}

async function resync() {
  const data = await storageGet([STORAGE_KEY, LAST_SYNCED_KEY]);
  const token = data[STORAGE_KEY];
  const lastSynced = data[LAST_SYNCED_KEY];
  if (!token || !lastSynced) return; // jamais connecté → pas d'envoi silencieux

  const cookie = await getLinkedInCookie();
  if (!cookie || cookie === lastSynced) return;

  let outcome = await pushCookie(cookie, token);
  if (outcome === 'unauthorized') {
    const fresh = await tryRefreshToken();
    if (fresh) outcome = await pushCookie(cookie, fresh);
  }
  if (outcome === 'ok') {
    await storageSet({ [LAST_SYNCED_KEY]: cookie });
  }
}

// Reconnexion LinkedIn ou rotation du cookie → resync immédiat.
chrome.cookies.onChanged.addListener((change) => {
  if (change.cookie?.name === 'li_at' && change.cookie?.domain?.includes('linkedin.com') && !change.removed) {
    resync();
  }
});

// Rattrapage périodique (navigateur rouvert, changement raté…).
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('liat-resync', { periodInMinutes: 720 });
});
chrome.runtime.onStartup.addListener(() => resync());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'liat-resync') resync();
});

// Le popup signale une connexion réussie → mémorise le cookie de référence.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'liat-synced' && msg.cookie) {
    storageSet({ [LAST_SYNCED_KEY]: msg.cookie });
  }
});
