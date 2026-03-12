/* ═══════════════════════════════════════════════════════════════════════════
   BAKAL — Supabase Client
   Thin wrapper over Supabase REST API (PostgREST).
   No SDK dependency — uses plain fetch against the auto-generated REST API.
   ═══════════════════════════════════════════════════════════════════════════ */

const BakalSupabase = (() => {
  /* ─── Configuration ─── */
  const CONFIG_KEY = 'bakal_supabase_config';

  // Default config — override via settings or localStorage
  let _url = '';   // e.g. https://<project>.supabase.co
  let _anonKey = '';
  let _ready = false;

  function loadConfig() {
    // 1. Check window-level config (set by hosting env or inline script)
    if (window.BAKAL_SUPABASE_URL && window.BAKAL_SUPABASE_ANON_KEY) {
      _url = window.BAKAL_SUPABASE_URL.replace(/\/$/, '');
      _anonKey = window.BAKAL_SUPABASE_ANON_KEY;
      _ready = true;
      return;
    }

    // 2. Check localStorage
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      if (saved.url && saved.anonKey) {
        _url = saved.url.replace(/\/$/, '');
        _anonKey = saved.anonKey;
        _ready = true;
      }
    } catch { /* ignore */ }
  }

  function configure(url, anonKey) {
    _url = (url || '').replace(/\/$/, '');
    _anonKey = anonKey || '';
    _ready = !!(_url && _anonKey);
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: _url, anonKey: _anonKey }));
  }

  function isReady() {
    if (!_ready) loadConfig();
    return _ready;
  }

  /* ─── Auth token ─── */

  function getAccessToken() {
    // Supabase stores the session in localStorage
    try {
      const sessionKey = `sb-${new URL(_url).hostname.split('.')[0]}-auth-token`;
      const session = JSON.parse(localStorage.getItem(sessionKey));
      return session?.access_token || null;
    } catch {
      // Fallback: use our own stored token
      return localStorage.getItem('bakal_supabase_access_token') || _anonKey;
    }
  }

  /* ─── Core REST request ─── */

  async function rest(table, { method = 'GET', query = '', body = null, headers = {}, single = false, count = false } = {}) {
    if (!isReady()) throw new Error('Supabase not configured');

    const url = `${_url}/rest/v1/${table}${query ? '?' + query : ''}`;
    const token = getAccessToken() || _anonKey;

    const reqHeaders = {
      'apikey': _anonKey,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    };

    // For single row response
    if (single) {
      reqHeaders['Accept'] = 'application/vnd.pgrst.object+json';
    }

    // For count
    if (count) {
      reqHeaders['Prefer'] = 'count=exact';
    }

    // For upsert/insert
    if (method === 'POST') {
      reqHeaders['Prefer'] = reqHeaders['Prefer']
        ? reqHeaders['Prefer'] + ', return=representation'
        : 'return=representation';
    }
    if (method === 'PATCH' || method === 'PUT') {
      reqHeaders['Prefer'] = 'return=representation';
    }

    const res = await fetch(url, {
      method,
      headers: reqHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      throw Object.assign(new Error(err.message || err.details || `HTTP ${res.status}`), {
        status: res.status,
        code: err.code,
      });
    }

    if (res.status === 204) return null;
    return res.json();
  }

  /* ─── Supabase Auth (GoTrue) ─── */

  async function authRequest(endpoint, body) {
    if (!isReady()) throw new Error('Supabase not configured');

    const res = await fetch(`${_url}/auth/v1/${endpoint}`, {
      method: 'POST',
      headers: {
        'apikey': _anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'Auth error');
    return data;
  }

  async function signUp(email, password, metadata = {}) {
    const data = await authRequest('signup', {
      email,
      password,
      data: metadata,
    });
    if (data.access_token) {
      storeSession(data);
    }
    return data;
  }

  async function signIn(email, password) {
    const data = await authRequest('token?grant_type=password', { email, password });
    if (data.access_token) {
      storeSession(data);
    }
    return data;
  }

  async function signOut() {
    const token = getAccessToken();
    if (token && token !== _anonKey) {
      try {
        await fetch(`${_url}/auth/v1/logout`, {
          method: 'POST',
          headers: {
            'apikey': _anonKey,
            'Authorization': `Bearer ${token}`,
          },
        });
      } catch { /* best effort */ }
    }
    clearSession();
  }

  async function refreshSession() {
    const rt = localStorage.getItem('bakal_supabase_refresh_token');
    if (!rt) return null;

    try {
      const data = await authRequest('token?grant_type=refresh_token', { refresh_token: rt });
      if (data.access_token) {
        storeSession(data);
        return data.access_token;
      }
    } catch {
      clearSession();
    }
    return null;
  }

  async function getUser() {
    const token = getAccessToken();
    if (!token || token === _anonKey) return null;

    try {
      const res = await fetch(`${_url}/auth/v1/user`, {
        headers: {
          'apikey': _anonKey,
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  function storeSession(data) {
    localStorage.setItem('bakal_supabase_access_token', data.access_token);
    if (data.refresh_token) {
      localStorage.setItem('bakal_supabase_refresh_token', data.refresh_token);
    }
    if (data.user) {
      localStorage.setItem('bakal_user', JSON.stringify({
        id: data.user.id,
        name: data.user.user_metadata?.name || data.user.email?.split('@')[0] || '',
        email: data.user.email,
        role: data.user.role || 'authenticated',
      }));
    }
  }

  function clearSession() {
    localStorage.removeItem('bakal_supabase_access_token');
    localStorage.removeItem('bakal_supabase_refresh_token');
  }

  function hasSession() {
    return !!localStorage.getItem('bakal_supabase_access_token');
  }

  /* ─── Convenience query builders ─── */

  function select(table, columns = '*', filters = {}) {
    const params = [`select=${columns}`];
    for (const [col, val] of Object.entries(filters)) {
      if (val === null || val === undefined) continue;
      if (typeof val === 'object' && val.op) {
        params.push(`${col}=${val.op}.${val.value}`);
      } else {
        params.push(`${col}=eq.${val}`);
      }
    }
    return rest(table, { query: params.join('&') });
  }

  function selectOne(table, columns = '*', filters = {}) {
    const params = [`select=${columns}`];
    for (const [col, val] of Object.entries(filters)) {
      if (val === null || val === undefined) continue;
      params.push(`${col}=eq.${val}`);
    }
    return rest(table, { query: params.join('&'), single: true });
  }

  function insert(table, data) {
    return rest(table, { method: 'POST', body: data });
  }

  function update(table, data, filters = {}) {
    const params = [];
    for (const [col, val] of Object.entries(filters)) {
      params.push(`${col}=eq.${val}`);
    }
    return rest(table, { method: 'PATCH', query: params.join('&'), body: data });
  }

  function remove(table, filters = {}) {
    const params = [];
    for (const [col, val] of Object.entries(filters)) {
      params.push(`${col}=eq.${val}`);
    }
    return rest(table, { method: 'DELETE', query: params.join('&') });
  }

  /* ─── RPC (stored procedures) ─── */

  async function rpc(fnName, params = {}) {
    if (!isReady()) throw new Error('Supabase not configured');

    const res = await fetch(`${_url}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: {
        'apikey': _anonKey,
        'Authorization': `Bearer ${getAccessToken() || _anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `RPC ${fnName} failed`);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  /* ─── Health check ─── */

  async function checkHealth() {
    if (!isReady()) return false;
    try {
      const res = await fetch(`${_url}/rest/v1/`, {
        headers: { 'apikey': _anonKey },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /* ─── Init ─── */
  loadConfig();

  return {
    // Config
    configure,
    isReady,
    get url() { return _url; },

    // Auth
    signUp,
    signIn,
    signOut,
    refreshSession,
    getUser,
    hasSession,

    // Data (PostgREST)
    rest,
    select,
    selectOne,
    insert,
    update,
    remove,
    rpc,

    // Health
    checkHealth,
  };
})();
