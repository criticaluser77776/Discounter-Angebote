'use strict';
/* Supabase-Anbindung ohne Zusatzbibliothek (nur fetch):
   - Zugang per Gruppen-Code (einmal je Gerät eingegeben, im Header x-family-code gesendet; Supabase prüft ihn
     per Row Level Security) und Name des Geräts für „von … hinzugefügt“
   - Gerätekennung (zufällig, Header x-device): Mitgliedschaft, Rolle (Admin) und letzter Besuch in der Gruppe
   - Neue Gruppe nur mit Einladungscode (create_group), Admin-Funktionen (Mitglieder, neuer Code)
   - Lesen der Angebotsdaten (app_data, price_history) mit Offline-Kopie im Cache
   - Abgleich des Einkaufszettels (list_rows)
   Aktiv nur in der veröffentlichten Fassung (config.js: source 'supabase'). */

class LoginNeeded extends Error {
  constructor(msg = 'Bitte Gruppen-Code eingeben') { super(msg); this.name = 'LoginNeeded'; }
}

const Cloud = (() => {
  const cfg = window.APP_CONFIG || {};
  const url = (cfg.supabaseUrl || '').replace(/\/$/, '');
  const key = cfg.supabaseKey || '';
  const enabled = cfg.source === 'supabase' && !!url && !!key;
  const ACCESS = 'ap.sb.access';
  const CACHE = 'ap-cloud-v1';
  const TOUCH_MS = 3600e3;  // letzten Besuch höchstens einmal pro Stunde melden
  let access = null;  // { code, name, gid, group, role, settings, touched }
  try { access = JSON.parse(localStorage.getItem(ACCESS)); } catch { /* kein Speicher */ }
  // Gerätekennung: bleibt auch nach dem Abmelden (ein entferntes Gerät bleibt so gesperrt)
  let device = '';
  try { device = localStorage.getItem('ap.sb.device') || ''; } catch { /* kein Speicher */ }
  if (!device) {
    device = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('ap.sb.device', device); } catch { /* egal */ }
  }

  function setAccess(a) {
    access = a;
    try { a ? localStorage.setItem(ACCESS, JSON.stringify(a)) : localStorage.removeItem(ACCESS); } catch { /* egal */ }
  }

  async function rest(path, { method = 'GET', body, prefer, code, noCode } = {}) {
    const c = code ?? access?.code;
    if (!c && !noCode) throw new LoginNeeded();
    const r = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: { apikey: key, 'x-family-code': c || '', 'x-device': device, 'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // falscher/geänderter Code: Schreiben wird abgewiesen (401/403)
    if (r.status === 401 || r.status === 403) {
      if (!code && !noCode) setAccess(null);
      throw new LoginNeeded('Kein Zugang mehr: Gruppen-Code geändert oder Gerät entfernt');
    }
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
        if (!await rest('rpc/family_ok', { method: 'POST', body: {} })) { setAccess(null); throw new LoginNeeded('Kein Zugang mehr: Gruppen-Code geändert oder Gerät entfernt'); }
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

  // Gerät in der Gruppe melden (Name, letzter Besuch); merkt Gruppe und Rolle
  async function touch(force = false) {
    if (!access?.code) return null;
    if (!force && access.gid && Date.now() - (access.touched || 0) < TOUCH_MS) return access;
    const r = await rest('rpc/touch', { method: 'POST', body: { p_name: access.name || '' } });
    setAccess({ ...access, gid: r.gid, group: r.group, role: r.role, settings: r.settings || {}, touched: Date.now() });
    return access;
  }

  // War dieses Gerät zuletzt in einer anderen Gruppe? (dann gehört der lokale Zettel nicht in die neue)
  function switchedGroup() {
    let last = '';
    try { last = localStorage.getItem('ap.sb.gid') || ''; localStorage.setItem('ap.sb.gid', access?.gid || ''); } catch { /* egal */ }
    return !!(last && access?.gid && last !== access.gid);
  }

  return {
    enabled,
    loggedIn: () => !!access?.code,
    name: () => access?.name || '',
    code: () => access?.code || '',
    group: () => access?.group || '',
    isAdmin: () => access?.role === 'admin',
    settings: () => access?.settings || {},  // Gebiet & Händler der Gruppe (vom Admin)
    touch,
    switchedGroup,
    // Code prüfen und merken; Ergebnis: ob er stimmt
    async login(code, name) {
      const ok = await rest('rpc/family_ok', { method: 'POST', body: {}, code: code.trim() });
      if (ok) { setAccess({ code: code.trim(), name: name.trim() }); await touch(true); }
      return !!ok;
    },
    // neue Gruppe mit Einladungscode; das Gerät wird Admin. Ergebnis: Zugangscode der neuen Gruppe
    async createGroup(invite, group, name) {
      const r = await rest('rpc/create_group', { method: 'POST', noCode: true,
        body: { p_invite: invite.trim(), p_group: group.trim(), p_name: name.trim() } });
      setAccess({ code: r.code, name: name.trim() });
      await touch(true);
      return r.code;
    },
    async setName(name) {
      if (!access) return;
      setAccess({ ...access, name: name.trim() });
      await touch(true).catch(() => {});
    },
    async logout() {
      setAccess(null);
      try { await caches.delete(CACHE); } catch { /* egal */ }
    },
    groupInfo: () => rest('rpc/group_info', { method: 'POST', body: {} }),
    // Einladungen für neue Gruppen (nur fest freigeschaltete Mitglieder, prüft der Server)
    createInvite: note => rest('rpc/app_create_invite', { method: 'POST', body: { p_note: note || null } }),
    listInvites: () => rest('rpc/app_list_invites', { method: 'POST', body: {} }),
    adminMember: (id, action, name) => rest('rpc/admin_member', { method: 'POST',
      body: { p_id: id, p_action: action, p_name: name ?? null }, prefer: 'return=minimal' }),
    async adminGroupName(name) {
      await rest('rpc/admin_group_name', { method: 'POST', body: { p_name: name }, prefer: 'return=minimal' });
      await touch(true);
    },
    async adminSettings(settings) {
      await rest('rpc/admin_group_settings', { method: 'POST', body: { p_settings: settings }, prefer: 'return=minimal' });
      await touch(true);
    },
    async adminNewCode() {
      const code = await rest('rpc/admin_new_code', { method: 'POST', body: {} });
      setAccess({ ...access, code });  // dieses Gerät bleibt angemeldet
      return code;
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
    pushList: rows => rest('list_rows?on_conflict=group_id,kind,id', {
      method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal',
    }),
  };
})();
