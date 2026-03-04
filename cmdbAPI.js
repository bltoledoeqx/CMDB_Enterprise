/**
 * cmdbAPI shim — substitui o window.cmdbAPI do Electron por fetch()
 * RDP e SSH são delegados ao agente local em localhost:27420
 */

const AGENT = 'http://localhost:27420';

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    return { ok: false, ...err };
  }
  return r.json();
}

async function agentCall(path, body) {
  try {
    const r = await fetch(AGENT + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  } catch (e) {
    return {
      ok: false,
      error: 'Agente local não encontrado em localhost:27420. Instale o CMDB Agent neste computador.',
    };
  }
}

window.cmdbAPI = {
  // ── Config ──────────────────────────────────────────────
  getConfig: () => api('GET', '/api/config'),
  setConfig: (cfg) => api('POST', '/api/config', cfg),

  // ── Auth ────────────────────────────────────────────────
  login:          (creds)  => api('POST', '/api/auth/login', creds),
  logout:         ()       => api('POST', '/api/auth/logout'),
  register:       (d)      => api('POST', '/api/auth/register', d),
  changePassword: (d)      => api('POST', '/api/auth/change-password', d),
  resetPassword:  (d)      => api('POST', `/api/users/${d.username}/reset-password`, { newPassword: d.newPassword }),
  listUsers:      ()       => api('GET',  '/api/users').then(r => Array.isArray(r) ? r : []),
  deleteUser:     (u)      => api('DELETE', `/api/users/${u}`),

  // ── Data ────────────────────────────────────────────────
  load: ()    => api('GET',  '/api/db/load'),
  save: (db)  => api('POST', '/api/db/save', db),
  getPath: () => api('GET',  '/api/db/path').then(r => r.path || '—'),

  // ── Export / Import (browser-side) ──────────────────────
  export: async (db) => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `cmdb_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  },
  import: () => new Promise(resolve => {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = '.json';
    input.onchange = async () => {
      try {
        const text = await input.files[0].text();
        const p    = JSON.parse(text);
        if (p.data && Array.isArray(p.data)) {
          resolve({
            data:     p.data,
            tags:     Array.isArray(p.tags)     ? p.tags     : [],
            snippets: Array.isArray(p.snippets) ? p.snippets : [],
            snipPkgs: Array.isArray(p.snipPkgs) ? p.snipPkgs : [],
            notes:    p.notes || { folders:[], notes:[] },
          });
        } else resolve(null);
      } catch { resolve(null); }
    };
    input.click();
  }),

  // ── Shell ───────────────────────────────────────────────
  openURL: (url) => { window.open(url, '_blank'); return true; },

  // ── RDP → Agente local ──────────────────────────────────
  rdpOpen: (opts) => {
    const r = agentCall('/rdp', opts);
    r.then(res => {
      if (!res.ok) {
        // Mostra erro amigável se agente não estiver instalado
        const msg = document.createElement('div');
        msg.style.cssText = `
          position:fixed;bottom:20px;right:20px;z-index:9999;
          background:#ef4444;color:white;padding:14px 18px;
          border-radius:8px;max-width:320px;font-size:13px;
          box-shadow:0 8px 24px rgba(0,0,0,.4)
        `;
        msg.innerHTML = `<b>Agente local necessário</b><br>${res.error}<br>
          <a href="/agent/CMDB-Agent-Setup.bat" download style="color:white;text-decoration:underline">
            Baixar instalador
          </a>`;
        document.body.appendChild(msg);
        setTimeout(() => msg.remove(), 8000);
      }
    });
    return r;
  },

  // ── SSH → Agente local ──────────────────────────────────
  sshPtyStart: (opts) => {
    const r = agentCall('/ssh', opts);
    r.then(res => {
      if (!res.ok) {
        const msg = document.createElement('div');
        msg.style.cssText = `
          position:fixed;bottom:20px;right:20px;z-index:9999;
          background:#ef4444;color:white;padding:14px 18px;
          border-radius:8px;max-width:320px;font-size:13px;
          box-shadow:0 8px 24px rgba(0,0,0,.4)
        `;
        msg.innerHTML = `<b>Agente local necessário</b><br>${res.error}<br>
          <a href="/agent/CMDB-Agent-Setup.bat" download style="color:white;text-decoration:underline">
            Baixar instalador
          </a>`;
        document.body.appendChild(msg);
        setTimeout(() => msg.remove(), 8000);
      }
    });
    return r;
  },
  sshPtyKill:  () => Promise.resolve(true),
  onPtyClose:  () => {},
  offPtyClose: () => {},
  offPtyData:  () => {},
};
