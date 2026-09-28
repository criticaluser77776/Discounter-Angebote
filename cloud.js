'use strict';
/* Supabase-Anbindung ohne Zusatzbibliothek (nur fetch):
   - Zugang per Familien-Code (einmal je Gerät eingegeben, im Header x-family-code gesendet; Supabase prüft ihn
     per Row Level Security) und Name des Geräts für „von … hinzugefügt“
   - Lesen der Angebotsdaten (app_data, price_history) mit Offline-Kopie im Cache
   - Abgleich des Einkaufszettels (list_rows)
   Aktiv nur in der veröffentlichten Fassung (config.js: source 'supabase'). */

class LoginNeeded extends Error {
  constructor(msg = 'Bitte Familien-Code eingeben') { super(msg); this.name = 'LoginNeeded'; }
}

const Cloud = (() => {
  const cfg = window.APP_CONFIG || {};
  const url = (cfg.supabaseUrl || '').replace(/\/$/, '');
  const key = cfg.supabaseKey || '';
  const enabled = cfg.source === 'supabase' && !!url && !!key;
  const ACCESS = 'ap.sb.access';
  const CACHE = 'ap-cloud-v1';
  let access = null;  // { code, name }
  try { access = JSON.parse(localStorage.getItem(ACCESS)); } catch { /* kein Speicher */ }

  function setAccess(a) {
    access = a;
    try { a ? localStorage.setItem(ACCESS, JSON.stringify(a)) : localStorage.removeItem(ACCESS); } catch { /* egal */ }
  }

  async function rest(path, { method = 'GET', body, prefer, code } = {}) {
    const c = code ?? access?.code;
    if (!c) throw new LoginNeeded();
    const r = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: { apikey: key, 'x-family-code': c, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // falscher/geänderter Code: Schreiben wird abgewiesen (401/403)
    if (r.status === 401 || r.status === 403) { if (!code) setAccess(null); throw new LoginNeeded('Familien-Code ungültig oder geändert'); }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.message || `Serverfehler ${r.status}`);
    }
    return prefer?.includes('return=minimal') ? null : r.json();
  }

  // Große Datensätze (Angebote, Katalog): nur neu laden, wenn sich der Stand geändert hat; offline aus dem Cache
  async function cachedData(name) {
    const req = new Request(`https://cache.local/${name}`);
    let cache = null;
    try { cache = await caches.open(CACHE); } catch { /* kein Cache (z.B. privater Modus) */ }
    const cached = cache && await cache.match(req);
    try {
      const meta = await rest(`app_data?key=eq.${name}&select=updated_at`);
      if (!meta.length) {
        // Lesen liefert bei falschem Code einfach nichts -> Code prüfen
        if (!await rest('rpc/family_ok', { method: 'POST', body: {} })) { setAccess(null); throw new LoginNeeded('Familien-Code ungültig oder geändert'); }
        throw new Error('Noch keine Angebotsdaten hochgeladen – bitte am PC update.bat bzw. start.bat ausführen.');
      }
      if (cached && cached.headers.get('x-updated') === meta[0].updated_at) return cached.json();
      const rows = await rest(`app_data?key=eq.${name}&select=data,updated_at`);
      if (cache) await cache.put(req, new Response(JSON.stringify(rows[0].data), { headers: { 'x-updated': rows[0].updated_at } }));
      return rows[0].data;
    } catch (e) {
      if (cached && !(e instanceof LoginNeeded)) return cached.json();  // offline: letzter Stand
      throw e;
    }
  }

  return {
    enabled,
    loggedIn: () => !!access?.code,
    name: () => access?.name || '',
    // Code prüfen und merken; Ergebnis: ob er stimmt
    async login(code, name) {
      const ok = await rest('rpc/family_ok', { method: 'POST', body: {}, code: code.trim() });
      if (ok) setAccess({ code: code.trim(), name: name.trim() });
      return !!ok;
    },
    setName(name) { if (access) setAccess({ ...access, name: name.trim() }); },
    async logout() {
      setAccess(null);
      try { await caches.delete(CACHE); } catch { /* egal */ }
    },

    offers: () => cachedData('offers'),
    catalog: () => cachedData('catalog'),
    async status() {
      const rows = await rest('app_data?key=eq.status&select=data');
      return rows[0]?.data || {};
    },
    history: pk => rest(`price_history?product_key=eq.${encodeURIComponent(pk)}` +
      '&select=retailer,valid_from,price,unit_price,unit,app_price&order=valid_from.asc'),

    pullList: since => rest(`list_rows?select=kind,id,data,deleted,updated_at` +
      `&updated_at=gte.${encodeURIComponent(since)}&order=updated_at.asc&limit=1000`),
    pushList: rows => rest('list_rows?on_conflict=kind,id', {
      method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal',
    }),
  };
})();
