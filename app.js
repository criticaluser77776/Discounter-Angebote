'use strict';
/* Angebote Preisvergleich – PWA ohne Build-Schritt.
   Ansichten (Hash-Routen):
     #/                  Kategorien          #/c/<Kategorie>[/<Gruppe>]  Angebote einer Kategorie/Gruppe
     #/favs              Favoriten           #/add[/<Kategorie>[/<Gruppe>]]  Favoriten auswählen
     #/list              Einkaufszettel      #/more              Filter, Datenstand, Abruf
   Favoriten: Produktgruppe (+ Markenauswahl, "nur Markenprodukte"), Marke, konkretes Produkt oder Suchbegriff. */

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const enc = encodeURIComponent;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? '' : n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

function load(key, fallback) {
  try { const v = localStorage.getItem('ap.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem('ap.' + key, JSON.stringify(value)); } catch { /* privater Modus o.ä. */ }
}

/* ---------- Datenquelle ----------
   Lokal (start.bat) liefert der eigene Server die Daten unter api/. In der veröffentlichten Fassung
   (GitHub Pages) schreibt tools/deploy_pages.py die Supabase-Verbindung in config.js.
   Alle Pfade relativ, damit die App auch in einem Unterordner (…github.io/<repo>/) läuft. */

const CFG = window.APP_CONFIG || { source: 'server' };
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
const DATA = CFG.source === 'server' ? {
  server: true,  // eigener Server: Abrufstatus und "Jetzt aktualisieren" verfügbar
  offers: () => getJSON('api/offers'),
  catalog: () => getJSON('api/catalog'),
  history: key => getJSON('api/history/' + enc(key)),
  status: () => getJSON('api/status'),
  refresh: () => fetch('api/refresh', { method: 'POST' }),
} : {
  server: false,  // Supabase (cloud.js): Daten lädt der PC zu Hause hoch
  offers: () => Cloud.offers(),
  catalog: () => Cloud.catalog(),
  history: key => Cloud.history(key),
  status: async () => ({ fetch: { running: false }, log: [], ...await Cloud.status() }),
};

const ICONS = {
  'Obst & Gemüse': '🥦', 'Fleisch & Geflügel': '🥩', 'Wurst & Aufschnitt': '🥓', 'Fisch & Meeresfrüchte': '🐟',
  'Milch & Molkerei': '🥛', 'Käse': '🧀', 'Brot & Backwaren': '🥖', 'Tiefkühl': '🧊', 'Vorrat & Konserven': '🥫',
  'Frühstück & Aufstrich': '🍯', 'Süßes & Snacks': '🍫', 'Kaffee & Tee': '☕', 'Getränke': '🥤', 'Bier': '🍺',
  'Wein & Sekt': '🍷', 'Spirituosen': '🥃', 'Drogerie & Pflege': '🧴', 'Baby & Kind': '🍼',
  'Haushalt & Reinigung': '🧽', 'Tierbedarf': '🐾', 'Non-Food': '🛋️', 'Sonstiges': '📦',
};
const UNIT_NAMES = { kg: 'je kg', l: 'je Liter', Stk: 'je Stück', WL: 'je Waschladung', 'Anw.': 'je Anwendung', m: 'je Meter' };
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const OTHER = 'Weitere';

const S = {
  loaded: false, offers: [], byId: new Map(), retailers: {}, categories: [], groups: {}, places: [], placeName: {},
  generated: null, catalog: null,
  q: '', qFacet: null, qBrands: new Set(), showWeak: false, limit: 60,
  brands: new Set(), brandOnly: false,           // Markenfilter in der Gruppenansicht
  draft: null, pickOpen: null, pickQ: '',         // Favoriten-Auswahl
  open: new Set(), favSet: new Set(), sheetId: null, sheetOpen: false,
  status: null, poll: null, wasRunning: false,
  sort: load('sort', 'unit'),
  f: Object.assign({ only: [], place: '', noApp: [], hideCats: [], markets: {}, hideOnline: true, onlyCurrent: false, theme: 'auto' },
    load('filters', {}), { off: undefined, only: [] }),  // only = markierte Händler (leer = alle), gilt nur bis zum Neustart
  favs: load('favs', []),
  favSort: load('favSort', 'offers'),  // Favoriten: 'offers' = mit Angeboten zuerst, 'own' = eigene Reihenfolge
  seen: new Set(load('seen', [])),
};

// alte Schalter übernehmen: „App-Preise ignorieren“ -> keine App genutzt, „Non-Food ausblenden“ -> Kategorie-Filter
if ('hideApp' in S.f) { if (S.f.hideApp) S.f.noApp = ['edeka', 'lidl', 'aldi', 'penny', 'marktkauf', 'rossmann', 'netto', 'rewe', 'combi']; delete S.f.hideApp; }
if ('hideNonFood' in S.f) { if (S.f.hideNonFood && !S.f.hideCats.includes('Non-Food')) S.f.hideCats.push('Non-Food'); delete S.f.hideNonFood; }

/* ---------- Text-Normalisierung & Suche ---------- */


/* ---------- Preise & Filter ---------- */

// App des Händlers genutzt? (Mehr → Filter → Apps)
const useApp = v => !S.f.noApp.includes(v.retailer);
// wirksamer Preis einer Variante; null = nur mit App erhältlich, App aber nicht genutzt
function effOf(v) {
  if (v.app_price && !useApp(v)) {
    if (!v.regular_price) return null;
    return { ep: v.regular_price, eu: v.unit_price ? Math.round(v.unit_price * v.regular_price / v.price * 100) / 100 : null, ea: false };
  }
  return { ep: v.price, eu: v.unit_price, ea: v.app_price };
}

// Gleiche Angebote (Edeka-Märkte mit/ohne App-Preis, dazu Marktkauf) zu einem Eintrag zusammenfassen.
// Angezeigt wird je nach Filter die günstigste passende Variante (siehe choose).
const FAMILY = { marktkauf: 'edeka' };
const VARIANT_FIELDS = ['id', 'retailer', 'source', 'price', 'old_price', 'regular_price', 'discount', 'unit_price', 'unit',
  'unit_price_source', 'unit_approx', 'size', 'app_price', 'app_label', 'app_note', 'image', 'description', 'places', 'markets'];
function aggregate(list) {
  const by = new Map(), out = [];
  for (const v of list) {
    const k = [FAMILY[v.retailer] || v.retailer, v.brand_key, norm(v.title), v.valid_from, v.valid_to].join('|');
    let lead = by.get(k);
    if (!lead) { lead = { ...v, key: v.id, variants: [] }; by.set(k, lead); out.push(lead); }
    lead.variants.push(v);
  }
  return out;
}
// günstigste Variante unter denen, die test bestehen, in das Angebot übernehmen; false = keine passt
function choose(o, test) {
  const ok = o.variants.filter(test);
  let best = null, be = null;
  for (const v of ok.length ? ok : o.variants) {
    const e = effOf(v);
    if (e && (!be || e.ep < be.ep - 0.001 || (Math.abs(e.ep - be.ep) < 0.001 && (v.markets?.length || 0) > (best.markets?.length || 0)))) { best = v; be = e; }
  }
  if (!best) { best = (ok.length ? ok : o.variants)[0]; be = { ep: best.price, eu: best.unit_price, ea: best.app_price }; }
  if (o.vSel !== best) {
    for (const k of VARIANT_FIELDS) o[k] = best[k];
    o.vSel = best;
  }
  o.ep = be.ep; o.eu = be.eu; o.ea = be.ea;
  o.vOk = ok;  // passende Varianten (für Hinweise „auch Marktkauf“, „1 von 12 Märkten“)
  return ok.length > 0 && !!effOf(best);
}
function applyEff() {
  for (const o of S.offers) choose(o, passOne);
}

/* ---------- Gebiet & Händler (je Gruppe vom Admin, lokal im Server-Modus) ---------- */

const RADII = [5, 10, 15, 20, 30, 0];  // km, 0 = ganzer Großraum
const ROUTE_WIDTHS = [1, 2, 3, 5, 8];   // Korridor links/rechts der Strecke in km
const grpSet = () => Cloud.enabled ? Cloud.settings() : load('grpSet', {});
const canEditArea = () => !Cloud.enabled || Cloud.isAdmin();
const placeOf = k => S.places.find(p => p.key === k);

function kmBetween(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Abstand (km) von Punkt p {lat,lng} zur Strecke a–b ([lat,lng]), eben genähert (reicht für wenige km)
function segKm(p, a, b) {
  const kx = 111.32 * Math.cos(p.lat * Math.PI / 180), ky = 110.57;
  const ax = (a[1] - p.lng) * kx, ay = (a[0] - p.lat) * ky, dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky;
  const l = dx * dx + dy * dy;
  const u = l ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l)) : 0;
  return Math.hypot(ax + u * dx, ay + u * dy);
}
const lineKm = (p, line) => line.length === 1 ? segKm(p, line[0], line[0])
  : Math.min(...line.slice(1).map((b, i) => segKm(p, line[i], b)));

// Linie vereinfachen (Douglas-Peucker, Toleranz in km), damit sie klein in den Gruppeneinstellungen liegt
function simplifyLine(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let max = 0, at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segKm({ lat: pts[k][0], lng: pts[k][1] }, pts[i], pts[j]);
      if (d > max) { max = d; at = k; }
    }
    if (max > tol) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

// Straßenroute über die Stopps (OSRM auf OpenStreetMap-Basis; es werden nur Ortskoordinaten gesendet)
async function routeCompute(stops) {
  const pts = stops.map(placeOf).filter(p => p?.lat != null);
  const url = 'https://router.project-osrm.org/route/v1/driving/' + pts.map(p => `${p.lng},${p.lat}`).join(';')
    + '?overview=full&geometries=geojson';
  const j = await (await fetch(url)).json();
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.message || 'keine Route');
  const r = j.routes[0];
  const line = simplifyLine(r.geometry.coordinates.map(([lng, lat]) => [+lat.toFixed(4), +lng.toFixed(4)]), 0.1);
  return { line, km: Math.round(r.distance / 1000), min: Math.round(r.duration / 60) };
}

// Linie der Strecke: berechnete Straßenroute, sonst Luftlinie zwischen den Stopps
function routeLine(rt) {
  if (!rt || (rt.stops || []).length < 2) return null;
  if (rt.line?.length > 1) return rt.line;
  return rt.stops.map(placeOf).filter(p => p?.lat != null).map(p => [p.lat, p.lng]);
}

// Orte im Gebiet = Umkreis um den Wohnort ∪ Korridor entlang der Strecke (null = alle Orte)
function areaPlaces(s) {
  const home = placeOf(s.home);
  if (home && !s.radius) return null;  // Wohnort mit „ganzer Großraum“
  const set = new Set();
  let limited = false;
  if (home && home.lat != null) {
    limited = true;
    S.places.forEach(p => { if (p.lat != null && kmBetween(home, p) <= s.radius) set.add(p.key); });
  }
  const line = routeLine(s.route);
  if (line?.length > 1) {
    limited = true;
    const w = s.route.width || 3;
    S.places.forEach(p => { if (p.lat != null && lineKm(p, line) <= w) set.add(p.key); });
  }
  return limited ? set : null;
}

function applyArea() {
  const s = grpSet();
  S.area = areaPlaces(s);
  const ret = (s.retailers || []).filter(k => S.retailers[k]);
  S.grpRet = ret.length ? ret : null;
  if (S.grpRet) S.f.only = S.f.only.filter(k => S.grpRet.includes(k));
}

// nach dem Melden bei der Gruppe: geänderte Einstellungen (anderer Admin) übernehmen
function areaChanged(before) {
  if (JSON.stringify(grpSet()) === before || !S.loaded) return;
  applyArea();
  renderChips();
  updateBadges();
  rerender();
}

const areaNorm = x => JSON.stringify({ home: x.home || '', radius: x.radius || 0, retailers: x.retailers || [],
  route: x.route && x.route.stops?.length ? { stops: x.route.stops, width: x.route.width || 3 } : null });

function areaPanel() {
  const ed = canEditArea(), dis = ed ? '' : 'disabled';
  const s = grpSet();
  const d = S.areaDraft ||= { home: s.home || '', radius: s.radius || 0, retailers: [...(s.retailers || [])],
    route: s.route ? { ...s.route, stops: [...s.route.stops] } : null };
  const inArea = areaPlaces(d);
  const on = k => !d.retailers.length || d.retailers.includes(k);
  const inD = v => on(v.retailer) && (!inArea || !v.places.length || v.places.some(p => inArea.has(p)));
  const inSel = S.offers.filter(o => o.variants.some(inD));
  const count = inSel.length;
  const mine = inSel.filter(o => leadOk(o) && o.variants.some(v => inD(v) && personalOne(v) && effOf(v))).length;
  const dirty = areaNorm(d) !== areaNorm(s) || (d.route?.line && d.route.line !== s.route?.line);
  const rt = d.route, stops = rt?.stops || [];
  const small = 'class="muted" style="margin:0 0 8px;font-size:.85rem"';
  const routeInfo = !rt ? '' : stops.length < 2 ? 'Mindestens Start und Ziel wählen.'
    : S.routeBusy ? 'Straßenroute wird berechnet …'
    : rt.line?.length > 1 ? `Straßenroute ${rt.km} km, ca. ${rt.min} Min.`
    : 'Luftlinie zwischen den Orten (Straßenroute nicht verfügbar).';
  return `<div class="panel" id="areaPanel"><h3>📍 Gebiet & Händler${Cloud.enabled ? ' der Gruppe' : ''}</h3>
    ${Cloud.enabled ? `<p ${small}>${ed ? 'Gilt für alle in der Gruppe.' : 'Legt der Admin der Gruppe fest.'}</p>` : ''}
    <h4 class="area-h">🏠 Wohnort & Umkreis</h4>
    <label class="line">Wohnort <select data-area="home" ${dis}><option value="">– ohne –</option>
      ${S.places.map(p => `<option value="${p.key}" ${d.home === p.key ? 'selected' : ''}>${esc(p.name)} (${p.zip})</option>`).join('')}</select></label>
    ${ed ? '<button class="btn small" data-act="areaGeo">📍 Meinen Standort verwenden</button>' : ''}
    <label class="line">Umkreis <select data-area="radius" ${dis || (d.home ? '' : 'disabled')}>
      ${RADII.map(r => `<option value="${r}" ${d.radius === r ? 'selected' : ''}>${r ? r + ' km' : 'ganzer Großraum'}</option>`).join('')}</select></label>
    <h4 class="area-h">🚗 Strecke <span class="muted" style="font-weight:400">(z.B. Arbeitsweg, zusätzlich zum Umkreis)</span></h4>
    <label class="line switch"><input type="checkbox" data-area-route ${rt ? 'checked' : ''} ${dis}> Märkte entlang einer Strecke</label>
    ${rt ? `<div class="route-stops">${stops.map((k, i) => `<span class="route-stop">${i === 0 ? '<small>Start</small> ' : i === stops.length - 1 && i ? '<small>Ziel</small> ' : ''}${esc(S.placeName[k] || k)}${ed ? ` <button class="route-x" data-act="routeDel" data-i="${i}" title="Entfernen">✕</button>` : ''}</span>`).join('<span class="route-arrow">→</span>')}</div>
      ${ed ? `<label class="line"><select data-area-add><option value="">+ Ort ${stops.length ? 'anhängen' : 'als Start'} …</option>
        ${S.places.map(p => `<option value="${p.key}">${esc(p.name)}</option>`).join('')}</select></label>` : ''}
      <label class="line">Korridor <select data-area-width ${dis}>${ROUTE_WIDTHS.map(w => `<option value="${w}" ${(rt.width || 3) === w ? 'selected' : ''}>± ${w} km</option>`).join('')}</select></label>
      <p ${small}>${routeInfo}</p>` : ''}
    <p ${small}>${inArea
      ? `Im Gebiet: ${inArea.size} von ${S.places.length} Orten – ${[...inArea].map(k => esc(S.placeName[k] || k)).join(', ')}`
      : 'Im Gebiet: alle Orte des Großraums (Hagen a.T.W. – Langenberg)'}</p>
    <h4 class="area-h">🛒 Händler</h4>
    <div class="area-rets">${Object.entries(S.retailers).map(([k, r]) =>
      `<label class="switch"><input type="checkbox" data-area-ret="${k}" ${on(k) ? 'checked' : ''} ${dis}> ${esc(r.name)}</label>`).join('')}</div>
    <p class="muted" style="margin:8px 0;font-size:.85rem">Im Gebiet ${count} von ${S.offers.length} Angeboten${mine !== count ? `, mit deinen Filtern (Mehr → Filter, Händler-Chips) ${mine}` : ''}.</p>
    ${ed ? `<button class="btn small primary" data-act="areaSave" ${dirty && !S.routeBusy ? '' : 'disabled'}>Speichern</button>` : ''}
  </div>`;
}

const areaRefresh = () => { const el = $('#areaPanel'); if (el) el.outerHTML = areaPanel(); };

// Stopps geändert: Straßenroute neu berechnen (bis dahin Luftlinie)
async function routeUpdate() {
  const rt = S.areaDraft?.route;
  if (!rt) return;
  Object.assign(rt, { line: null, km: null, min: null });
  const stops = [...rt.stops];
  if (stops.length < 2) { areaRefresh(); return; }
  S.routeBusy = true;
  areaRefresh();
  try {
    const r = await routeCompute(stops);
    if (S.areaDraft?.route && JSON.stringify(S.areaDraft.route.stops) === JSON.stringify(stops)) Object.assign(S.areaDraft.route, r);
  } catch (err) {
    toast(`Straßenroute nicht verfügbar (${err.message}) – es wird die Luftlinie verwendet`);
  }
  S.routeBusy = false;
  areaRefresh();
}

const NO_MARKET = '-';  // Mehr → Filter → Märkte: „keiner“
// Gebiet und Händler der Gruppe (je Variante)
function inGroup(v) {
  if (S.grpRet && !S.grpRet.includes(v.retailer)) return false;                              // Händler der Gruppe
  if (S.area && v.places.length && !v.places.some(p => S.area.has(p))) return false;        // Umkreis der Gruppe
  return true;
}
// persönliche Filter je Variante (Händler-Chips, Apps, Märkte)
function personalOne(v) {
  const f = S.f;
  if (f.only.length && !f.only.includes(v.retailer)) return false;
  if (v.app_price && !v.regular_price && !useApp(v)) return false;
  const ms = f.markets[v.retailer];
  if (ms?.[0] === NO_MARKET) return false;  // „keiner“: Händler ganz ausblenden
  if (ms?.length && v.markets?.length && !v.markets.some(m => ms.includes(m))) return false;
  return true;
}
const passOne = v => inGroup(v) && personalOne(v);
// persönliche Filter, die für alle Varianten gleich sind
function leadOk(o) {
  const f = S.f;
  if (f.hideOnline && o.online_only) return false;
  if (f.onlyCurrent && o.upcoming) return false;
  if (f.hideCats.length && f.hideCats.includes(o.category)) return false;
  return true;
}
function passes(o) {
  return leadOk(o) && choose(o, passOne);
}
const visible = () => S.offers.filter(passes);

// Preis ohne App/Kundenkarte (null = nicht angegeben, z.B. "MIT LIDL PLUS APP" ohne Normalpreis)
const normalPrice = o => o.app_price ? (o.regular_price ?? null) : o.price;
function normalUnit(o) {
  const n = normalPrice(o);
  return n != null && o.unit_price ? Math.round(o.unit_price * n / o.price * 100) / 100 : null;
}
const appName = o => o.app_label || 'App';
// Kurztext für App-Vorteile ohne bekannten Preis (Rewe-Bonus, Edeka-App-Preis ohne Betrag)
const appNoteShort = o => (o.app_note || '').split(' (')[0];

function oldPrice(o) {
  const base = normalPrice(o) ?? o.ep;
  return o.old_price && o.old_price > base + 0.001 ? o.old_price : null;
}
function disc(o) {
  if (o.discount) return o.discount;
  const old = oldPrice(o);
  return old ? Math.round(100 * (1 - (normalPrice(o) ?? o.ep) / old)) : null;
}
const priceLine = o => o.eu ? `${fmt(o.eu)} €/${o.unit}` : `${fmt(o.ep)} €`;
const RETAILER_ORDER = ['edeka', 'lidl', 'aldi', 'penny', 'marktkauf', 'rossmann', 'netto', 'rewe', 'combi'];
const rname = o => S.retailers[o.retailer]?.name || o.retailer;

function dshort(iso) {
  const d = new Date(iso + 'T00:00');
  return `${WD[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
}

// Gewicht/Volumen vor Stück, Waschladungen & Co. (z.B. Kapseln: €/kg statt €/Stk, wenn beides vorkommt)
const unitPref = u => u === 'kg' || u === 'l' ? 0 : 1;

function sortOffers(list, mode = S.sort) {
  const val = o => o.eu ?? Infinity;
  if (mode === 'price') return list.sort((a, b) => a.ep - b.ep);
  if (mode === 'discount') return list.sort((a, b) => (disc(b) || 0) - (disc(a) || 0) || val(a) - val(b));
  // Grundpreis: Einheiten nicht vermischen – häufigste Einheit zuerst, innerhalb aufsteigend
  const cnt = {};
  for (const o of list) if (o.eu) cnt[o.unit] = (cnt[o.unit] || 0) + 1;
  const rank = Object.keys(cnt).sort((a, b) => unitPref(a) - unitPref(b) || cnt[b] - cnt[a]);
  const r = o => o.eu ? rank.indexOf(o.unit) : 99;
  return list.sort((a, b) => r(a) - r(b) || val(a) - val(b) || a.ep - b.ep);
}

function countBy(list, fn) {
  const c = {};
  for (const x of list) { const k = fn(x); c[k] = (c[k] || 0) + 1; }
  return c;
}

/* ---------- Favoriten ---------- */


// Vergleichsmaß je Favorit: Grundpreis (Standard) oder Packungspreis (byPack in match.js)
const metricSort = f => byPack(f) ? 'price' : 'unit';
const metricLine = (o, f) => byPack(f) ? `${fmt(o.ep)} €${o.eu ? ` (${fmt(o.eu)} €/${o.unit})` : ''}` : priceLine(o);
const maxLabel = f => byPack(f) ? `max. ${fmt(f.max)} € je Packung` : `max. ${fmt(f.max)} €/${f.maxUnit || 'kg'}`;

function favSig(f) {
  switch (f.type) {
    case 'group': return `g|${f.category}|${f.group || ''}`;
    case 'brand': return `b|${f.brand_key}`;
    case 'product': return `p|${f.brand_key}|${[...f.tokens].sort().join('-')}`;
    case 'search': return `s|${norm(f.q)}|${f.category || ''}|${f.group || ''}|${[...(f.brands || [])].sort().join(',')}`;
  }
  return '';
}

// Suchfavorit aus dem aktuellen Zustand: Suchbegriff + gewählte Produktgruppe + gewählte Marken
function searchFavNow() {
  const f = { type: 'search', q: S.q };
  if (S.qFacet) [f.category, f.group] = S.qFacet.split('\u0001');
  if (S.qBrands.size) {
    f.brands = [...S.qBrands].sort();
    f.brandNames = brandNamesOf(f.brands, S.offers);
  }
  return f;
}

// eigener Name (f.name) ersetzt den automatisch gebildeten Titel
function favLabel(f) {
  const L = favLabelAuto(f);
  if (f.name) return { ...L, title: f.name };
  return L;
}

function favLabelAuto(f) {
  switch (f.type) {
    case 'group': {
      const names = f.brands?.length ? f.brands.map(k => f.brandNames?.[k] || k || 'Ohne Marke').join(', ') : 'alle Marken';
      return {
        icon: ICONS[f.category] || '🗂️', title: f.group || f.category,
        sub: `${f.group ? f.category : 'ganze Kategorie'} · ${names}${f.brandOnly ? ' · nur Markenprodukte' : ''}`,
      };
    }
    case 'brand': return { icon: '®️', title: f.brand || 'Ohne Marke', sub: 'alle Angebote der Marke' };
    case 'product': return { icon: '🏷️', title: f.label, sub: `Produkt · ${f.category} › ${f.group}` };
    case 'search': {
      const parts = [f.group ? (f.group === OTHER ? f.category : f.group) : 'alle Produktgruppen',
        f.brands?.length ? f.brands.map(k => f.brandNames?.[k] || k || 'Ohne Marke').join(', ') : 'alle Marken'];
      return { icon: '🔍', title: `„${f.q}“`, sub: `Suche · ${parts.join(' · ')}` };
    }
  }
  return { icon: '★', title: '?', sub: '' };
}

function saveFavs() { save('favs', S.favs); liFavsPush(S.favs); updateBadges(); pushCtxSave(); }
const findFav = f => S.favs.find(x => favSig(x) === favSig(f));

function toggleFav(f, labelForToast) {
  const ex = findFav(f);
  if (ex) {
    S.favs = S.favs.filter(x => x !== ex);
    toast(`„${labelForToast || favLabel(ex).title}“ entfernt`);
  } else {
    S.favs.push({ ...f, id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
    toast(`★ „${labelForToast || favLabel(f).title}“ gemerkt`);
  }
  saveFavs();
  return !ex;
}

const productFav = o => ({
  type: 'product', brand_key: o.brand_key, brand: o.brand, tokens: o.tokens, category: o.category, group: o.group,
  label: `${o.brand} ${o.short || o.name}`.trim(), unit: o.unit,
});
const isProductFav = o => S.favs.some(f => f.type === 'product' && f.brand_key === o.brand_key && tokMatch(f.tokens, o.tokens));

function toggleProductFav(o) {
  const hits = S.favs.filter(f => f.type === 'product' && f.brand_key === o.brand_key && tokMatch(f.tokens, o.tokens));
  if (hits.length) {
    S.favs = S.favs.filter(f => !hits.includes(f));
    saveFavs();
    toast(`„${hits[0].label}“ entfernt`);
  } else {
    toggleFav(productFav(o));
  }
}

function brandNamesOf(keys, source) {
  const names = {};
  for (const k of keys) {
    const x = source.find(o => o.brand_key === k);
    names[k] = x ? (x.brand || 'Ohne Marke') : KNOWN_NAME.get(k) || k;
  }
  return names;
}

// Gruppenfavorit anlegen/aktualisieren/entfernen (eine Auswahl je Gruppe)
// „☆ Gruppe merken“ / „＋ Zettel“ – gleiche Knöpfe in Kategorien und bei Favoriten → hinzufügen
function groupActions(cat, group, brands, brandOnly, acts = ['groupFav', 'groupWish']) {
  const ex = findFav({ type: 'group', category: cat, group: group || null });
  const same = ex && JSON.stringify(ex.brands || []) === JSON.stringify([...brands].sort()) && !!ex.brandOnly === !!brandOnly;
  const what = group ? 'Gruppe' : 'Kategorie';
  const label = ex ? (same ? '★ Gemerkt' : '★ Auswahl übernehmen') : (brands.size ? '☆ Auswahl merken' : `☆ ${what} merken`);
  return `<div class="chips wrap grp-acts">
      <button class="btn act-fav ${ex ? 'on' : ''}" data-act="${acts[0]}" data-c="${esc(cat)}" data-g="${esc(group || '')}">${label}</button>
      <button class="btn act-list" data-act="${acts[1]}" data-c="${esc(cat)}" data-g="${esc(group || '')}">＋ Zettel</button></div>`;
}

function saveGroupFav(cat, group, brands, brandOnly, source) {
  const base = { type: 'group', category: cat, group: group || null };
  const ex = findFav(base);
  const sel = { brands: [...brands].sort(), brandOnly: !!brandOnly, brandNames: brandNamesOf(brands, source) };
  if (ex && JSON.stringify(ex.brands || []) === JSON.stringify(sel.brands) && !!ex.brandOnly === sel.brandOnly) {
    S.favs = S.favs.filter(x => x !== ex);
    toast(`„${group || cat}“ entfernt`);
  } else if (ex) {
    Object.assign(ex, sel);
    toast(`★ „${group || cat}“ aktualisiert`);
  } else {
    S.favs.push({ ...base, ...sel, id: 'f' + Date.now().toString(36) });
    toast(`★ „${group || cat}“ gemerkt`);
  }
  saveFavs();
}

function favRows(vis) {
  return S.favs.map(f => ({ f, m: vis.filter(o => favMatch(f, o)) }));
}

function freshCount(vis) {
  const ids = new Set();
  for (const { m } of favRows(vis)) for (const o of m) if (!S.seen.has(o.key)) ids.add(o.key);
  return ids.size;
}

function markSeen(ids) {
  const current = new Set(S.offers.map(o => o.key));
  S.seen = new Set([...S.seen, ...ids].filter(id => current.has(id)));
  save('seen', [...S.seen]);
  updateBadges();
  pushCtxSave();
}

/* ---------- Push: Benachrichtigung bei neuen Favoriten-Angeboten (Service Worker zählt selbst) ---------- */

const pushAvailable = () => Cloud.enabled && !!(window.APP_CONFIG || {}).vapidKey && 'serviceWorker' in navigator &&
  'PushManager' in window && 'Notification' in window;
// Stand für den Service Worker (kein localStorage dort): Favoriten, gesehene Angebote, Filter, Gebiet, Zugang
async function pushCtxSave() {
  if (!pushAvailable() || !S.loaded || !load('push', false)) return;
  try {
    const ctx = { favs: S.favs, seen: [...S.seen], f: S.f, grpRet: S.grpRet || null, area: S.area ? [...S.area] : null,
      cloud: Cloud.pushCtx(), at: Date.now() };
    const c = await caches.open('ap-ctx');
    await c.put('https://cache.local/ctx', new Response(JSON.stringify(ctx)));
  } catch { /* kein Cache – dann eben ohne Zählung */ }
}
async function pushClearBadge() {
  try { await navigator.clearAppBadge?.(); } catch { /* egal */ }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    (await reg?.getNotifications({ tag: 'favs' }) || []).forEach(n => n.close());
  } catch { /* egal */ }
}
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
async function pushEnable(on) {
  const reg = await navigator.serviceWorker.ready;
  if (on) {
    if (await Notification.requestPermission() !== 'granted') throw new Error('Benachrichtigungen sind im Browser blockiert');
    const sub = await reg.pushManager.getSubscription() ||
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(window.APP_CONFIG.vapidKey) });
    await Cloud.pushSubscribe(sub.toJSON());
    save('push', true);
    await pushCtxSave();
  } else {
    save('push', false);
    await Cloud.pushUnsubscribe().catch(() => {});
    await (await reg.pushManager.getSubscription())?.unsubscribe();
  }
}

/* ---------- Einkaufszettel: siehe list.js (Li.hasOffer, Li.toggleOffer, Li.addWish) ---------- */

const inList = o => Li.hasOffer(o);
const onListMark = prio => `<span class="onlist${prio ? ' prio' : ''}" title="${prio ? 'Wichtig auf' : 'Auf'} dem Zettel">${prio ? '❗' : '✓'}</span> `;

/* ---------- Bausteine ---------- */

// Einheitlicher Preisblock jeder Karte: je Preisart eine Zeile "Packungspreis | Grundpreis",
// zuerst ohne App, darunter (nur falls vorhanden) mit App/Kundenkarte (📱, farbig).
// Der Vergleichswert (Grundpreis bzw. bei "Packungspreis"-Favoriten der Packungspreis) ist hervorgehoben.
// Streichpreise zeigt die Karte bewusst nicht, nur den Rabatt-Tag.
function priceBlock(o, metric) {
  const row = (cls, pack, unit, mark = '') => `<span class="p-pack ${cls}">${mark}${pack != null ? `${fmt(pack)} €` : ''}</span>
    <span class="p-unit ${cls}">${unit != null ? `${fmt(unit)} €/${esc(o.unit)}` : '–'}</span>`;
  const main = metric === 'price' || !o.eu ? 'm-pack' : 'm-unit';
  if (!o.ea) return `<div class="price ${main}">${row('', o.ep, o.eu)}</div>`;
  const np = normalPrice(o);
  return `<div class="price ${main}" title="📱 = Preis mit ${esc(appName(o))}">
    ${np != null ? row('', np, normalUnit(o)) : ''}${row('is-app', o.price, o.unit_price, '📱 ')}</div>`;
}

// kompakter Preis der Karte: Vergleichswert fett (Grundpreis bzw. Packungspreis), darunter der andere Wert
function cardPrice(o, metric) {
  const byPack = metric === 'price' || !o.eu;
  const ab = o.unit_approx ? 'ab ' : '';  // Packungsgrößen-Spanne: Grundpreis der größten Packung
  const main = byPack ? `${fmt(o.ep)} €` : `${ab}${fmt(o.eu)} €/${esc(o.unit)}`;
  const sub = byPack ? (o.eu ? `${ab}${fmt(o.eu)} €/${esc(o.unit)}` : '') : `${fmt(o.ep)} €`;
  const np = o.ea ? normalPrice(o) : null;
  // Normalpreis ohne App als eigene kleine Zeile (sonst zu breit auf dem Handy)
  return `<div class="cprice"><b class="${o.ea ? 'is-app' : ''}">${o.ea ? '📱 ' : ''}${main}</b>
    ${sub ? `<small>${sub}</small>` : ''}${np != null ? `<small class="np">ohne App ${fmt(np)} €</small>` : ''}</div>`;
}

function card(o, opts = {}) {
  const r = S.retailers[o.retailer] || { name: o.retailer, color: '#888' };
  const d = disc(o);
  const tags = [];
  // Preis gilt nur in einem Teil der Märkte (z.B. Edeka-App-Preis in 1 von 12 Märkten)
  const allMk = new Set((o.vOk?.length ? o.vOk : o.variants).flatMap(v => v.markets || []));
  const part = o.markets?.length && allMk.size > o.markets.length ? `${o.markets.length}/${allMk.size} Märkte` : '';
  if (opts.isNew?.(o)) tags.push('<span class="tag newt">NEU</span>');
  if (o.ea) tags.push(`<span class="tag app">📱 ${part || esc(appName(o))}</span>`);
  else if (part) tags.push(`<span class="tag">${part}</span>`);
  if (d && d > 0) tags.push(`<span class="tag red">−${d}%</span>`);
  if (!o.ea && o.app_note && useApp(o)) tags.push(`<span class="tag app" title="${esc(o.app_note)}">📱 ${esc(appNoteShort(o))}</span>`);
  if (o.online_only) tags.push('<span class="tag">online</span>');
  if (o.upcoming) tags.push(`<span class="tag blue">ab ${dshort(o.valid_from)}</span>`);
  else if (o.valid_to) tags.push(`<span class="tag">bis ${dshort(o.valid_to)}</span>`);
  if (!part && o.markets?.length > 1) tags.push(`<span class="tag">${o.markets.length} Märkte</span>`);
  // gleiches Angebot auch bei anderen Händlern derselben Familie (Marktkauf zu Edeka)
  const others = [...new Set((o.vOk || []).map(v => v.retailer).filter(k => k !== o.retailer))];
  const also = others.length ? `<span class="also">+ ${others.map(k => esc(S.retailers[k]?.name || k)).join(', ')}</span>` : '';
  // Zettel-Status als kleiner Haken vor dem Titel (hinzufügen per Wischen)
  const onl = inList(o) ? onListMark(Li.isPrioOffer(o)) : '';
  const name = o.name || o.title;
  const title = o.brand && !norm(name).includes(norm(o.brand)) ? `${o.brand} ${name}` : name;
  const img = o.image
    ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(o.image)}" alt="" onerror="this.replaceWith('${ICONS[o.category] || '📦'}')">`
    : ICONS[o.category] || '📦';
  // kompakt: Titel (mit Marke) · Händler + Beschreibung · Hinweise; rechts Preis und ☆. Zettel/Wichtig per Wischen
  const fav = isProductFav(o);
  return `<article class="card" data-act="open" data-id="${esc(o.id)}">
    <div class="thumb">${img}</div>
    <div class="info">
      <h3>${onl}${esc(title)}</h3>
      <div class="meta"><span class="rt" style="--c:${r.color}">${esc(r.name)}${also}</span>${o.size ? `<span class="size">${esc(o.size)}</span>` : ''}${o.description && !opts.short ? `<span class="brand">${esc(o.description)}</span>` : ''}</div>
      ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
    </div>
    <div class="side">
      ${cardPrice(o, opts.metric)}
      <button class="star-s ${fav ? 'on' : ''}" data-act="star" data-id="${esc(o.id)}" aria-label="Produkt merken">${fav ? '★' : '☆'}</button>
    </div>
  </article>`;
}

function offerList(list, opts = {}) {
  if (!list.length) return '<p class="empty">Keine passenden Angebote.</p>';
  const limit = opts.limit ?? S.limit;
  const headers = opts.heads !== false && (opts.sort ?? S.sort) === 'unit';
  const units = new Set(list.map(o => o.eu ? o.unit : '-'));
  let h = '<div class="list">', last = null;
  for (const o of list.slice(0, limit)) {
    const u = o.eu ? o.unit : '-';
    if (headers && units.size > 1 && u !== last) {
      h += `<div class="unit-head">${u === '-' ? 'ohne Grundpreis' : 'Grundpreis ' + (UNIT_NAMES[u] || 'je ' + esc(u))}</div>`;
      last = u;
    }
    h += card(o, opts);
  }
  if (list.length > limit) h += `<button class="btn more-btn" data-act="more" data-auto>Weitere ${list.length - limit} werden geladen …</button>`;
  return h + '</div>';
}

function sortbar(n) {
  const modes = [['unit', 'Grundpreis'], ['price', 'Preis'], ['discount', 'Rabatt']];
  return `<div class="sortbar"><span>${n} Angebot${n === 1 ? '' : 'e'}</span><div class="seg">${modes
    .map(([k, l]) => `<button class="${S.sort === k ? 'on' : ''}" data-act="sort" data-s="${k}">${l}</button>`).join('')}</div></div>`;
}

function brandCounts(list) {
  const m = new Map();
  for (const o of list) {
    const e = m.get(o.brand_key) || { key: o.brand_key, name: o.brand || 'Ohne Marke', n: 0, type: o.brand_type };
    e.n++;
    m.set(o.brand_key, e);
  }
  return sortBrands([...m.values()]);
}

// Marken: erst Markenprodukte A–Z, dann Handelsmarken (ja!, Gut & Günstig …) A–Z, „Ohne Marke“ zuletzt
const BRAND_RANK = { marke: 0, eigen: 1 };
const sortBrands = list => list.sort((a, b) => (BRAND_RANK[a.type] ?? 2) - (BRAND_RANK[b.type] ?? 2) ||
  a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));

/* ---------- Bekannte Marken und Eigenmarken (brands.js) ---------- */

const FOOD_CATS = ['Fleisch & Geflügel', 'Wurst & Aufschnitt', 'Fisch & Meeresfrüchte', 'Milch & Molkerei', 'Käse',
  'Brot & Backwaren', 'Tiefkühl', 'Vorrat & Konserven', 'Frühstück & Aufstrich', 'Süßes & Snacks', 'Kaffee & Tee', 'Getränke'];
// Namen aller bekannten Marken (Schlüssel -> Anzeigename) und Händler der Eigenmarken
const KNOWN_RET = new Map();  // KNOWN_NAME: match.js
// "Kat/Gruppe, Kat, …" – Gruppennamen enthalten selbst Kommas („Mehl, Zucker & Backen“): Teile ohne Kategorie anhängen
const OWN_CATS = [...FOOD_CATS, 'Bier', 'Wein & Sekt', 'Spirituosen', 'Drogerie & Pflege', 'Baby & Kind', 'Haushalt & Reinigung', 'Tierbedarf'];
function ownPlaces(s) {
  const out = [];
  for (const part of s.split(', ')) {
    if (!out.length || part === 'Lebensmittel' || part.includes('/') || OWN_CATS.includes(part)) out.push(part);
    else out[out.length - 1] += ', ' + part;
  }
  return out;
}
const KNOWN_OWN_AT = (typeof KNOWN_OWN === 'undefined' ? [] : KNOWN_OWN).map(([name, retailer, where]) => {
  KNOWN_NAME.set(bkey(name), name);
  KNOWN_RET.set(bkey(name), retailer);
  return { name, retailer, where: ownPlaces(where) };
});
for (const list of Object.values(typeof KNOWN_BRANDS === 'undefined' ? {} : KNOWN_BRANDS))
  for (const n of list.split(',').map(s => s.trim()).filter(Boolean)) if (!KNOWN_NAME.has(bkey(n))) KNOWN_NAME.set(bkey(n), n);

// bekannte Marken einer Produktgruppe: Markenprodukte und passende Eigenmarken der Händler
function knownBrands(cat, group) {
  const out = new Map();
  for (const n of (KNOWN_BRANDS[`${cat}|${group}`] || '').split(',').map(s => s.trim()).filter(Boolean))
    out.set(bkey(n), { key: bkey(n), name: n, type: 'marke' });
  for (const b of KNOWN_OWN_AT) {
    const fits = b.where.some(w => w === `${cat}/${group}` || w === cat || (w === 'Lebensmittel' && FOOD_CATS.includes(cat)));
    if (fits && !out.has(bkey(b.name))) out.set(bkey(b.name), { key: bkey(b.name), name: b.name, type: 'eigen', retailer: b.retailer });
  }
  return [...out.values()];
}


// Produktgruppen einer Kategorie A–Z, „Weitere“ zuletzt
const groupsOf = cat => [...new Set(S.groups[cat] || [])].filter(g => g !== OTHER)
  .sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' })).concat(OTHER);

/* ---------- Ansichten ---------- */

function renderHome() {
  const vis = visible();
  const counts = countBy(vis, o => o.category);
  const fresh = freshCount(vis);
  let h = '';
  if (S.favs.length) {
    const ids = new Set();
    for (const { m } of favRows(vis)) m.forEach(o => ids.add(o.id));
    h += `<a class="banner" href="#/favs">★ <span><b>${ids.size}</b> Angebote zu deinen ${S.favs.length} Favoriten</span>
      ${fresh ? `<span class="new">${fresh} neu</span>` : ''}<span style="margin-left:auto">›</span></a>`;
  } else {
    h += `<a class="banner muted" href="#/add">★ <span>Favoriten anlegen: Produktgruppen, Marken oder einzelne Produkte auswählen</span><span style="margin-left:auto">›</span></a>`;
  }
  h += '<div class="grid">' + S.categories.filter(c => counts[c]).map(c =>
    `<a class="tile" href="#/c/${enc(c)}"><span class="ico">${ICONS[c] || '📦'}</span><span class="nm">${esc(c)}</span><span class="ct">${counts[c]} Angebote</span></a>`
  ).join('') + '</div>';
  h += `<p class="sub" style="padding-bottom:16px">${vis.length} Angebote · Stand ${S.generated ? new Date(S.generated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–'}</p>`;
  view.innerHTML = h;
}

function renderCategory(cat, group) {
  const all = visible().filter(o => o.category === cat);
  const gc = countBy(all, o => o.group);
  const groups = groupsOf(cat).filter(g => gc[g]);
  let list = group ? all.filter(o => o.group === group) : all;
  let h = `<div class="head"><h2>${ICONS[cat] || ''} ${esc(cat)}</h2>
    ${group ? '' : `<a class="btn small" href="#/add/${enc(cat)}">☆ Favoriten wählen</a>`}</div>`;
  h += `<div class="chips wrap pick"><a class="chip ${group ? '' : 'on'}" href="#/c/${enc(cat)}">Alle <i>${all.length}</i></a>` +
    groups.map(g => `<a class="chip ${g === group ? 'on' : ''}" href="#/c/${enc(cat)}${g === group ? '' : '/' + enc(g)}">${esc(g)} <i>${gc[g]}</i></a>`).join('') + '</div>';
  if (group) {
    const brands = brandCounts(list);
    // gewählte Marken ohne aktuelles Angebot trotzdem zeigen (zum Abwählen), z.B. aus der Favoriten-Auswahl
    for (const k of S.brands) if (!brands.some(b => b.key === k)) brands.push({ key: k, name: KNOWN_NAME.get(k) || k, n: 0, type: KNOWN_RET.has(k) ? 'eigen' : 'marke' });
    sortBrands(brands);
    h += `<div class="chips-sep"><span>Marken</span></div>
      <div class="chips wrap pick"><button class="chip ${S.brandOnly ? 'on' : ''}" data-act="brandOnly">Nur Markenprodukte</button>` +
      brands.map(b => `<button class="chip ${S.brands.has(b.key) ? 'on' : ''}" data-act="brand" data-b="${esc(b.key)}">${esc(b.name)} <i>${b.n}</i></button>`).join('') + '</div>';
    if (S.brandOnly) list = list.filter(o => o.brand_type === 'marke');
    if (S.brands.size) list = list.filter(o => brandHit({ brands: [...S.brands] }, o));  // wie beim Favoriten (auch Titel)
    h += groupActions(cat, group, S.brands, S.brandOnly);
  }
  h += sortbar(list.length) + offerList(sortOffers(list), { heads: false });  // Kategorien: ohne Zwischenüberschriften je Einheit
  view.innerHTML = h;
}

// Tab „Alle“: alle Angebote der gewählten Händler, nach Kategorie, darin nach Rabatt (höchster zuerst), sonst A–Z
function renderAll() {
  const rank = new Map(S.categories.map((c, i) => [c, i]));
  const disc = o => (o.discount > 0 && o.discount < 100 ? o.discount : 0);
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'de');
  // „Top-Angebote“: nur ab 30 % Rabatt, nach Rabatt sortiert (ohne Kategorie-Gliederung)
  const list = S.allTop
    ? visible().filter(o => disc(o) >= 30).sort((a, b) => disc(b) - disc(a) || byName(a, b))
    : visible().sort((a, b) => (rank.get(a.category) ?? 999) - (rank.get(b.category) ?? 999) || disc(b) - disc(a) || byName(a, b));
  const sel = S.f.only.map(k => S.retailers[k]?.name || k);
  let h = `<div class="head"><h2>🏷️ ${S.allTop ? 'Top-Angebote' : 'Alle Angebote'}</h2>
      <button class="btn small ${S.allTop ? 'on' : ''}" data-act="allTop">🔥 Top-Angebote</button></div>
    <div class="sortbar"><span>${list.length} Angebote${S.allTop ? ' ab 30 % Rabatt' : ''} · ${sel.length ? esc(sel.join(', ')) : 'alle Händler'}</span></div>`;
  // Schnellwahl: springt zur Kategorie (kein Filter)
  const cc = countBy(list, o => o.category);
  const cats = S.allTop ? [] : [...new Set(list.map(o => o.category))];
  if (cats.length > 1) h += '<div class="chips scroll all-jump">' + cats.map(c =>
    `<button class="chip" data-act="allJump" data-c="${esc(c)}">${ICONS[c] || ''} ${esc(c)} <i>${cc[c]}</i></button>`).join('') + '</div>';
  if (!list.length) { view.innerHTML = h + '<p class="empty">Keine passenden Angebote.</p>'; return; }
  S.allOrder = cats;
  S.allStart = cats.map(c => list.findIndex(o => o.category === c));
  const from = Math.min(S.allFrom || 0, list.length - 1);
  h += '<div class="list">';
  if (from > 0) h += `<button class="btn more-btn" data-act="allPrev">▲ ${from} Angebote davor anzeigen</button>`;
  let last = null;
  for (const o of list.slice(from, S.limit)) {
    if (!S.allTop && o.category !== last) {
      h += `<div class="unit-head cat-head" data-cat="${esc(o.category)}">${ICONS[o.category] || '📦'} ${esc(o.category)}</div>`;
      last = o.category;
    }
    h += card(o);
  }
  if (list.length > S.limit) h += `<button class="btn more-btn" data-act="more" data-auto>Weitere ${list.length - S.limit} werden geladen …</button>`;
  view.innerHTML = h + '</div>';
}

// Suchtreffer wie in der Suche oben: [Angebot, stark (Name/Marke/Gruppe) oder nur Beschreibung], ggf. Tippfehler-Suche
function searchResults(q) {
  const qt = qTokens(q), vis = visible();
  let res = [], fuzzy = false;
  for (const o of vis) {
    const m = matchQuery(o, qt);
    if (m) res.push([o, m.strong]);
  }
  if (!res.length) {  // keine genauen Treffer: ähnliche Schreibweisen (Tippfehler)
    fuzzy = true;
    for (const o of vis) {
      const m = matchQuery(o, qt, true);
      if (m) res.push([o, m.strong]);
    }
  }
  return { res, fuzzy };
}
// Treffer, die die Suche standardmäßig zeigt (ohne „nur in der Beschreibung“, falls es andere gibt)
function searchHits(q) {
  const { res } = searchResults(q);
  const strong = res.filter(r => r[1]).map(r => r[0]);
  return strong.length ? strong : res.map(r => r[0]);
}

function renderSearch() {
  const { res, fuzzy } = searchResults(S.q);
  const strong = res.filter(r => r[1]).map(r => r[0]);
  const weakN = res.length - strong.length;
  let list = strong.length && !S.showWeak ? strong : res.map(r => r[0]);
  const fc = countBy(list, o => o.category + '\u0001' + o.group);
  const facets = Object.entries(fc).sort((a, b) => b[1] - a[1]).slice(0, 14)
    .sort((a, b) => a[0].split('')[1].localeCompare(b[0].split('')[1], 'de'));
  if (S.qFacet && !fc[S.qFacet]) S.qFacet = null;
  if (S.qFacet) list = list.filter(o => o.category + '\u0001' + o.group === S.qFacet);
  // dritte Filterreihe: Marken der (nach Produktgruppe eingegrenzten) Treffer
  const brands = brandCounts(list);
  for (const k of [...S.qBrands]) if (!brands.some(b => b.key === k)) S.qBrands.delete(k);
  if (S.qBrands.size) list = list.filter(o => S.qBrands.has(o.brand_key));
  const has = !!findFav(searchFavNow());
  let h = `<div class="head"><h2>„${esc(S.q)}“</h2>
    <button class="btn small ${has ? 'on' : ''}" data-act="searchFav" title="merkt Suchbegriff mit gewählter Produktgruppe und Marken">
      ${has ? '★ Gemerkt' : (S.qFacet || S.qBrands.size ? '☆ Suche mit Filtern merken' : '☆ Suche merken')}</button></div>`;
  if (facets.length > 1 || S.qFacet) {
    h += '<p class="sub">Nach Produktgruppe eingrenzen:</p><div class="chips wrap pick">' +
      `<button class="chip ${S.qFacet ? '' : 'on'}" data-act="facet" data-k="">Alle</button>` +
      facets.map(([k, n]) => {
        const [c, g] = k.split('\u0001');
        return `<button class="chip ${S.qFacet === k ? 'on' : ''}" data-act="facet" data-k="${esc(k)}" title="${esc(c)}">${ICONS[c] || ''} ${esc(g === OTHER ? c : g)} <i>${n}</i></button>`;
      }).join('') + '</div>';
  }
  if (brands.length > 1 || S.qBrands.size) {
    h += '<p class="sub">Nach Marke eingrenzen:</p><div class="chips wrap pick">' +
      `<button class="chip ${S.qBrands.size ? '' : 'on'}" data-act="qBrand" data-b="">Alle</button>` +
      brands.map(b => `<button class="chip ${S.qBrands.has(b.key) ? 'on' : ''}" data-act="qBrand" data-b="${esc(b.key)}">${esc(b.name)} <i>${b.n}</i></button>`).join('') +
      '</div>';
  }
  if (fuzzy && res.length) h += '<p class="sub">Keine genauen Treffer – ähnliche Schreibweisen:</p>';
  if (weakN && strong.length && !S.showWeak) {
    h += `<div class="chips"><button class="btn small" data-act="showWeak">+ ${weakN} Treffer nur in der Beschreibung</button></div>`;
  }
  h += sortbar(list.length) + offerList(sortOffers(list));
  view.innerHTML = h;
}

function dominantUnit(list) {
  const c = countBy(list.filter(o => o.eu), o => o.unit);
  return Object.keys(c).sort((a, b) => unitPref(a) - unitPref(b) || c[b] - c[a])[0];
}

function renderFavs() {
  const vis = visible();
  let h = `<div class="head"><h2>★ Favoriten</h2><a class="btn primary" href="#/add">＋ Hinzufügen</a></div>`;
  if (!S.favs.length) {
    h += `<p class="empty">Noch keine Favoriten.<br><br>Unter „Hinzufügen“ wählst du Produktgruppen, Marken oder einzelne Produkte aus –
      oder du tippst bei einem Angebot auf ★. Neue passende Angebote werden hier und im Tab markiert.</p>`;
    view.innerHTML = h;
    return;
  }
  // Sortierung: Favoriten mit Angeboten zuerst (innerhalb in eigener Reihenfolge) oder ganz eigene Reihenfolge,
  // die per Griff ⠿ verschiebbar ist
  const own = S.favSort === 'own';
  // Katalog (mit Preisspannen) für die Preis-Leisten nachladen
  prefetchCatalog();
  const rows = favRows(vis);
  if (!own) rows.sort((a, b) => (b.m.length > 0) - (a.m.length > 0));
  h += `<div class="sortbar"><span>${S.favs.length} Favorit${S.favs.length === 1 ? '' : 'en'}${own ? ' · zum Verschieben ⠿ ziehen' : ''}</span>
    <div class="seg"><button class="${own ? '' : 'on'}" data-act="favSort" data-s="offers">Angebote zuerst</button>
    <button class="${own ? 'on' : ''}" data-act="favSort" data-s="own">Eigene Reihenfolge</button></div></div>`;
  const seenNow = [];
  const isNew = o => !S.seen.has(o.key);
  for (const { f, m } of rows) {
    const pack = byPack(f);
    // ältere Favoriten: Preisalarm ohne gespeicherte Einheit -> vorherrschende Einheit der Treffer übernehmen
    if (f.max && !pack && !f.maxUnit) { f.maxUnit = dominantUnit(m) || 'kg'; save('favs', S.favs); }
    sortOffers(m, metricSort(f));
    const best = m[0];
    const fresh = m.filter(isNew).length;
    const L = favLabel(f);
    const open = S.open.has(f.id), settings = S.favSet.has(f.id);
    const wish = Li.favWish(f);  // offener Wunsch zu diesem Favoriten auf dem Zettel?
    h += `<section class="fav" data-fid="${f.id}"><div class="fav-h" data-act="favOpen" data-fid="${f.id}">
      ${own ? '<span class="fav-drag" aria-label="Verschieben" title="Zum Verschieben ziehen">⠿</span>' : ''}
      <span style="font-size:22px">${L.icon}</span>
      <div class="t"><b>${wish ? onListMark(wish.prio) : ''}${esc(L.title)}${fresh ? ` <span class="new">${fresh} neu</span>` : ''}</b>
        <small>${esc(L.sub)}${pack ? ' · Packungspreis' : ''}${f.max ? ` · ${esc(maxLabel(f))}` : ''} · ${m.length ? `${m.length} Angebot${m.length === 1 ? '' : 'e'}` : 'kein Angebot'}</small></div>
      <div class="fav-r">${best ? `<span class="fav-best${best.ea ? ' is-app' : ''}">ab ${best.ea ? '📱 ' : ''}${esc(pack ? `${fmt(best.ep)} €` : priceLine(best))}</span>
          <span class="fav-rt">${esc(rname(best))}</span>` : ''}</div>
      <button class="fav-more ${settings ? 'on' : ''}" data-act="favSettings" data-fid="${f.id}" aria-label="Einstellungen">⋮</button></div>${priceBar(favRange(f, m))}`;
    if (settings) {
      // Einstellungen nur auf Wunsch (⚙️), nicht beim Aufklappen
      const unit = f.maxUnit || dominantUnit(m) || 'kg';
      h += `<div class="fav-settings"><div class="fav-tools">
        <span>Name:</span><input class="fav-name" data-fid="${f.id}" data-field="name" value="${esc(f.name || '')}"
          placeholder="${esc(favLabelAuto(f).title)}" autocomplete="off"></div>
        <div class="fav-tools">
        <span>Vergleich:</span><span class="seg">
          <button class="${pack ? '' : 'on'}" data-act="favMetric" data-fid="${f.id}" data-m="unit">Grundpreis</button>
          <button class="${pack ? 'on' : ''}" data-act="favMetric" data-fid="${f.id}" data-m="price">Packungspreis</button></span></div>
        <div class="fav-tools">
        <span>Preisalarm: max.</span>
        <input type="number" step="0.01" min="0" inputmode="decimal" data-fid="${f.id}" data-field="max" value="${f.max ?? ''}" placeholder="–">
        ${pack ? '<span>€ je Packung</span>'
          : `<span>€ /</span><select data-fid="${f.id}" data-field="maxUnit">${['kg', 'l', 'Stk'].map(u => `<option ${unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select>`}
        </div><div class="fav-tools">
        ${f.type === 'group' ? `<a class="btn small" href="#/add/${enc(f.category)}${f.group ? '/' + enc(f.group) : ''}">Auswahl bearbeiten</a>` : ''}
        <button class="btn small danger" data-act="favDel" data-fid="${f.id}">Löschen</button></div></div>`;
    }
    if (open) {
      h += offerList(m, { limit: 200, sort: metricSort(f), metric: metricSort(f), isNew, short: true });
      m.forEach(o => seenNow.push(o.key));
    }
    h += '</section>';
  }
  view.innerHTML = h;
  // Aufgeklappte Treffer gelten nach kurzem Anzeigen als gesehen
  clearTimeout(S.seenTimer);
  if (seenNow.length) S.seenTimer = setTimeout(() => markSeen(seenNow), 2500);
}

async function loadCatalog() {
  S.catalog = await DATA.catalog();
}
// Katalog gleich nach den Angeboten im Hintergrund laden, damit die Preis-Leisten in Favoriten sofort da sind
function prefetchCatalog() {
  if (S.catalog || S.catLoading) return;
  S.catLoading = loadCatalog().then(() => { if (route()[0] === 'favs') rerender(); }).catch(() => {}).finally(() => { S.catLoading = null; });
}

/* ---------- Preis-Leiste: Tiefst-, Durchschnitts-, Höchstpreis der letzten 12 Monate ---------- */

// Katalogeintrag wie ein Angebot aufbereiten, damit favMatch darauf passt
function catOffer(e) {
  if (!e._o) {
    e._o = { category: e.category, group: e.group, brand: e.brand, brand_key: e.brand_key, brand_type: e.brand_type,
      tokens: e.tokens || [], title: e.name, description: '' };
    prep(e._o);
  }
  return e._o;
}

// Spanne über alle Katalogprodukte eines Favoriten (Grundpreis in der häufigsten Einheit bzw. Packungspreis);
// je Produkt fließt jedes Angebot (Händler x Angebotswoche) einmal ein. cur = bestes aktuelles Angebot
function favRange(f, m) {
  if (!S.catalog) return null;
  const pack = byPack(f), g = { ...f, max: null };
  const ents = S.catalog.filter(e => e.hist && (pack ? e.hist.pn : e.hist.n) && favMatch(g, catOffer(e)));
  let u = '';
  if (!pack) {
    const w = {};
    for (const e of ents) w[e.hist.u] = (w[e.hist.u] || 0) + e.hist.n;
    u = Object.keys(w).sort((a, b) => unitPref(a) - unitPref(b) || w[b] - w[a])[0];
    if (!u) return null;
  }
  // je Produkt: [Anzahl, Ø, Tiefst, Höchst]; Ausreißer (falsch eingeordnete Produkte, z.B. „Body Butter“ bei Butter)
  // weglassen: Ø mehr als 3-mal über bzw. unter dem Median der Produkte
  let ps = ents.map(({ hist: h }) => pack ? [h.pn, h.pavg, h.pmin, h.pmax, h.d0] : h.u === u ? [h.n, h.avg, h.min, h.max, h.d0] : null).filter(Boolean);
  if (ps.length > 2) {
    const med = ps.map(p => p[1]).sort((a, b) => a - b)[ps.length >> 1];
    ps = ps.filter(p => p[1] <= med * 3 && p[1] >= med / 3);
  }
  let n = 0, sum = 0, min = Infinity, max = -Infinity, d0 = '9999';
  for (const [c, a, lo, hi, d] of ps) { n += c; sum += a * c; min = Math.min(min, lo); max = Math.max(max, hi); if (d && d < d0) d0 = d; }
  if (!n) return null;
  const now = m.map(o => pack ? o.ep : (o.unit === u ? o.eu : null)).filter(v => v != null);
  return { n, min, max, avg: sum / n, u, d0: d0 === '9999' ? null : d0, cur: now.length ? Math.min(...now) : null };
}

// Spanne eines einzelnen Produkts aus seinem Preisverlauf (Detailansicht)
function rowsRange(o, rows) {
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const recent = rows.filter(r => r.valid_from >= since);
  const unit = recent.filter(r => r.unit_price && r.unit === o.unit);
  const vals = unit.length ? unit.map(r => r.unit_price) : recent.map(r => r.price).filter(Boolean);
  if (!vals.length) return null;
  return { n: vals.length, min: Math.min(...vals), max: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    u: unit.length ? o.unit : '', cur: unit.length ? o.eu : o.ep, d0: (unit.length ? unit : recent)[0]?.valid_from || null };
}

function priceBar(r) {
  if (!r) return '';
  if (r.n < 3) return `<div class="pbar-few">Preisvergleich: erst ${r.n} Angebot${r.n === 1 ? '' : 'e'} erfasst – die Leiste füllt sich mit jeder Woche.</div>`;
  // zweiteilige Skala: Ø immer in der Mitte, links Tiefstpreis…Ø, rechts Ø…Höchstpreis
  const pos = v => {
    const p = v <= r.avg ? (r.avg > r.min ? 50 * (v - r.min) / (r.avg - r.min) : 50)
      : (r.max > r.avg ? 50 + 50 * (v - r.avg) / (r.max - r.avg) : 50);
    return Math.max(0, Math.min(100, p));
  };
  const cls = r.cur == null ? '' : pos(r.cur) < 40 ? 'g' : pos(r.cur) <= 60 ? 'y' : 'r';
  const unit = r.u ? `€/${esc(r.u)}` : '€';
  return `<div class="pbar" title="Strich = Durchschnitt (Ø) der erfassten Angebotspreise, Punkt = bestes aktuelles Angebot">
    <div class="pbar-track"><span class="pbar-avg" style="left:50%"></span>
      ${r.cur != null ? `<span class="pbar-dot ${cls}" style="left:${pos(r.cur)}%"></span>` : ''}</div>
    <div class="pbar-lbl"><span>${fmt(r.min)}</span><span>Ø ${fmt(r.avg)} ${unit}</span><span>${fmt(r.max)}</span></div></div>`;
}

function draftFor(cat, group) {
  const key = `${cat}|${group}`;
  if (S.draft?.key !== key) {
    const ex = findFav({ type: 'group', category: cat, group });
    S.draft = { key, cat, group, brands: new Set(ex?.brands || []), brandOnly: !!ex?.brandOnly, exists: !!ex };
  }
  return S.draft;
}

async function renderPicker(cat, group) {
  if (!S.catalog) {
    view.innerHTML = '<p class="loading">Lade Produktkatalog …</p>';
    try { await loadCatalog(); } catch { view.innerHTML = '<p class="empty">Katalog konnte nicht geladen werden.</p>'; return; }
    if (route()[0] !== 'add') return;
  }
  const live = new Set(visible().map(o => o.product_key));
  let h;
  if (!cat) {
    const cnt = countBy(S.catalog, e => e.category);
    h = `<div class="head"><h2>Favorit hinzufügen</h2></div>
      <p class="sub">Kategorie wählen, dann eine Produktgruppe – dort Marken oder einzelne Produkte auswählen.
      Der Katalog enthält alle bisher gesehenen Produkte, auch wenn sie gerade nicht im Angebot sind.</p>
      <div class="grid">${S.categories.filter(c => cnt[c]).map(c =>
      `<a class="tile" href="#/add/${enc(c)}"><span class="ico">${ICONS[c] || '📦'}</span><span class="nm">${esc(c)}</span><span class="ct">${cnt[c]} Produkte</span></a>`).join('')}</div>`;
  } else {
    // gleiche Auswahl wie unter Kategorien: Produktgruppen-Chips, darunter Marken-Chips und die Knöpfe
    const entries = S.catalog.filter(e => e.category === cat);
    const gc = countBy(entries, e => e.group);
    const d = group ? draftFor(cat, group) : null;
    h = `<div class="head"><h2>${ICONS[cat] || ''} ${esc(cat)}</h2>
      ${group ? `<a class="btn small" href="#/c/${enc(cat)}/${enc(group)}" data-act="pickView">Angebote ansehen</a>` : ''}</div>
      <p class="sub">Favorit wählen: Produktgruppe antippen, dann Marken markieren (keine Auswahl = alle Marken).</p>`;
    h += `<div class="chips wrap pick"><a class="chip ${group ? '' : 'on'}" href="#/add/${enc(cat)}">Alle <i>${entries.length}</i></a>` +
      groupsOf(cat).filter(g => gc[g]).map(g => `<a class="chip ${g === group ? 'on' : ''} ${findFav({ type: 'group', category: cat, group: g }) ? 'faved' : ''}"
        href="#/add/${enc(cat)}${g === group ? '' : '/' + enc(g)}">${esc(g)} <i>${gc[g]}</i></a>`).join('') + '</div>';
    if (group) h += `<div class="chips-sep"><span>Marken</span></div><div id="pickList">${pickList(cat, group, live)}</div>`;
    h += `<div id="pickActs">${group ? groupActions(cat, group, d.brands, d.brandOnly, ['pickFav', 'pickWish'])
      : groupActions(cat, null, new Set(), false, ['pickFav', 'pickWish'])}</div>`;
    if (group) h += `<p class="sub" id="draftInfo">${draftInfo(d)}</p>`;
  }
  view.innerHTML = h;
}

function draftInfo(d) {
  const f = { type: 'group', category: d.cat, group: d.group, brands: [...d.brands], brandOnly: d.brandOnly };
  const n = visible().filter(o => favMatch(f, o)).length;
  const b = d.brands.size ? `${d.brands.size} Marke${d.brands.size > 1 ? 'n' : ''}` : 'alle Marken';
  return `${b}${d.brandOnly ? ', nur Markenprodukte' : ''} · <b>${n}</b> Angebote aktuell`;
}

function pickList(cat, group, live) {
  const d = S.draft;
  const entries = S.catalog.filter(e => e.category === cat && e.group === group);
  const q = norm(S.pickQ.trim());
  const brands = new Map();
  for (const e of entries) {
    const b = brands.get(e.brand_key) || { key: e.brand_key, name: e.brand || 'Ohne Marke', type: e.brand_type, items: [], live: 0 };
    b.items.push(e);
    if (live.has(e.product_key)) b.live++;
    brands.set(e.brand_key, b);
  }
  // bekannte Marken und Eigenmarken, die noch in keinem Prospekt vorkamen (Treffer später über Marke oder Titel)
  for (const k of knownBrands(cat, group)) if (!brands.has(k.key)) brands.set(k.key, { ...k, items: [], live: 0, known: true });
  // gewählte Marken, die weder im Katalog noch in der Liste stehen, nicht verlieren
  for (const k of d.brands) if (!brands.has(k)) brands.set(k, { key: k, name: KNOWN_NAME.get(k) || k, type: KNOWN_RET.has(k) ? 'eigen' : 'marke', items: [], live: 0, known: true });
  let list = [...brands.values()];
  if (q) list = list.filter(b => norm(b.name).includes(q) || b.items.some(e => norm(e.name).includes(q)));
  sortBrands(list);
  // kleine Chips zum Markieren wie in der Kategorie-Ansicht (Zahl = aktuelle Angebote)
  return `<div class="chips wrap pick"><button class="chip ${d.brandOnly ? 'on' : ''}" data-act="draftBrandOnly">Nur Markenprodukte</button>` +
    list.map(b => `<button class="chip ${d.brands.has(b.key) ? 'on' : ''}" data-act="draftBrand" data-b="${esc(b.key)}">${esc(b.name)}${b.live ? ` <i>${b.live}</i>` : ''}</button>`).join('') + '</div>';
}

const catalogProductFav = e => ({
  type: 'product', brand_key: e.brand_key, brand: e.brand, tokens: e.tokens, category: e.category, group: e.group,
  label: `${e.brand} ${e.name}`.trim(), unit: e.best?.unit,
});

function updatePicker() {
  const [, cat, group] = route();
  const live = new Set(visible().map(o => o.product_key));
  $('#pickList').innerHTML = pickList(cat, group, live);
  $('#draftInfo').innerHTML = draftInfo(S.draft);
  $('#pickActs').innerHTML = groupActions(cat, group, S.draft.brands, S.draft.brandOnly, ['pickFav', 'pickWish']);
}

// Tab beim Öffnen der App (Einstellung pro Gerät); 'last' = zuletzt genutzter Tab
const START_TABS = [['', 'Kategorien'], ['all', 'Alle'], ['favs', 'Favoriten'], ['list', 'Einkaufszettel'], ['last', 'zuletzt genutzt']];

// „Mehr“: Menü mit Untermenüs (#/more/<bereich>)
const MORE_SECTIONS = [
  { id: 'gruppe', ico: '👥', title: 'Gruppe', show: () => Cloud.enabled },
  { id: 'gebiet', ico: '📍', title: 'Gebiet & Händler' },
  { id: 'filter', ico: '🔎', title: 'Filter' },
  { id: 'darstellung', ico: '🎨', title: 'Darstellung' },
  { id: 'daten', ico: '📊', title: 'Daten & Abruf' },
  { id: 'feedback', ico: '💬', title: 'Feedback', show: () => Cloud.enabled },
  { id: 'info', ico: 'ℹ️', title: 'Über die App' },
];
const FB_KINDS = [['bug', '🐞 Fehler'], ['idee', '💡 Idee'], ['sonstiges', '💬 Sonstiges']];
const FILTER_OPTS = [
  ['hideOnline', 'Nur-online-Angebote ausblenden'],
  ['onlyCurrent', 'Nur aktuell gültige (keine Vorschau auf nächste Woche)'],
];
const THEMES = [['auto', 'wie System'], ['light', 'hell'], ['dark', 'dunkel']];

// Kurzbeschreibung je Bereich für das Menü
function moreSummary(id) {
  const f = S.f;
  if (id === 'gruppe') return Cloud.group() ? `„${Cloud.group()}“ · ${Cloud.name() || 'ohne Namen'}${Cloud.isAdmin() ? ' · Admin' : ''}` : Cloud.name();
  if (id === 'gebiet') {
    const s = grpSet(), parts = [];
    if (s.home) parts.push(`${S.placeName[s.home] || s.home} ${s.radius ? s.radius + ' km' : '(ganzer Großraum)'}`);
    if (s.route?.stops?.length > 1) parts.push(`Strecke${s.route.km ? ' ' + s.route.km + ' km' : ''}`);
    return `${parts.length ? parts.join(' + ') : 'ganzer Großraum'} · ${s.retailers?.length ? s.retailers.length + ' Händler' : 'alle Händler'}`;
  }
  if (id === 'filter') {
    const parts = [];
    const na = appChips().filter(([, ks]) => !useApp({ retailer: ks[0] })).length;
    if (na) parts.push(`${na} App${na > 1 ? 's' : ''} aus`);
    if (f.hideCats.length) parts.push(`${f.hideCats.length} Kategorie${f.hideCats.length > 1 ? 'n' : ''} aus`);
    const mk = Object.values(f.markets).filter(x => x.length && x[0] !== NO_MARKET).length;
    const off = Object.values(f.markets).filter(x => x[0] === NO_MARKET).length;
    if (mk) parts.push(`Märkte bei ${mk} Händler${mk > 1 ? 'n' : ''}`);
    if (off) parts.push(`${off} Händler ohne Markt`);
    const n = FILTER_OPTS.filter(([k]) => f[k]).length;
    if (n) parts.push(`${n} Schalter`);
    return parts.join(' · ') || 'keine';
  }
  if (id === 'darstellung') return `${(THEMES.find(x => x[0] === f.theme) || THEMES[0])[1]} · Start: ${(START_TABS.find(x => x[0] === (f.startTab || '')) || START_TABS[0])[1]}`;
  if (id === 'daten') return `${S.offers.length} Angebote · Stand ${S.generated ? new Date(S.generated).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–'}`;
  if (id === 'feedback') return 'Fehler melden, Ideen und Wünsche';
  if (id === 'info') return `Anleitung je Reiter · ${window.APP_VERSION ? 'Version ' + window.APP_VERSION.number : 'Installieren'}`;
  return '';
}

// Händler mit App-/Kartenpreisen (für Mehr → Filter → Apps)
function appRetailers() {
  const has = new Set(S.offers.flatMap(o => o.variants).filter(v => v.app_price || v.app_note).map(v => v.retailer));
  return Object.keys(S.retailers).filter(k => has.has(k));
}
function appLabelOf(k) {
  const v = S.offers.flatMap(o => o.variants).find(x => x.retailer === k && x.app_label);
  return v?.app_label || `${S.retailers[k]?.name || k}-App`;
}
// eine Auswahl je App (Edeka-App gilt für Edeka und Marktkauf)
function appChips() {
  const m = new Map();
  for (const k of appRetailers()) { const l = appLabelOf(k); m.set(l, [...(m.get(l) || []), k]); }
  return [...m];
}
// Märkte je Händler im Gebiet der Gruppe (nur Händler mit mehreren Märkten)
function marketsByRetailer() {
  const m = {};
  for (const v of S.offers.flatMap(o => o.variants)) {
    if (!v.markets?.length || !inGroup(v)) continue;
    const set = m[v.retailer] ||= new Set();
    // nur Märkte, deren Ort im Gebiet liegt (Zuordnung aus der Konfiguration; unbekannte Märkte bleiben drin)
    v.markets.filter(x => !S.area || !S.marketPlaces?.[x] || S.marketPlaces[x].some(p => S.area.has(p))).forEach(x => set.add(x));
  }
  return Object.keys(S.retailers).filter(k => m[k]?.size).map(k => [k, [...m[k]].sort((a, b) => shortMarket(a).localeCompare(shortMarket(b), 'de'))]);
}
function filterPanel() {
  const f = S.f, small = 'class="muted" style="margin:2px 0 8px;font-size:.85rem"';
  const cats = Object.keys(ICONS).filter(c => S.offers.some(o => o.category === c));
  return `<div class="panel">
      ${FILTER_OPTS.map(([k, l]) => `<label class="line switch"><input type="checkbox" data-set="${k}" ${f[k] ? 'checked' : ''}> ${l}</label>`).join('')}
      <p ${small}>Händler wählst du oben über die farbigen Chips: markierte werden angezeigt, ohne Markierung alle.</p></div>
    <div class="panel"><h3>📱 Genutzte Apps & Kundenkarten</h3>
      <p ${small}>Markiert = App-Preis zählt. Sonst gilt der Normalpreis; Angebote nur mit App werden ausgeblendet.</p>
      <div class="chips wrap">${appChips().map(([l, ks]) => `<button class="chip ${useApp({ retailer: ks[0] }) ? 'on' : ''}" data-act="fApp" data-r="${ks.join(',')}">${esc(l)}</button>`).join('')}</div></div>
    <div class="panel"><h3>🗂️ Kategorien</h3>
      <p ${small}>Markiert = wird angezeigt. Antippen blendet eine Kategorie aus.</p>
      <div class="chips wrap">${cats.map(c => `<button class="chip ${f.hideCats.includes(c) ? '' : 'on'}" data-act="fCat" data-c="${esc(c)}">${ICONS[c] || ''} ${esc(c)}</button>`).join('')}</div></div>
    <div class="panel"><h3>🏪 Märkte</h3>
      <p ${small}>Händler mit Preisen je Markt. Keine Auswahl = alle Märkte im Gebiet, „Keiner“ blendet den Händler aus.</p>
      ${marketsByRetailer().map(([k, ms]) => {
        const sel = f.markets[k] || [], none = sel[0] === NO_MARKET;
        const info = none ? 'keiner' : sel.length ? `${sel.length} von ${ms.length} gewählt` : `alle ${ms.length}`;
        return `<details class="mk" ${sel.length ? 'open' : ''}><summary><b>${esc(S.retailers[k]?.name || k)}</b>
          <span class="muted">${info}</span></summary>
          <div class="chips wrap mk-all"><button class="chip ${!sel.length ? 'on' : ''}" data-act="fMkAll" data-r="${k}" data-v="all">Alle</button>
            <button class="chip ${none ? 'on' : ''}" data-act="fMkAll" data-r="${k}" data-v="none">Keiner</button></div>
          ${ms.length > 1 ? ms.map(m => `<label class="line switch"><input type="checkbox" data-fmarket="${k}" value="${esc(m)}" ${sel.includes(m) ? 'checked' : ''}> ${esc(shortMarket(m))}</label>`).join('')
            : `<p class="muted" style="margin:2px 0 4px;font-size:.85rem">${esc(shortMarket(ms[0]))}</p>`}</details>`;
      }).join('') || '<p class="muted">Keine Händler mit einzelnen Märkten im Gebiet.</p>'}</div>`;
}

// persönliche Filter gespeichert: Preise neu wählen, Mehr-Seite neu zeichnen (Scrollposition bleibt)
function filtersChanged() {
  save('filters', S.f);
  pushCtxSave();
  applyEff();
  updateBadges();
  const y = window.scrollY;
  rerender();
  window.scrollTo(0, y);
}

function morePanel(id) {
  const f = S.f;
  if (id === 'gruppe') return `<div class="panel">
      <label class="line">Dein Name <input class="filter-input" style="margin:0;width:auto;flex:1;min-width:0" data-set-name value="${esc(Cloud.name())}" placeholder="z.B. Anna"></label>
      <p class="muted" style="margin:4px 0 8px;font-size:.85rem">Erscheint beim Einkaufszettel als „von …“ bei den anderen.
        Deine Favoriten werden zwischen allen Geräten mit demselben Namen abgeglichen.</p>
      <div id="groupAdmin"></div>
      <button class="btn small" data-act="logout">Gruppen-Code auf diesem Gerät entfernen</button></div>`;
  if (id === 'gebiet') return areaPanel();
  if (id === 'filter') return filterPanel();
  if (id === 'darstellung') return `<div class="panel">
      <label class="line">Farbschema <select data-set="theme">
        ${THEMES.map(([k, l]) => `<option value="${k}" ${f.theme === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="line">Start-Tab <select data-set="startTab">
        ${START_TABS.map(([k, l]) => `<option value="${k}" ${(f.startTab || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${pushAvailable() ? `<label class="line switch"><input type="checkbox" data-push ${load('push', false) && Notification.permission === 'granted' ? 'checked' : ''}>
        🔔 Benachrichtigung bei neuen Favoriten-Angeboten</label>
        <p class="muted" style="margin:0 0 4px;font-size:.85rem">Nach dem Abruf (5 und 14 Uhr) zählt die App neue Angebote deiner Favoriten und zeigt sie als Hinweis bzw. Zahl am App-Symbol.</p>` : ''}
    </div>`;
  if (id === 'daten') {
    const counts = countBy(S.offers.flatMap(o => o.variants), o => o.retailer);
    return `<div class="panel">
      <p style="margin:0 0 8px">${S.offers.length} Angebote · Stand ${S.generated ? new Date(S.generated).toLocaleString('de-DE') : '–'}</p>
      <p class="muted" style="margin:0 0 8px;font-size:.85rem">${Object.entries(S.retailers).map(([k, r]) => `${esc(r.name)} ${counts[k] || 0}`).join(' · ')}</p>
      ${DATA.server ? '' : '<p class="muted" style="margin:0 0 8px;font-size:.85rem">Die Angebote werden täglich um 5 und 14 Uhr automatisch abgerufen.</p>'}
      <div id="status"><p class="muted">Status wird geladen …</p></div>
    </div>${Cloud.enabled && Cloud.isAdmin() ? '<div class="panel" id="usage"><h3>📈 Kontingent (Free Tier)</h3><p class="muted">wird geladen …</p></div>' : ''}`;
  }
  if (id === 'feedback') {
    const d = load('fbDraft', { kind: 'bug', text: '' });
    return `<div class="panel">
      <p class="muted" style="margin:0 0 8px;font-size:.85rem">Was klappt nicht, was fehlt? Der Text geht direkt an den Entwickler (nicht an die Gruppe).</p>
      <div class="chips wrap" style="margin-bottom:8px">${FB_KINDS.map(([k, l]) =>
        `<button class="chip ${d.kind === k ? 'on' : ''}" data-act="fbKind" data-k="${k}">${l}</button>`).join('')}</div>
      <textarea id="fbText" class="fb-text" maxlength="4000" rows="6" placeholder="${d.kind === 'bug' ? 'Was ist passiert? Wo in der App?' : 'Beschreibe kurz deine Idee …'}">${esc(d.text)}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn primary" data-act="fbSend">Senden</button></div>
    </div>`;
  }
  if (id === 'info') return `<div class="panel"><h3>📖 Anleitung</h3>
      <p class="muted" style="margin:0 0 8px">Abschnitt antippen zum Aufklappen.</p>${guideHtml()}
      <button class="btn small" data-act="wizShow" style="margin-top:10px">Einführung noch einmal ansehen</button></div>
    <div class="panel"><h3>Version</h3>${appVersionLine()}</div>
    <div class="panel"><h3>Als App installieren</h3>
      <p class="muted" style="margin:0;font-size:.88rem">Android/Chrome: Menü ⋮ → „App installieren“.
      iPhone/Safari: Teilen → „Zum Home-Bildschirm“.</p>
    </div>`;
  return '';
}

function renderMore(sub) {
  S.areaDraft = null;
  const secs = MORE_SECTIONS.filter(s => !s.show || s.show());
  const sec = secs.find(s => s.id === sub);
  if (!sec) {
    view.innerHTML = `<div class="head"><h2>⚙️ Einstellungen & Daten</h2></div>
      <nav class="more-menu">${secs.map(s => `<a class="more-item" href="#/more/${s.id}">
        <span class="mi-ico">${s.ico}</span><span class="mi-txt"><b>${s.title}</b><small>${esc(moreSummary(s.id))}</small></span>
        <span class="mi-go">›</span></a>`).join('')}</nav>`;
    return;
  }
  view.innerHTML = `<div class="head more-head"><a class="more-back" href="#/more">‹ Mehr</a>
      <h2 class="more-title">${sec.ico} ${sec.title}${sec.id === 'gruppe' && Cloud.group() ? ` „${esc(Cloud.group())}“` : ''}</h2></div>
    <div class="more-sub">${morePanel(sec.id)}</div>`;
  if (sec.id === 'daten') loadStatus();
  if (sec.id === 'gruppe' && Cloud.loggedIn()) loadGroup();
}

// Version und Zeitpunkt der veröffentlichten App (config.js, von tools/deploy_pages.py geschrieben)
function appVersionLine() {
  const v = window.APP_VERSION;
  if (!v) return '<p class="muted" style="margin:0;font-size:.88rem">Lokale Fassung vom PC (start.bat)</p>';
  const d = new Date(v.built).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  return `<p style="margin:0">Version <b>${esc(v.number)}</b> · aktualisiert am ${esc(d)} Uhr</p>`;
}

function renderStatus() {
  const el = $('#status');
  const s = S.status;
  if (!el || !s) return;
  const run = s.fetch.running;
  el.innerHTML = `<table class="runs">${(s.runs || []).map(r => `<tr>
      <td><b>${esc(r.source)}</b></td>
      <td>${r.ok ? '<span class="ok">OK</span>' : '<span class="err">Fehler</span>'} ${r.count ?? ''}</td>
      <td class="muted">${r.finished_at ? new Date(r.finished_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : ''}</td></tr>
      ${r.error ? `<tr><td colspan="3" class="err" style="font-weight:400;font-size:.8rem">${esc(r.error)}</td></tr>` : ''}`).join('')}</table>
    ${DATA.server ? `<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn primary" data-act="refresh" ${run ? 'disabled' : ''}>${run ? 'Abruf läuft …' : 'Jetzt aktualisieren'}</button>
      ${run ? `<span class="muted">${esc(s.fetch.current || '')}</span>` : ''}</div>`
      : s.uploaded_at ? `<p class="muted" style="margin:8px 0 0;font-size:.85rem">Hochgeladen ${new Date(s.uploaded_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</p>` : ''}
    ${s.log?.length && run ? `<pre class="log">${esc(s.log.slice(-25).join('\n'))}</pre>` : ''}`;
}

/* ---------- Kontingent (nur Admins): Verbrauch gegen die kostenlosen Tarife, Monatsschätzung, Ausbau-Spielraum ---------- */

// Grenzen der kostenlosen Tarife (Stand 2026 – bei Tarifänderungen hier anpassen)
const FREE = {
  ghMinutes: 2000,       // GitHub Actions, privates Repo, Minuten/Monat
  dbMB: 500,             // Supabase Datenbank
  egressGB: 5,           // Supabase Datenverkehr (ausgehend) je Monat
  pagesGB: 100,          // GitHub Pages Bandbreite je Monat (weiche Grenze)
};
const USAGE_SAFETY = 0.8;  // Ausbau nur bis 80 % der Grenze rechnen
const mb = b => b / 1048576;
function usageBar(label, used, limit, unit, note) {
  const pct = Math.min(100, Math.round(used / limit * 100));
  const cls = pct >= 80 ? 'r' : pct >= 50 ? 'y' : 'g';
  const f = v => v >= 100 ? Math.round(v).toLocaleString('de-DE') : fmt(v).replace(/,00$/, '');
  return `<div class="ubar"><div class="ubar-h"><b>${label}</b><span>${f(used)} / ${f(limit)} ${unit} · ${pct} %</span></div>
    <div class="ubar-t"><i class="${cls}" style="width:${Math.max(pct, 1)}%"></i></div>${note ? `<small>${note}</small>` : ''}</div>`;
}
async function renderUsage() {
  const el = $('#usage');
  if (!el) return;
  let db = null;
  try { db = await Cloud.adminUsage(); } catch (err) { db = { error: err.message }; }
  const u = S.status?.usage || {};
  const gh = u.github, days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const places = u.places || S.places.length || 1;
  let h = '<h3>📈 Kontingent (Free Tier)</h3>';
  // GitHub Actions: je Tag 2 Abrufe (auf volle Minuten gerundet) + 4 kurze Zeitprüfungen à 1 Minute
  let ghMonth = null, ghPlaces = null;
  if (gh?.avg_fetch_min) {
    const perDay = 2 * Math.ceil(gh.avg_fetch_min) + 4;
    ghMonth = perDay * days;
    // Laufzeit wächst etwa mit der Zahl der Orte (Märkte je Ort); Rest (Einrichtung, Upload) ca. 1 Minute
    const perPlace = Math.max(gh.avg_fetch_min - 1, 0.5) / places;
    const maxFetch = Math.min((FREE.ghMinutes * USAGE_SAFETY / days - 4) / 2, 28);  // Job-Zeitlimit 30 Min.
    ghPlaces = Math.floor((Math.floor(maxFetch) - 1) / perPlace);
    h += usageBar('GitHub Actions', gh.minutes, FREE.ghMinutes, 'Min.',
      `${gh.fetches} Abrufe im ${gh.month} (Ø ${fmt(gh.avg_fetch_min)} Min.) · Schätzung voller Monat ≈ ${ghMonth} Min.`);
  } else h += '<p class="muted">GitHub-Verbrauch erscheint nach dem nächsten Abruf.</p>';
  // Supabase Datenbank
  if (db && !db.error) {
    const top = (db.tables || []).slice(0, 3).map(t => `${esc(t.name)} ${fmt(mb(t.bytes))} MB`).join(' · ');
    h += usageBar('Supabase Datenbank', mb(db.db_bytes), FREE.dbMB, 'MB', top);
  } else if (db?.error) h += `<p class="err">Supabase-Verbrauch nicht abrufbar: ${esc(db.error)}</p>`;
  // Datenverkehr: jedes aktive Gerät lädt Angebote + Katalog nach jedem Upload (≈ 2x täglich) einmal komprimiert
  let devPlaces = null, perDev = null;
  if (u.offers && db && !db.error) {
    perDev = mb(u.offers.gz + u.catalog.gz) * 2 * days;             // MB je Gerät und Monat
    const active = Math.max(db.active_30d, 1);
    const egress = perDev * active / 1024;
    h += usageBar('Supabase Datenverkehr (Schätzung)', egress, FREE.egressGB, 'GB',
      `${active} aktive Geräte (30 Tage) × ≈ ${fmt(perDev)} MB/Monat · Download je Aktualisierung ${fmt(mb(u.offers.gz + u.catalog.gz))} MB (gzip)`);
    // Datenmenge wächst höchstens mit den Orten (bundesweite Discounter bleiben gleich) -> vorsichtig linear
    devPlaces = Math.floor(FREE.egressGB * 1024 * USAGE_SAFETY / (perDev * active) * places);
  }
  h += usageBar('GitHub Pages (App-Dateien)', 0.05 * Math.max(db?.active_30d || 1, 1), FREE.pagesGB, 'GB',
    'grobe Schätzung: App-Updates ca. 50 MB je Gerät und Monat – unkritisch');
  // Ausbau-Spielraum
  if (ghPlaces || devPlaces) {
    const lim = [ghPlaces && `GitHub-Minuten ≈ ${ghPlaces} Orte`, devPlaces && `Datenverkehr ≈ ${devPlaces} Orte bei ${db.active_30d || 1} Geräten`].filter(Boolean);
    const maxDev = perDev ? Math.floor(FREE.egressGB * 1024 * USAGE_SAFETY / perDev) : null;
    h += `<div class="u-out"><b>Ausbau-Spielraum</b> (bis ${USAGE_SAFETY * 100} % der Grenzen, heute ${places} Orte, ${u.count || S.offers.length} Angebote):
      <ul><li>${lim.join('</li><li>')}</li>${maxDev ? `<li>bei heutigem Gebiet ≈ ${maxDev} aktive Geräte</li>` : ''}</ul>
      <small>Engpass ist meist die Abrufzeit (Märkte je Ort). Mehr Geräte kosten nur Datenverkehr.</small></div>`;
  }
  if (db && !db.error) h += `<p class="muted" style="margin:6px 0 0;font-size:.8rem">${db.groups} Gruppe${db.groups === 1 ? '' : 'n'} · ${db.devices} Geräte · ${db.push_subs} mit Benachrichtigung</p>`;
  el.innerHTML = h;
}

async function loadStatus() {
  clearTimeout(S.poll);
  try {
    S.status = await DATA.status();
  } catch {
    const el = $('#status');
    if (el) el.innerHTML = `<p class="err">${DATA.server ? 'Server' : 'Supabase'} nicht erreichbar – angezeigt wird der zuletzt gespeicherte Stand.</p>`;
    return;
  }
  renderStatus();
  renderUsage();
  if (S.status.fetch.running) {
    S.wasRunning = true;
    S.poll = setTimeout(loadStatus, 2500);
  } else if (S.wasRunning) {
    S.wasRunning = false;
    await loadData();
    toast('Angebote aktualisiert');
  }
}

/* ---------- Detailansicht ---------- */

function openSheet(html) {
  const sheet = $('#sheet');
  $('.sheet-body', sheet).innerHTML = html;
  if (!S.sheetOpen) {
    S.sheetOpen = true;
    sheet.hidden = false;
    history.pushState({ sheet: true }, '');
    $('.sheet-body', sheet).scrollTop = 0;
  }
}
function hideSheet() {
  S.sheetOpen = false;
  S.replaceFor = null;
  S.sheetId = null;
  $('#sheet').hidden = true;
}
function closeSheet() {
  if (S.sheetOpen) history.back(); // popstate blendet aus
}

// Fenster nach unten wegwischen: nur wenn der Inhalt ganz oben steht (sonst wird normal gescrollt);
// ab ca. einem Viertel der Höhe oder bei schnellem Wisch schließen, sonst zurückfedern. Maus: am Griffstrich.
(() => {
  const body = $('.sheet-body'), backdrop = $('.sheet-backdrop');
  let st = null;
  const reset = () => { body.style.transform = ''; backdrop.style.opacity = ''; };
  const start = (x, y) => { if (S.sheetOpen) st = { x, y, t: Date.now(), dy: 0, active: false, top: body.scrollTop <= 0 }; };
  const move = (x, y, e) => {
    if (!st) return;
    const dy = y - st.y, dx = x - st.x;
    if (!st.active) {
      if (!st.top || dy < -6 || Math.abs(dx) > Math.max(8, dy)) { st = null; return; }
      if (dy < 10) return;
      st.active = true;
      body.style.transition = backdrop.style.transition = 'none';
    }
    st.dy = Math.max(0, dy - 10);
    body.style.transform = `translateY(${st.dy}px)`;
    backdrop.style.opacity = String(Math.max(0.2, 1 - st.dy / body.offsetHeight));
    if (e?.cancelable) e.preventDefault();  // kein Scrollen/Neuladen der Seite während des Wischens
  };
  const end = () => {
    if (!st) return;
    const s = st;
    st = null;
    if (!s.active) return;
    body.style.transition = 'transform .2s ease';
    backdrop.style.transition = 'opacity .2s ease';
    const fast = s.dy > 40 && Date.now() - s.t < 300;
    if (s.dy > Math.min(160, body.offsetHeight * 0.25) || fast) {
      body.style.transform = 'translateY(100%)';
      backdrop.style.opacity = '0';
      setTimeout(() => { closeSheet(); setTimeout(() => { body.style.transition = backdrop.style.transition = ''; reset(); }, 50); }, 180);
    } else {
      reset();
      setTimeout(() => { body.style.transition = backdrop.style.transition = ''; }, 220);
    }
  };
  body.addEventListener('touchstart', e => start(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  body.addEventListener('touchmove', e => move(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
  body.addEventListener('touchend', end);
  body.addEventListener('touchcancel', end);
  body.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || !e.target.closest('.grab')) return;
    e.preventDefault();
    start(e.clientX, e.clientY);
    const mm = ev => move(ev.clientX, ev.clientY);
    const mu = () => { end(); window.removeEventListener('pointermove', mm); window.removeEventListener('pointerup', mu); };
    window.addEventListener('pointermove', mm);
    window.addEventListener('pointerup', mu);
  });
})();

// Detailansicht: alle Varianten (Händler, Preis mit/ohne App, Märkte)
const shortMarket = m => { const p = m.split(',').map(x => x.trim()); return p.length > 2 ? `${p[0]}, ${p[p.length - 1]}` : m; };
function variantRows(o) {
  const vs = [...o.variants].sort((a, b) => (effOf(a)?.ep ?? 1e9) - (effOf(b)?.ep ?? 1e9));
  return vs.map(v => {
    const e = effOf(v), ok = passOne(v);
    const pr = v.app_price
      ? `📱 ${fmt(v.price)} €${v.regular_price ? ` · ohne App ${fmt(v.regular_price)} €` : ''}`
      : `${fmt(v.price)} €`;
    const mk = v.markets?.length ? `${v.markets.slice(0, 4).map(m => esc(shortMarket(m))).join('<br>')}${v.markets.length > 4 ? `<br>+ ${v.markets.length - 4} weitere` : ''}` : '';
    return `<div class="${ok && e ? '' : 'v-off'}"><span>${esc(S.retailers[v.retailer]?.name || v.retailer)}</span>
      <span><b>${pr}</b>${mk ? `<br><small>${mk}</small>` : ''}</span></div>`;
  }).join('');
}

async function openDetail(id) {
  const o = S.byId.get(id);
  if (!o) return;
  S.replaceFor = null;
  S.sheetId = id;
  const r = S.retailers[o.retailer] || { name: o.retailer, color: '#888' };
  const d = disc(o), old = oldPrice(o);
  const places = o.places.map(p => S.placeName[p] || p);
  const gFav = findFav({ type: 'group', category: o.category, group: o.group });
  const valid = [o.valid_from && `ab ${dshort(o.valid_from)}`, o.valid_to && `bis ${dshort(o.valid_to)}`].filter(Boolean).join(' ') || 'k. A.';
  openSheet(`<div class="grab"></div>
    <div class="detail-img">${o.image ? `<img referrerpolicy="no-referrer" src="${esc(o.image)}" alt="">` : ICONS[o.category] || '📦'}</div>
    <div class="detail-title">
      <div class="meta"><span class="rt" style="--c:${r.color}">${esc(r.name)}</span>${o.brand ? `<span class="brand">${esc(o.brand)}</span>` : ''}
        ${o.brand_type === 'eigen' ? '<span class="tag">Handelsmarke</span>' : ''}</div>
      <h2>${esc(o.name || o.title)}</h2>
      ${o.description ? `<p class="muted" style="margin:4px 0 0">${esc(o.description)}</p>` : ''}
    </div>
    ${detailPrices(o, old, d)}
    <div class="kv">
      <div><span>Gültig</span><span>${valid}</span></div>
      ${o.size ? `<div><span>Packung</span><span>${esc(o.size)}${o.unit_approx ? ' (Grundpreis „ab“ = größte Packung)' : ''}</span></div>` : ''}
      <div><span>Einordnung</span><span><a href="#/c/${enc(o.category)}/${enc(o.group)}" data-act="goto">${esc(o.category)} › ${esc(o.group)}</a></span></div>
      ${o.variants.length > 1 ? variantRows(o) : o.markets?.length ? `<div><span>Märkte</span><span>${o.markets.slice(0, 8).map(esc).join('<br>')}${o.markets.length > 8 ? `<br>+ ${o.markets.length - 8} weitere` : ''}</span></div>` : ''}
      <div><span>Orte</span><span>${places.length >= S.places.length ? 'alle Orte der Strecke' : esc(places.join(', '))}</span></div>
      ${o.online_only ? '<div><span>Hinweis</span><span>nur online erhältlich</span></div>' : ''}
    </div>
    <div class="actions">
      <button class="btn ${isProductFav(o) ? 'on' : ''}" data-act="star" data-id="${esc(o.id)}">${isProductFav(o) ? '★' : '☆'} Produkt merken</button>
      ${o.brand ? `<button class="btn" data-act="favBrandGroup" data-id="${esc(o.id)}">☆ ${esc(o.brand)} in ${esc(o.group)}</button>` : ''}
      <button class="btn ${gFav ? 'on' : ''}" data-act="favGroup" data-id="${esc(o.id)}">${gFav ? '★' : '☆'} ${esc(o.group === OTHER ? o.category : o.group)}</button>
      <button class="btn ${inList(o) ? 'on' : ''}" data-act="add" data-id="${esc(o.id)}">＋ Einkaufszettel</button>
      ${Li.isPrioOffer(o) ? '' : `<button class="btn" data-act="addPrio" data-id="${esc(o.id)}">❗ Wichtig auf den Zettel</button>`}
    </div>
    <div class="hist" id="hist"><p class="muted">Preisverlauf wird geladen …</p></div>`);
  try {
    const rows = await DATA.history(o.product_key);
    if (S.sheetId === id) renderHistory(o, rows);
  } catch {
    const el = $('#hist');
    if (el) el.innerHTML = '';
  }
}

// Preisblock der Detailansicht: Angebotspreis und – getrennt – App-/Kartenpreis mit Grundpreis und Ersparnis
function detailPrices(o, old, d) {
  const np = normalPrice(o), nu = normalUnit(o);
  const src = o.unit_price ? (o.unit_price_source === 'quelle' ? 'Grundpreis lt. Händler' : 'Grundpreis berechnet') : 'kein Grundpreis';
  const unit = u => u != null ? `${fmt(u)} €/${esc(o.unit)}` : '';
  let h = `<div class="prices2">
    <div class="pcol"><small>Angebotspreis</small>
      <b>${np != null ? fmt(np) + ' €' : '–'}</b>
      <small>${np != null ? unit(nu) : 'nicht angegeben'}</small></div>`;
  if (o.app_price) {
    const save = np != null ? np - o.price : null;
    h += `<div class="pcol app"><small>📱 mit ${esc(appName(o))}${o.app_note ? ` · ${esc(o.app_note)}` : ''}</small>
      <b>${fmt(o.price)} €</b><small>${unit(o.unit_price)}${save > 0.004 ? ` · spart ${fmt(save)} € (${Math.round(100 * save / np)}%)` : ''}</small></div>`;
  }
  // Regulärer Preis: Streichpreis des Händlers, sonst aus dem Rabatt errechnet (Edeka nennt nur „−25 %“)
  const base = np ?? o.price;
  const reg = old ?? (o.discount > 0 && o.discount < 90 ? Math.round(base / (1 - o.discount / 100) * 100) / 100 : null);
  if (reg != null || !o.app_price) {
    const regUnit = reg != null && o.unit_price ? Math.round(reg * o.unit_price / o.price * 100) / 100 : null;
    const saving = reg != null ? reg - base : 0;
    h += `<div class="pcol reg"><small>Regulärer Preis</small>
      <b>${reg != null ? `${old == null ? 'ca. ' : ''}${fmt(reg)} €` : '–'}</b>
      <small>${reg != null ? `${unit(regUnit)}${saving > 0.004 ? ` · Angebot spart ${fmt(saving)} €` : ''}` : 'vom Händler nicht angegeben'}</small></div>`;
  }
  // drei Preise (Angebot, App, regulär): waagerecht wischbar, der dritte schaut rechts herein
  if (o.app_price && reg != null) h = h.replace('<div class="prices2">', '<div class="prices2 prices-scroll">');
  h += `</div><p class="sub" style="margin:0">${src}${d && d > 0 ? ` · <span class="tag red">−${d}%</span>` : ''}
    ${o.app_price && !useApp(o) ? ' · App-Preise werden laut Einstellung nicht berücksichtigt' : ''}</p>`;
  if (!o.app_price && o.app_note) h += `<p class="hint">📱 ${esc(appName(o))}: ${esc(o.app_note)}</p>`;
  return h;
}

function renderHistory(o, rows) {
  const el = $('#hist');
  if (!el) return;
  const same = rows.filter(r => r.unit_price && r.unit === o.unit);
  if (rows.length <= 1) {
    el.innerHTML = '<h3>Preisverlauf</h3><p class="muted">Erstes erfasstes Angebot dieses Produkts – der Verlauf füllt sich mit jeder Woche.</p>';
    return;
  }
  const val = r => same.length ? r.unit_price : r.price;
  const pool = same.length ? same : rows;
  const best = pool.reduce((a, b) => (val(b) < val(a) ? b : a));
  const cur = same.length ? o.eu : o.ep;
  const bestTxt = `${fmt(val(best))} ${same.length ? '€/' + esc(o.unit) : '€'} bei ${esc(S.retailers[best.retailer]?.name || best.retailer)} (${dshort(best.valid_from)})`;
  let hint;
  if (cur <= val(best) + 0.001) hint = '👍 Aktuell der günstigste bisher erfasste Preis.';
  else {
    const pct = Math.round((cur / val(best) - 1) * 100);
    hint = `Bisher bestes Angebot: ${bestTxt} – aktuell ${pct}% teurer. Wenn du es nicht sofort brauchst, lohnt sich evtl. warten.`;
  }
  el.innerHTML = `<h3>Preisverlauf</h3>${priceBar(rowsRange(o, rows))}<p class="hint" style="margin:6px 0">${hint}</p>
    <table>${rows.slice(-12).reverse().map(r => `<tr><td>${dshort(r.valid_from)}</td><td>${esc(S.retailers[r.retailer]?.name || r.retailer)}</td>
      <td style="text-align:right">${fmt(r.price)} €</td><td style="text-align:right" class="muted">${r.unit_price ? fmt(r.unit_price) + ' €/' + esc(r.unit) : ''}</td></tr>`).join('')}</table>`;
}

/* ---------- Routing & Rendern ---------- */

function route() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

function render() {
  const r = route();
  const tab = ['favs', 'add'].includes(r[0]) ? 'favs' : ['list', 'more', 'all'].includes(r[0]) ? r[0] : 'browse';
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  $('#back').hidden = !(S.q || r[0] === 'c' || r[0] === 'add');
  const noTop = tab === 'list' || tab === 'more' || !!S.wizard;  // Suche und Händler-Filter spielen auf Zettel und Einstellungen keine Rolle
  $('header.top').hidden = noTop;
  document.body.classList.toggle('no-top', noTop);
  document.body.classList.toggle('wizard', !!S.wizard);
  if (!S.loaded) return;
  if (S.wizard) { renderWizard(); syncDepth(); return; }
  if (tab === 'browse') {
    if (S.q) renderSearch();
    else if (r[0] === 'c' && r[1]) renderCategory(r[1], r[2]);
    else renderHome();
  } else if (r[0] === 'add') renderPicker(r[1], r[2]);
  else if (tab === 'favs') renderFavs();
  else if (tab === 'list') renderShop();
  else if (tab === 'all') renderAll();
  else renderMore(r[1]);
  updateBadges();
  syncDepth();
}

// Position in „Kategorien“ und „Alle“ merken (nur im Speicher, also bis zum Neustart der App):
// Unterseite, Suche, Filter, geladene Menge und Scrollposition
const tabOf = hash => {
  const r = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return r[0] === 'all' ? 'all' : !r[0] || r[0] === 'c' ? 'browse' : null;
};
const tabMem = {};
let lastHash = location.hash || '#/', restoring = null;

// Seitenwechsel ersetzen den aktuellen Verlaufseintrag (kein Zurückblättern durch frühere Tabs). Der Verlauf besteht
// nur aus einem Basis-Eintrag und dem App-Eintrag darüber (plus ggf. Detailfenster); Zurück landet auf dem Basis-
// Eintrag und die App geht von dort eine Ebene höher – auf der obersten Ebene eines Tabs wird sie beendet.
function nav(hash) {
  if ((location.hash || '#/') === hash) { onRoute(); return; }
  history.replaceState(history.state, '', hash);
  onRoute();
}

function parentOf(hash) {
  const r = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (r[0] === 'c') return r.length > 2 ? `#/c/${enc(r[1])}` : '#/';
  if (r[0] === 'add') return r.length > 1 ? '#/' + ['add', ...r.slice(1, -1)].map(enc).join('/') : '#/favs';
  if (r[0] === 'more' && r[1]) return '#/more';
  return null;
}

// eine Ebene höher; false = schon oben
function goUp() {
  if (S.wizard) { if (S.wizard.step > 0) { S.wizard.step--; render(); } return true; }
  if (S.q) { clearSearch(); return true; }
  const up = parentOf(location.hash || '#/');
  if (up == null) return false;
  nav(up);
  return true;
}

let popping = false, silentBack = null;
// Tiefe des Verlaufs an die Seite anpassen: oberste Ebene = nur der Basis-Eintrag (Zurück beendet die App),
// darunter ein zusätzlicher Eintrag, den Zurück abfängt
function syncDepth() {
  if (S.sheetOpen || silentBack) return;
  const deep = !!(S.q || S.wizard?.step || parentOf(location.hash || '#/'));
  if (deep && history.state?.base) history.pushState({ app: true }, '', location.href);
  else if (!deep && history.state?.app) { silentBack = location.href; popping = true; history.back(); }
}

function initHistory() {
  history.replaceState({ base: true }, '', location.href);
  window.addEventListener('popstate', e => {
    if (silentBack) {  // von syncDepth ausgelöst: nur auf den Basis-Eintrag zurück, Seite bleibt
      history.replaceState({ base: true }, '', silentBack);
      silentBack = null;
      setTimeout(() => { popping = false; }, 0);
      return;
    }
    if (S.sheetOpen) {  // Detailfenster schließen (hatte einen eigenen Eintrag)
      hideSheet();
      if (S.afterSheet) { const h = S.afterSheet; S.afterSheet = null; nav(h); }
      return;
    }
    if (!e.state?.base) return;
    // Zurück von einer tieferen Ebene: eine Ebene hoch
    popping = true;
    history.replaceState({ base: true }, '', lastHash);
    setTimeout(() => { popping = false; }, 0);
    if (!goUp()) render();
  });
}

function onRoute() {
  const old = tabOf(lastHash);
  if (old) tabMem[old] = { hash: lastHash, y: window.scrollY, limit: S.limit, allFrom: S.allFrom, brands: S.brands, brandOnly: S.brandOnly,
    q: S.q, qFacet: S.qFacet, qBrands: new Set(S.qBrands), showWeak: S.showWeak };
  lastHash = location.hash || '#/';
  const top = route()[0];
  if (!top || ['c', 'all', 'favs', 'list'].includes(top)) save('lastTab', top === 'c' ? '' : top || '');
  const m = restoring && restoring.hash === lastHash ? restoring : null;
  restoring = null;
  S.limit = m?.limit || 60;
  S.allFrom = m?.allFrom || 0;
  S.brands = m?.brands || new Set();
  S.brandOnly = m?.brandOnly || false;
  if (S.carry) { S.brands = S.carry.brands; S.brandOnly = S.carry.brandOnly; S.carry = null; }  // aus der Favoriten-Auswahl
  S.pickOpen = null;
  S.pickQ = '';
  const r = route();
  if (m?.q) {
    Object.assign(S, { q: m.q, qFacet: m.qFacet, qBrands: m.qBrands, showWeak: m.showWeak });
    qInput.value = m.q;
    $('#clearQ').hidden = false;
  } else if (S.q && r[0] && r[0] !== 'c') clearSearch(false);
  render();
  window.scrollTo(0, m?.y || 0);
}

// Tab-Leiste: zurück an die gemerkte Stelle, erneutes Tippen im selben Tab führt wie bisher zum Anfang
document.querySelector('.tabs').addEventListener('click', e => {
  const a = e.target.closest('a[data-tab]');
  const t = a && (a.dataset.tab === 'browse' ? 'browse' : a.dataset.tab === 'all' ? 'all' : null);
  const m = t && tabMem[t];
  if (!m || tabOf(location.hash || '#/') === t) return;
  e.preventDefault();
  restoring = m;
  nav(m.hash);
});

function renderChips() {
  // nur Händler der Gruppe, die im Umkreis Angebote haben
  const present = new Set(S.offers.flatMap(o => o.variants).filter(o => !S.area || !o.places.length || o.places.some(p => S.area.has(p))).map(o => o.retailer));
  $('#retailerChips').innerHTML = Object.entries(S.retailers).filter(([k]) => present.has(k) && (!S.grpRet || S.grpRet.includes(k))).map(([k, r]) =>
    `<button class="chip ${S.f.only.includes(k) ? 'sel' : ''}" data-act="rt" data-r="${k}" style="--c:${r.color}"><span class="dot"></span>${esc(r.name)}</button>`
  ).join('');
}

function updateBadges() {
  if (!S.loaded) return;
  // Favoriten mit aktuellem Angebot (immer sichtbar, nicht nur neue)
  const now = visible().filter(o => !o.upcoming);
  const onOffer = S.favs.filter(f => now.some(o => favMatch(f, o))).length;
  const fb = $('#favBadge');
  fb.hidden = !onOffer;
  fb.textContent = onOffer;
  const open = Li.openCount();
  const lb = $('#listBadge');
  lb.hidden = !open;
  lb.textContent = open;
}

function applyTheme() {
  if (S.f.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = S.f.theme;
}

// App geht in den Hintergrund: aktuellen Stand für Push-Zählung sichern; zurück im Vordergrund: Zähler am Symbol löschen
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pushCtxSave(); else if (S.loaded) pushClearBadge();
});

// Hinweisleiste; optional mit Aktion (z.B. { label: 'Rückgängig', fn }), dann länger sichtbar
function toast(msg, action) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { t.hidden = true; action.fn(); };
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, action ? 5000 : 2200);
}

// „Alle“: Schnellwahl klebt unter dem Kopf (Höhe als CSS-Variable) und zeigt die Kategorie an der aktuellen Stelle
new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', $('header.top').offsetHeight + 'px'))
  .observe($('header.top'));
function allMark() {
  const bar = $('.all-jump');
  if (!bar) return;
  const line = $('header.top').offsetHeight + bar.offsetHeight + 12;
  let cur = null;
  for (const h of document.querySelectorAll('.cat-head')) { if (h.getBoundingClientRect().top <= line) cur = h.dataset.cat; else break; }
  for (const b of bar.children) {
    const on = b.dataset.c === cur;
    if (on && !b.classList.contains('on')) bar.scrollTo({ left: b.offsetLeft - 16, behavior: 'smooth' });
    b.classList.toggle('on', on);
  }
}
// Knopf „nach oben“ ab etwas Scrollweg; in „Alle“ auch zurück an den Listenanfang
const toTop = $('#toTop');
const toTopUpdate = () => {
  const r = route()[0];
  toTop.hidden = r === 'add' || (window.scrollY < 700 && !(r === 'all' && S.allFrom));
};
window.addEventListener('scroll', () => { toTopUpdate(); allMark(); }, { passive: true });
window.addEventListener('hashchange', () => setTimeout(toTopUpdate, 0));
toTop.addEventListener('click', () => {
  if (route()[0] === 'all' && S.allFrom) { S.allFrom = 0; S.limit = 60; render(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Endlos-Liste: „Weitere“-Knöpfe (data-auto) lösen selbst aus, sobald sie beim Scrollen in die Nähe kommen
let autoBusy = false;
function autoMore() {
  if (autoBusy) return;
  const b = [...document.querySelectorAll('[data-auto]')].find(x => x.getBoundingClientRect().top < window.innerHeight + 800);
  if (!b) return;
  autoBusy = true;
  setTimeout(() => { b.click(); autoBusy = false; }, 0);
}
window.addEventListener('scroll', autoMore, { passive: true });
new MutationObserver(() => { if (document.querySelector('[data-auto]')) setTimeout(autoMore, 50); })
  .observe(document.body, { childList: true, subtree: true });

function rerender() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
  if (S.sheetOpen && S.sheetId) openDetail(S.sheetId);
}

/* ---------- Ereignisse ---------- */

const onClick = {
  open: el => openDetail(el.dataset.id),
  star: el => { toggleProductFav(S.byId.get(el.dataset.id)); rerender(); },
  add: el => { Li.toggleOffer(S.byId.get(el.dataset.id)); rerender(); },
  addPrio: el => { Li.toggleOffer(S.byId.get(el.dataset.id), true); rerender(); },
  more: () => { S.limit += 120; rerender(); },
  allTop: () => { S.allTop = !S.allTop; S.allFrom = 0; S.limit = 60; render(); window.scrollTo(0, 0); },
  allPrev: () => {
    // frühere Angebote oben einfügen, ohne dass die Ansicht springt
    const anchor = document.querySelector('.list .card');
    const before = anchor?.getBoundingClientRect().top;
    S.allFrom = Math.max(0, (S.allFrom || 0) - 120);
    rerender();
    const same = anchor && document.querySelector(`.list .card[data-id="${CSS.escape(anchor.dataset.id)}"]`);
    if (same) window.scrollBy(0, same.getBoundingClientRect().top - before);
  },
  allJump: el => {
    const c = el.dataset.c;
    const find = () => [...document.querySelectorAll('.cat-head')].find(x => x.dataset.cat === c);
    let head = find();
    if (!head) {
      // Kategorie noch nicht geladen: Liste ab dieser Kategorie zeigen (davor per ▲ nachladbar)
      const start = S.allStart[S.allOrder.indexOf(c)];
      S.allFrom = start;
      S.limit = start + 60;
      rerender();
      head = find();
    }
    if (!head) return;
    const top = $('header.top').offsetHeight + ($('.all-jump')?.offsetHeight || 0);
    window.scrollTo(0, head.getBoundingClientRect().top + window.scrollY - top - 4);
    allMark();
    toTopUpdate();
  },
  sort: el => { S.sort = el.dataset.s; save('sort', S.sort); rerender(); },
  rt: el => {
    const k = el.dataset.r;
    S.f.only = S.f.only.includes(k) ? S.f.only.filter(x => x !== k) : [...S.f.only, k];
    S.allFrom = 0;  // „Alle“: andere Liste, wieder von vorn
    save('filters', S.f); renderChips(); rerender();
  },
  brand: el => {
    const k = el.dataset.b;
    S.brands.has(k) ? S.brands.delete(k) : S.brands.add(k);
    rerender();
  },
  brandOnly: () => { S.brandOnly = !S.brandOnly; rerender(); },
  groupFav: el => {
    const cat = el.dataset.c, g = el.dataset.g;
    saveGroupFav(cat, g, S.brands, S.brandOnly, S.offers);
    rerender();
  },
  groupWish: el => {
    const cat = el.dataset.c, g = el.dataset.g;
    const brands = [...S.brands];
    const names = brandNamesOf(brands, S.offers);
    const label = `${g === OTHER ? cat : g}${brands.length ? ' (' + brands.map(k => names[k]).join(', ') + ')' : ''}`;
    Li.addWish({ type: 'group', category: cat, group: g, brands, brandOnly: S.brandOnly }, label);
  },
  facet: el => { const k = el.dataset.k || null; S.qFacet = k === S.qFacet ? null : k; S.qBrands.clear(); S.limit = 60; rerender(); },
  qBrand: el => {
    const k = el.dataset.b;
    if (!k) S.qBrands.clear();
    else S.qBrands.has(k) ? S.qBrands.delete(k) : S.qBrands.add(k);
    S.limit = 60;
    rerender();
  },
  showWeak: () => { S.showWeak = true; rerender(); },
  searchFav: () => { toggleFav(searchFavNow()); rerender(); },
  favSort: el => { S.favSort = el.dataset.s; save('favSort', S.favSort); rerender(); },
  favOpen: el => { if (Date.now() - (S.dragDone || 0) < 400) return; const id = el.dataset.fid; S.open.has(id) ? S.open.delete(id) : S.open.add(id); rerender(); },
  favMetric: el => {
    const f = S.favs.find(x => x.id === el.dataset.fid);
    if (!f) return;
    // Preisalarm bezieht sich auf das Vergleichsmaß -> beim Umschalten zurücksetzen
    if ((el.dataset.m === 'price') !== byPack(f)) f.max = null;
    f.metric = el.dataset.m;
    saveFavs();
    rerender();
  },
  favDel: el => {
    const f = S.favs.find(x => x.id === el.dataset.fid);
    if (f && confirm(`Favorit „${favLabel(f).title}“ löschen?`)) { S.favs = S.favs.filter(x => x !== f); saveFavs(); rerender(); }
  },
  favWish: el => {
    const f = S.favs.find(x => x.id === el.dataset.fid);
    if (f) { Li.toggleFavWish(f, favLabel(f).title, el.dataset.prio === '1'); rerender(); }
  },
  favSettings: el => { const id = el.dataset.fid; S.favSet.has(id) ? S.favSet.delete(id) : S.favSet.add(id); rerender(); },
  prioOffer: el => { Li.togglePrioOffer(S.byId.get(el.dataset.id)); rerender(); },
  pickGroup: el => {
    const cat = el.dataset.c, g = el.dataset.g || null;
    const ex = findFav({ type: 'group', category: cat, group: g });
    if (ex) { S.favs = S.favs.filter(x => x !== ex); saveFavs(); toast(`„${g || cat}“ entfernt`); }
    else saveGroupFav(cat, g, [], false, S.offers);
    S.draft = null;
    rerender();
  },
  // „Angebote ansehen“ in der Favoriten-Auswahl: markierte Marken und „Nur Markenprodukte“ mitnehmen
  pickView: (el, e) => {
    e.preventDefault();
    if (S.draft) S.carry = { brands: new Set(S.draft.brands), brandOnly: !!S.draft.brandOnly };
    nav(el.getAttribute('href'));
  },
  pickFav: el => {
    const cat = el.dataset.c, g = el.dataset.g || null, d = g ? S.draft : null;
    saveGroupFav(cat, g, d ? d.brands : new Set(), d?.brandOnly, [...S.offers, ...(S.catalog || [])]);
    if (d) d.exists = !!findFav({ type: 'group', category: cat, group: g });
    rerender();
  },
  pickWish: el => {
    const cat = el.dataset.c, g = el.dataset.g || null, d = g ? S.draft : null;
    const brands = d ? [...d.brands] : [];
    const names = brandNamesOf(brands, [...S.offers, ...(S.catalog || [])]);
    const label = `${!g || g === OTHER ? cat : g}${brands.length ? ' (' + brands.map(k => names[k]).join(', ') + ')' : ''}`;
    Li.addWish({ type: 'group', category: cat, group: g, brands, brandOnly: !!d?.brandOnly }, label);
  },
  draftBrandOnly: () => { S.draft.brandOnly = !S.draft.brandOnly; updatePicker(); },
  pickOpen: el => { S.pickOpen = S.pickOpen === el.dataset.b ? null : el.dataset.b; updatePicker(); },
  draftBrand: el => {
    const k = el.dataset.b;
    S.draft.brands.has(k) ? S.draft.brands.delete(k) : S.draft.brands.add(k);
    updatePicker();
  },
  pickProduct: el => {
    const e = S.catalog.find(x => x.product_key === el.dataset.pk);
    if (e) toggleFav(catalogProductFav(e));
    updatePicker();
  },
  draftSave: () => {
    const d = S.draft;
    const source = [...S.offers, ...S.catalog];
    const base = { type: 'group', category: d.cat, group: d.group };
    const ex = findFav(base);
    const sel = { brands: [...d.brands].sort(), brandOnly: d.brandOnly, brandNames: brandNamesOf(d.brands, source) };
    if (ex) Object.assign(ex, sel);
    else S.favs.push({ ...base, ...sel, id: 'f' + Date.now().toString(36) });
    saveFavs();
    toast(`★ „${d.group}“ ${ex ? 'aktualisiert' : 'gemerkt'}`);
    S.draft = null;
    nav('#/add/' + enc(d.cat));
  },
  draftDel: () => {
    const d = S.draft;
    const ex = findFav({ type: 'group', category: d.cat, group: d.group });
    if (ex) { S.favs = S.favs.filter(x => x !== ex); saveFavs(); toast(`„${d.group}“ entfernt`); }
    S.draft = null;
    nav('#/add/' + enc(d.cat));
  },
  favBrandGroup: el => {
    const o = S.byId.get(el.dataset.id);
    const ex = findFav({ type: 'group', category: o.category, group: o.group });
    const brands = new Set(ex?.brands || []);
    brands.add(o.brand_key);
    saveGroupFav(o.category, o.group, brands, ex?.brandOnly, S.offers);
    rerender();
  },
  favGroup: el => {
    const o = S.byId.get(el.dataset.id);
    const ex = findFav({ type: 'group', category: o.category, group: o.group });
    if (ex) { S.favs = S.favs.filter(x => x !== ex); saveFavs(); toast(`„${o.group}“ entfernt`); }
    else saveGroupFav(o.category, o.group, [], false, S.offers);
    rerender();
  },
  goto: (el, e) => {
    e.preventDefault();
    if (S.sheetOpen) { S.afterSheet = el.getAttribute('href'); closeSheet(); }  // erst Fenster schließen, dann wechseln
    else nav(el.getAttribute('href'));
  },
  closeSheet: () => closeSheet(),
  logout: async () => {
    if (!confirm('Gruppen-Code auf diesem Gerät entfernen? Zum erneuten Zugriff muss er wieder eingegeben werden.')) return;
    await Cloud.logout();
    S.loaded = false;
    showLogin();
  },
  fApp: el => {
    const ks = el.dataset.r.split(','), off = S.f.noApp.includes(ks[0]);
    S.f.noApp = off ? S.f.noApp.filter(x => !ks.includes(x)) : [...new Set([...S.f.noApp, ...ks])];
    filtersChanged();
  },
  fMkAll: el => {
    const k = el.dataset.r, markets = { ...S.f.markets };
    if (el.dataset.v === 'none') markets[k] = [NO_MARKET]; else delete markets[k];
    S.f.markets = markets;
    filtersChanged();
  },
  fCat: el => {
    const c = el.dataset.c;
    S.f.hideCats = S.f.hideCats.includes(c) ? S.f.hideCats.filter(x => x !== c) : [...S.f.hideCats, c];
    filtersChanged();
  },
  fbKind: el => {
    save('fbDraft', { ...load('fbDraft', { text: '' }), kind: el.dataset.k });
    document.querySelectorAll('[data-act="fbKind"]').forEach(b => b.classList.toggle('on', b === el));
    const t = $('#fbText');
    if (t) t.placeholder = el.dataset.k === 'bug' ? 'Was ist passiert? Wo in der App?' : 'Beschreibe kurz deine Idee …';
  },
  fbSend: async el => {
    const d = load('fbDraft', { kind: 'bug', text: '' }), text = ($('#fbText')?.value || '').trim();
    if (!text) { toast('Bitte erst etwas eingeben'); return; }
    el.disabled = true;
    try {
      await Cloud.sendFeedback(d.kind, text);
      save('fbDraft', { kind: d.kind, text: '' });
      $('#fbText').value = '';
      toast('Danke! Feedback ist angekommen.');
    } catch (err) {
      toast(`Nicht gesendet (${err.message}) – der Text bleibt gespeichert`);
    }
    el.disabled = false;
  },
  refresh: async () => {
    await DATA.refresh();
    S.wasRunning = true;
    loadStatus();
  },
};

// Nach rechts wischen: Angebotskarte bzw. Favorit landet auf dem Einkaufszettel (Favorit mit seinem eigenen Namen);
// Favorit nach links wischen: nach Rückfrage entfernen
let swAddUntil = 0;
(() => {
  let sw = null;
  const view = $('#view'), sheet = $('#sheet');
  const down = e => {
    const inSheet = !!e.target.closest('#sheet');
    if (inSheet ? !S.replaceFor : route()[0] === 'list') return;
    if (e.button > 0 || e.target.closest('button, input, select, a, .fav-drag, .fav-settings')) return;
    const el = e.target.closest('.card') || (!inSheet && e.target.closest('.fav-h')?.closest('.fav'));
    if (!el) return;
    sw = { el, x: e.clientX, y: e.clientY, dx: 0, active: false, id: e.pointerId, repl: inSheet };
  };
  view.addEventListener('pointerdown', down);
  sheet.addEventListener('pointerdown', down);
  const move = e => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.active) {
      const left = dx < -12 && sw.el.classList.contains('fav');  // nach links nur bei Favoriten
      if ((dx > 12 || left) && Math.abs(dx) > Math.abs(dy) * 1.5) {
        sw.active = true;
        sw.dir = dx > 0 ? 1 : -1;
        try { sw.el.setPointerCapture(e.pointerId); } catch { /* egal */ }
        const r = sw.el.getBoundingClientRect();
        sw.hint = document.createElement('div');
        sw.hint.className = sw.repl ? 'sw-hint repl' : sw.dir > 0 ? 'sw-hint two' : 'sw-hint del';
        sw.hint.innerHTML = sw.repl ? '<div class="d">⇄ Eintrag ersetzen</div>'
          : sw.dir > 0 ? '<div class="z">＋ Auf den Zettel</div><div class="w">❗ Wichtig</div>' : '<div class="d">Entfernen 🗑</div>';
        sw.rect = r;
        // im Fenster fest positioniert und über dem Fenster
        Object.assign(sw.hint.style, sw.repl
          ? { position: 'fixed', zIndex: 51, top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' }
          : { top: r.top + window.scrollY + 'px', left: r.left + window.scrollX + 'px', width: r.width + 'px', height: r.height + 'px' });
        if (sw.repl) sw.el.style.zIndex = 52;
        document.body.appendChild(sw.hint);
        sw.el.classList.add('sw-moving');
      } else if (Math.abs(dy) > 12 || dx < -12) { sw = null; return; } else return;
    }
    sw.dx = sw.dir > 0 ? Math.max(0, dx) : Math.min(0, dx);
    sw.el.style.transform = `translateX(${sw.dx}px)`;
    const goNow = Math.abs(sw.dx) > Math.min(110, sw.el.offsetWidth * 0.3);
    sw.lower = e.clientY > sw.rect.top + sw.rect.height / 2;  // untere Hälfte = wichtig
    sw.hint.classList.toggle('go', goNow);
    // Zone unter dem Finger sofort zeigen (act), ab Schwelle voll gefärbt (on)
    for (const [sel, mine] of [['.z', !sw.lower], ['.w', sw.lower]]) {
      const z = sw.hint.querySelector(sel);
      if (!z) continue;
      z.classList.toggle('act', mine);
      z.classList.toggle('on', goNow && mine);
    }
  };
  const end = () => {
    if (!sw) return;
    const s = sw;
    sw = null;
    if (!s.active) return;
    swAddUntil = Date.now() + 400;  // folgenden Klick (Detailansicht öffnen) unterdrücken
    const go = Math.abs(s.dx) > Math.min(110, s.el.offsetWidth * 0.3);
    s.el.style.transition = 'transform .15s';
    s.el.style.transform = '';
    setTimeout(() => { s.el.style.transition = ''; s.el.style.zIndex = ''; s.el.classList.remove('sw-moving'); s.hint.remove(); }, 160);
    if (!go) return;
    if (s.repl) {  // Fenster „Angebote zu …“ auf dem Zettel: Eintrag durch dieses Angebot ersetzen
      const id = S.replaceFor;
      setTimeout(() => { closeSheet(); Li.replaceWithOffer(id, S.byId.get(s.el.dataset.id)); }, 170);
      return;
    }
    if (s.dir < 0) {  // Favorit entfernen – Rückfrage erst, wenn die Zeile zurückgefedert ist
      setTimeout(() => onClick.favDel(s.el), 170);
      return;
    }
    const prio = !!s.lower;
    if (s.el.classList.contains('card')) {
      const o = S.byId.get(s.el.dataset.id);
      if (!o) return;
      if (prio ? Li.isPrioOffer(o) : Li.hasOffer(o)) toast(prio ? 'Schon als wichtig auf dem Zettel' : 'Schon auf dem Einkaufszettel');
      else Li.toggleOffer(o, prio);  // bereits auf dem Zettel + wichtig: nur markieren
    } else {
      const f = S.favs.find(x => x.id === s.el.dataset.fid);
      if (!f) return;
      const ex = Li.favWish(f), label = favLabel(f).title;
      if (ex && (ex.prio || !prio)) toast(`„${label}“ ist schon ${ex.prio && prio ? 'als wichtig ' : ''}auf dem Einkaufszettel`);
      else if (ex) Li.toggleFavWish(f, label, true);  // vorhanden, jetzt wichtig
      else Li.addWish(f, label, { prio });
    }
    setTimeout(rerender, 170);
  };
  view.addEventListener('pointermove', move);
  sheet.addEventListener('pointermove', move);
  for (const el of [view, sheet]) { el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); }
})();

document.addEventListener('click', e => {
  if (Date.now() < swAddUntil && e.target.closest('#view')) { e.preventDefault(); e.stopPropagation(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) {
    // interne Links ohne neuen Verlaufseintrag
    const a = e.target.closest('a[href^="#"]');
    if (a && !e.defaultPrevented) { e.preventDefault(); nav(a.getAttribute('href')); }
    return;
  }
  const fn = onClick[el.dataset.act];
  if (fn) fn(el, e);
});


document.addEventListener('change', e => {
  const el = e.target;
  if ('setName' in el.dataset) {
    Cloud.setName(el.value);
    liFavsPush(S.favs);  // Favoriten unter dem neuen Namen abgleichen
    Sync.run();
    toast('Name gespeichert');
    return;
  }
  if (el.dataset.area && S.areaDraft) {
    S.areaDraft[el.dataset.area] = el.dataset.area === 'radius' ? Number(el.value) : el.value;
    if (el.dataset.area === 'home' && el.value && !S.areaDraft.radius) S.areaDraft.radius = 10;
    areaRefresh();
    return;
  }
  if ('areaRoute' in el.dataset && S.areaDraft) {
    S.areaDraft.route = el.checked ? { stops: S.areaDraft.home ? [S.areaDraft.home] : [], width: 3 } : null;
    areaRefresh();
    return;
  }
  if ('areaAdd' in el.dataset && S.areaDraft?.route) {
    if (el.value) { S.areaDraft.route.stops.push(el.value); routeUpdate(); }
    return;
  }
  if ('areaWidth' in el.dataset && S.areaDraft?.route) {
    S.areaDraft.route.width = Number(el.value);
    areaRefresh();
    return;
  }
  if (el.dataset.areaRet && S.areaDraft) {
    const all = Object.keys(S.retailers);
    const cur = S.areaDraft.retailers.length ? S.areaDraft.retailers : all;
    const next = el.checked ? [...new Set([...cur, el.dataset.areaRet])] : cur.filter(k => k !== el.dataset.areaRet);
    if (!next.length) { el.checked = true; toast('Mindestens ein Händler'); return; }
    S.areaDraft.retailers = all.filter(k => next.includes(k));
    if (S.areaDraft.retailers.length === all.length) S.areaDraft.retailers = [];
    areaRefresh();
    return;
  }
  if (el.hasAttribute('data-push')) {
    el.disabled = true;
    pushEnable(el.checked)
      .then(() => toast(el.checked ? 'Benachrichtigung eingeschaltet' : 'Benachrichtigung ausgeschaltet'))
      .catch(err => { el.checked = false; save('push', false); toast(`Nicht möglich: ${err.message}`); })
      .finally(() => { el.disabled = false; });
    return;
  }
  if (el.dataset.fmarket) {
    const k = el.dataset.fmarket, cur = (S.f.markets[k] || []).filter(m => m !== NO_MARKET);
    S.f.markets = { ...S.f.markets, [k]: el.checked ? [...cur, el.value] : cur.filter(m => m !== el.value) };
    if (!S.f.markets[k].length) delete S.f.markets[k];
    filtersChanged();
    return;
  }
  if (el.dataset.set) {
    const k = el.dataset.set;
    S.f[k] = el.type === 'checkbox' ? el.checked : el.value;
    save('filters', S.f);
    if (k === 'theme') applyTheme();
    applyEff();
    updateBadges();
    return;
  }
  if (el.dataset.fid) {
    const f = S.favs.find(x => x.id === el.dataset.fid);
    if (!f) return;
    if (el.dataset.field === 'max') {
      f.max = el.value ? Number(el.value.replace(',', '.')) : null;
      // vorausgewählte Einheit übernehmen, auch wenn sie nicht aktiv geändert wurde
      const sel = el.parentElement.querySelector('select[data-field="maxUnit"]');
      if (sel && !f.maxUnit) f.maxUnit = sel.value;
    }
    if (el.dataset.field === 'maxUnit') f.maxUnit = el.value;
    if (el.dataset.field === 'name') f.name = el.value.trim() || undefined;  // leer = automatischer Name
    saveFavs();
    rerender();
    return;
  }
  if (el.dataset.field === 'draftBrandOnly') {
    S.draft.brandOnly = el.checked;
    updatePicker();
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'fbText') save('fbDraft', { ...load('fbDraft', { kind: 'bug' }), text: e.target.value });
  if (e.target.id === 'pickQ') {
    S.pickQ = e.target.value;
    clearTimeout(S.pickTimer);
    S.pickTimer = setTimeout(updatePicker, 150);
  }
});

const qInput = $('#q');
function clearSearch(doRender = true) {
  qInput.value = '';
  S.q = '';
  S.qFacet = null;
  S.qBrands.clear();
  S.showWeak = false;
  $('#clearQ').hidden = true;
  if (doRender) render();
}
qInput.addEventListener('input', () => {
  clearTimeout(S.qTimer);
  S.qTimer = setTimeout(() => {
    S.q = qInput.value.trim();
    S.qFacet = null;
    S.qBrands.clear();
    S.showWeak = false;
    S.limit = 60;
    $('#clearQ').hidden = !qInput.value;
    const r = route();
    if (S.q && r[0] && r[0] !== 'c') { nav('#/'); return; }
    render();
  }, 160);
});
qInput.addEventListener('keydown', e => { if (e.key === 'Enter') qInput.blur(); });
$('#clearQ').addEventListener('click', () => { clearSearch(); qInput.focus(); });

$('#back').addEventListener('click', () => { if (!goUp()) nav('#/'); });

// nur echte Adressänderungen (z.B. von Hand); eigene Wechsel sind schon gezeichnet
window.addEventListener('hashchange', () => { if (!popping && (location.hash || '#/') !== lastHash) onRoute(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheetOpen) closeSheet(); });

/* ---------- Favoriten verschieben (Drag & Drop am Griff ⠿) ---------- */

(() => {
  let drag = null;
  view.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.fav-drag');
    if (!handle || e.button > 0) return;
    e.preventDefault();
    const el = handle.closest('.fav');
    drag = { el, id: e.pointerId, moved: false };
    handle.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  });
  view.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const y = e.clientY;
    // am Rand automatisch scrollen
    if (y < 90) window.scrollBy(0, -12);
    else if (y > window.innerHeight - 110) window.scrollBy(0, 12);
    const others = [...view.querySelectorAll('.fav')].filter(s => s !== drag.el);
    const next = others.find(s => { const r = s.getBoundingClientRect(); return y < r.top + r.height / 2; });
    if (next ? drag.el.nextElementSibling !== next : drag.el !== others[others.length - 1]?.nextElementSibling) {
      if (next) next.before(drag.el); else others[others.length - 1]?.after(drag.el);
      drag.moved = true;
    }
  });
  const end = () => {
    if (!drag) return;
    const { el, moved } = drag;
    drag = null;
    el.classList.remove('dragging');
    S.dragDone = Date.now();  // folgenden Klick (Auf-/Zuklappen) ignorieren
    if (!moved) return;
    const order = [...view.querySelectorAll('.fav')].map(s => s.dataset.fid);
    S.favs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    S.favs.forEach((f, i) => { f.order = i; });
    saveFavs();
    rerender();
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
})();

/* ---------- Start ---------- */

async function loadData() {
  try {
    const j = await DATA.offers();
    S.offers = aggregate(j.offers);
    // feste Reihenfolge der Händler (auch für bereits hochgeladene Daten); unbekannte hinten anhängen
    const rank = k => { const i = RETAILER_ORDER.indexOf(k); return i < 0 ? 99 : i; };
    S.retailers = Object.fromEntries(Object.entries(j.retailers).sort(([a], [b]) => rank(a) - rank(b)));
    if (S.retailers.aldi) S.retailers.aldi = { ...S.retailers.aldi, name: 'Aldi' };  // auch für ältere hochgeladene Daten
    S.categories = j.categories;
    S.groups = j.groups;
    S.places = j.places;
    S.placeName = Object.fromEntries(j.places.map(p => [p.key, p.name]));
    S.marketPlaces = j.market_places || {};
    applyArea();
    S.generated = j.generated;
    S.byId = new Map(S.offers.flatMap(o => o.variants.map(v => [v.id, o])));
    S.offers.forEach(prep);
    applyEff();
    S.catalog = null;
    S.loaded = true;
    renderChips();
    render();
    prefetchCatalog();
    pushClearBadge();
    pushCtxSave();
  } catch (err) {
    if (err instanceof LoginNeeded) { showLogin(err.message); return; }
    view.innerHTML = `<p class="empty">Angebote konnten nicht geladen werden.<br><small>${esc(err.message)}</small><br><br>
      <button class="btn" onclick="location.reload()">Erneut versuchen</button></p>`;
  }
}

/* ---------- Gruppe (Mehr → Gruppe) ---------- */

const agoText = iso => {
  const m = (Date.now() - Date.parse(iso)) / 60e3;
  if (m < 60) return 'gerade eben';
  if (m < 24 * 60) return `vor ${Math.round(m / 60)} Std.`;
  const d = Math.round(m / 1440);
  return d === 1 ? 'gestern' : d < 30 ? `vor ${d} Tagen` : new Date(iso).toLocaleDateString('de-DE');
};

let grpInfo = null;
async function loadGroup() {
  if (!$('#groupAdmin')) return;
  try {
    const before = JSON.stringify(grpSet());
    await Cloud.touch(true);  // Rolle, Gruppenname und Einstellungen aktuell halten (z.B. nach Übergabe der Admin-Rolle)
    if (S.loaded && JSON.stringify(grpSet()) !== before) { areaChanged(before); return; }  // zeichnet „Mehr“ neu
    grpInfo = await Cloud.groupInfo();
  } catch (err) {
    const b = $('#groupAdmin');
    if (b) b.innerHTML = `<p class="muted" style="font-size:.85rem">Gruppe konnte nicht geladen werden: ${esc(err.message)}</p>`;
    return;
  }
  const box = $('#groupAdmin');
  if (!box) return;
  const title = $('.more-title');
  if (title) title.textContent = `👥 Gruppe „${grpInfo.group}“`;
  // Einladungen für neue Gruppen: nur fest freigeschaltete Mitglieder (members.can_invite)
  const inv = grpInfo.can_invite ? `<div class="grp">
    <p style="margin:0 0 6px"><b>✉️ Einladungen für neue Gruppen</b></p>
    <p class="muted" style="margin:0 0 8px;font-size:.82rem">Mit einem Einladungscode kann jemand unter „Neue Gruppe anlegen“
      eine eigene Gruppe gründen und wird deren Admin. Jeder Code gilt einmal.</p>
    <div class="grp-tools"><button class="btn small" data-act="grpInvite">Einladung erstellen</button>
      <button class="btn small" data-act="grpInvites">Übersicht</button></div>
    <div id="grpInv"></div></div>` : '';
  if (grpInfo.role !== 'admin') {
    box.innerHTML = '<p class="muted" style="margin:0 0 8px;font-size:.85rem">Neue Mitglieder bekommen den Gruppen-Code vom Admin der Gruppe.</p>' + inv;
    return;
  }
  const ms = grpInfo.members || [];
  box.innerHTML = `<div class="grp">
    <p style="margin:0 0 6px"><b>Du bist Admin dieser Gruppe.</b></p>
    <div class="grp-code-line">Gruppen-Code: <code class="grp-code">${esc(Cloud.code())}</code>
      <button class="btn small" data-act="grpCopy">Kopieren</button></div>
    <p class="muted" style="margin:2px 0 10px;font-size:.82rem">Mit diesem Code schalten andere die App für eure Gruppe frei.</p>
    <h4 style="margin:6px 0">Mitglieder (${ms.length})</h4>
    <ul class="grp-members">${ms.map(m => `<li>
      <div class="grp-m"><b>${esc(m.name || 'ohne Namen')}</b>${m.id === grpInfo.me ? ' <span class="muted">(du)</span>' : ''}
        ${m.role === 'admin' ? '<span class="grp-badge">Admin</span>' : ''}
        <small class="muted">zuletzt ${agoText(m.last_seen)}</small></div>
      ${m.id === grpInfo.me ? '' : `<div class="grp-acts">
        <button class="btn small" data-act="grpMember" data-a="rename" data-id="${m.id}" title="Umbenennen">✏️</button>
        <button class="btn small" data-act="grpMember" data-a="admin" data-id="${m.id}" title="Zum Admin machen">👑</button>
        <button class="btn small" data-act="grpMember" data-a="remove" data-id="${m.id}" title="Entfernen">🗑</button></div>`}
    </li>`).join('')}</ul>
    <div class="grp-tools">
      <button class="btn small" data-act="grpRename">Gruppe umbenennen</button>
      <button class="btn small" data-act="grpNewCode">Neuen Gruppen-Code erzeugen</button>
    </div></div>${inv}`;
}

async function grpDo(fn, ok) {
  try { await fn(); if (ok) toast(ok); } catch (err) { toast(`Fehler: ${err.message}`); }
  loadGroup();
}

Object.assign(onClick, {
  grpCopy: async () => {
    try { await navigator.clipboard.writeText(Cloud.code()); toast('Gruppen-Code kopiert'); }
    catch { toast('Kopieren nicht möglich – bitte abschreiben'); }
  },
  grpMember: el => {
    const m = (grpInfo?.members || []).find(x => x.id === el.dataset.id);
    if (!m) return;
    const a = el.dataset.a;
    if (a === 'rename') {
      const n = prompt('Neuer Name:', m.name);
      if (n && n.trim()) grpDo(() => Cloud.adminMember(m.id, 'rename', n.trim()), 'Umbenannt');
    } else if (a === 'admin') {
      if (confirm(`${m.name} zum Admin machen? Du gibst die Admin-Rolle damit ab.`)) grpDo(() => Cloud.adminMember(m.id, 'admin'), 'Admin übergeben');
    } else if (a === 'remove') {
      if (confirm(`${m.name} aus der Gruppe entfernen? Das Gerät hat danach keinen Zugang mehr.\n\nTipp: Danach auch einen neuen Gruppen-Code erzeugen, sonst kann die Person mit einem anderen Gerät wieder beitreten.`))
        grpDo(() => Cloud.adminMember(m.id, 'remove'), 'Entfernt');
    }
  },
  grpRename: () => {
    const n = prompt('Neuer Name der Gruppe:', grpInfo?.group || '');
    if (n && n.trim()) grpDo(() => Cloud.adminGroupName(n.trim()), 'Gruppe umbenannt');
  },
  grpNewCode: () => {
    if (!confirm('Neuen Gruppen-Code erzeugen? Der alte Code gilt dann nicht mehr: alle anderen Geräte müssen den neuen Code einmal eingeben.')) return;
    grpDo(async () => { const c = await Cloud.adminNewCode(); alert(`Neuer Gruppen-Code:\n\n${c}\n\nBitte an die Mitglieder weitergeben.`); });
  },
  grpInvite: async () => {
    const note = prompt('Für wen ist die Einladung? (optional, nur für deine Übersicht)', '');
    if (note === null) return;
    try {
      const code = await Cloud.createInvite(note.trim());
      $('#grpInv').innerHTML = `<p style="margin:10px 0 2px">Einladungscode${note.trim() ? ` für ${esc(note.trim())}` : ''}:</p>
        <div class="grp-code-line"><code class="grp-code big">${esc(code)}</code>
          <button class="btn small" data-act="grpInvCopy" data-code="${esc(code)}">Kopieren</button></div>
        <p class="muted" style="margin:0;font-size:.82rem">Weitergeben mit dem Link zur App; dort „Neue Gruppe anlegen (mit Einladungscode)“.</p>`;
    } catch (err) { toast(`Fehler: ${err.message}`); }
  },
  grpInvCopy: async el => {
    const txt = `Einladung zur App „Angebote Preisvergleich“: ${location.origin}${location.pathname}
`
      + `Dort „Neue Gruppe anlegen (mit Einladungscode)“ wählen. Einladungscode: ${el.dataset.code}`;
    try { await navigator.clipboard.writeText(txt); toast('Einladung kopiert (mit Link zur App)'); }
    catch { toast('Kopieren nicht möglich – bitte abschreiben'); }
  },
  grpInvites: async () => {
    try {
      const rows = await Cloud.listInvites();
      $('#grpInv').innerHTML = rows.length ? `<ul class="grp-members">${rows.slice().reverse().map(r => `<li><div class="grp-m">
        <b>${esc(r.note || 'ohne Notiz')}</b><small class="muted">erstellt ${new Date(r.created_at).toLocaleDateString('de-DE')} ·
        ${r.used_at ? `benutzt → Gruppe „${esc(r.group || '?')}“` : 'noch offen'}</small></div></li>`).join('')}</ul>`
        : '<p class="muted" style="margin:10px 0 0">Noch keine Einladungen.</p>';
    } catch (err) { toast(`Fehler: ${err.message}`); }
  },
  areaGeo: () => {
    if (!navigator.geolocation) { toast('Standort wird nicht unterstützt'); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const near = S.places.filter(p => p.lat != null).map(p => [kmBetween(me, p), p]).sort((a, b) => a[0] - b[0])[0];
      if (!near || near[0] > 15) { toast('Dein Standort liegt außerhalb des Gebiets (Hagen a.T.W. – Langenberg)'); return; }
      S.areaDraft.home = near[1].key;
      if (!S.areaDraft.radius) S.areaDraft.radius = 10;
      areaRefresh();
      toast(`Nächster Ort: ${near[1].name} (${near[0].toFixed(1)} km)`);
    }, () => toast('Standort nicht verfügbar (Freigabe verweigert?)'), { timeout: 10000, maximumAge: 600000 });
  },
  areaSave: async () => {
    const d = S.areaDraft;
    if (!d) return;
    const all = Object.keys(S.retailers);
    const rt = d.route?.stops?.length >= 2 ? d.route : null;
    const s = { home: d.home, radius: d.home ? d.radius : 0, retailers: d.retailers.length >= all.length ? [] : d.retailers,
      route: rt && { stops: rt.stops, width: rt.width || 3, line: rt.line || null, km: rt.km || null, min: rt.min || null } };
    try {
      if (Cloud.enabled) await Cloud.adminSettings(s); else save('grpSet', s);
    } catch (err) { toast(`Fehler: ${err.message}`); return; }
    S.areaDraft = null;
    applyArea();
    renderChips();
    updateBadges();
    areaRefresh();
    toast('Gebiet & Händler gespeichert');
  },
  routeDel: el => {
    S.areaDraft?.route?.stops.splice(Number(el.dataset.i), 1);
    routeUpdate();
  },
  loginMode: el => showLogin('', el.dataset.mode),
  loginDone: () => afterLogin(),
});

// Zugang zur veröffentlichten Fassung: Gruppen-Code + Name, einmal je Gerät (oder neue Gruppe per Einladung)
function showLogin(msg, mode = 'join') {
  S.loaded = false;
  const err = msg && msg !== 'Bitte Gruppen-Code eingeben' ? `<p class="err">${esc(msg)}</p>` : '';
  const nameField = `<label class="li-f">Dein Name (auf allen eigenen Geräten gleich – dann werden deine Favoriten abgeglichen)<input id="loginName" value="${esc(Cloud.name())}" placeholder="z.B. Anna" autocomplete="given-name" required></label>`;
  view.innerHTML = mode === 'create' ? `<div class="panel login">
    <h2>👥 Neue Gruppe anlegen</h2>
    <p class="muted">Dafür brauchst du einen Einladungscode. Du wirst Admin der Gruppe und bekommst den Gruppen-Code für die anderen.</p>
    ${err}
    <form id="createForm">
      <label class="li-f">Einladungscode<input id="inviteCode" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
      <label class="li-f">Name der Gruppe<input id="groupName" placeholder="z.B. Familie Müller" maxlength="40" required></label>
      ${nameField}
      <button class="btn primary">Gruppe anlegen</button>
    </form>
    <p class="login-alt"><button class="btn small" data-act="loginMode" data-mode="join">Ich habe schon einen Gruppen-Code</button></p></div>`
  : `<div class="panel login">
    <h2>🔒 Zugang</h2>
    <p class="muted">Einmal auf diesem Gerät den Gruppen-Code eingeben – danach bleibt die App freigeschaltet.</p>
    ${err}
    <form id="loginForm">
      <label class="li-f">Gruppen-Code<input id="loginCode" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
      ${nameField}
      <button class="btn primary">Freischalten</button>
    </form>
    <p class="login-alt"><button class="btn small" data-act="loginMode" data-mode="create">Neue Gruppe anlegen (mit Einladungscode)</button></p></div>`;
}

// nach Anmeldung/Anlegen: Zettel einer anderen Gruppe verwerfen, Favoriten senden, Daten laden
async function afterLogin() {
  if (Cloud.switchedGroup()) liResetGroup();
  if (!load('onboarded', false)) S.wizard = wizardStart();
  view.innerHTML = '<p class="loading">Lade Angebote …</p>';
  liFavsPush(S.favs);
  await loadData();
  Sync.run();
}

/* ---------- Einführung (erster Start; später unter Mehr → Über die App) ---------- */

function wizardStart() {
  const s = grpSet();
  const steps = ['welcome'];
  if (canEditArea() && !s.home && !s.route && !(s.retailers || []).length) steps.push('area');
  steps.push('start', ...TOUR.map((_, i) => 'tour' + i));
  return { step: 0, steps };
}

/* ---------- Anleitung (Mehr → Über die App) und Einführung beim ersten Start ---------- */

// Abschnitte je Reiter: [Symbol, Titel, Einleitung, [[Stichwort, Erklärung], …]]; tour = Kurzfassung für die Einführung
const GUIDE = [
  { id: 'kat', ico: '🗂️', title: 'Kategorien',
    intro: 'Alle aktuellen Angebote nach Warengruppen – zum Stöbern.',
    items: [
      ['Kachel antippen', 'zeigt die Angebote der Kategorie. Oben wählst du eine Produktgruppe (z.B. „Schokolade“), ein zweiter Tipp hebt die Auswahl auf.'],
      ['Marken', 'unter der Trennlinie „Marken“ Marken antippen, um nur diese zu sehen. „Nur Markenprodukte“ blendet Handelsmarken (ja!, Gut & Günstig …) aus.'],
      ['☆ Gruppe merken', 'merkt die Produktgruppe mit den gewählten Marken als Favorit (gelb). Nochmal tippen entfernt ihn.'],
      ['＋ Zettel', 'setzt die Produktgruppe als Wunsch auf den Einkaufszettel (grün) – dort steht dann immer das günstigste passende Angebot.'],
      ['Sortierung', 'Grundpreis (€/kg, €/l), Preis oder Rabatt. Beim Grundpreis stehen gleiche Einheiten zusammen, kg und l zuerst.'],
    ] },
  { id: 'alle', ico: '🏷️', title: 'Alle & Suche',
    intro: 'Alle Angebote in einer Liste, die Suche oben gilt für die ganze App.',
    items: [
      ['Suche', 'z.B. „Butter“, „Jacobs Kaffee“. Gesucht wird zuerst genau (Wortanfang), Tippfehler nur, wenn sonst nichts passt. Treffer nur in der Beschreibung lassen sich zuschalten.'],
      ['Händler-Chips', 'die farbigen Chips oben: markierte Händler werden angezeigt, ohne Markierung alle.'],
      ['Angebot antippen', 'öffnet die Details: Preise mit/ohne App, Normalpreis, Gültigkeit, Märkte, Preisverlauf und Preis-Leiste.'],
      ['👉 Nach rechts wischen', 'obere Hälfte der Karte = auf den Zettel, untere Hälfte = ❗ wichtig auf den Zettel. Die Zone unter dem Finger leuchtet.'],
      ['☆ an der Karte', 'merkt genau dieses Produkt als Favorit.'],
      ['Suche merken', 'merkt die Suche (mit gewählter Produktgruppe/Marken) als Favorit.'],
    ] },
  { id: 'fav', ico: '⭐', title: 'Favoriten',
    intro: 'Was du regelmäßig kaufst – die App zeigt, wo es gerade im Angebot ist.',
    items: [
      ['＋ Hinzufügen', 'Kategorie und Produktgruppe wählen, Marken markieren. Hier gibt es auch Marken, die gerade nicht im Angebot sind (z.B. für später).'],
      ['Favorit antippen', 'klappt die passenden Angebote auf, das günstigste steht oben. „neu“ = noch nicht gesehene Angebote.'],
      ['Preis-Leiste', 'grün = günstig, rot = teuer im Vergleich der letzten 12 Monate. Der Strich in der Mitte ist der Durchschnitt, der Punkt das beste aktuelle Angebot.'],
      ['⋮ Einstellungen', 'Name, Vergleich nach Grundpreis oder Packungspreis (z.B. Kaffeekapseln), Preisalarm „max. … €“.'],
      ['Wischen', 'nach rechts = auf den Zettel (oben) bzw. wichtig (unten), nach links = Favorit entfernen (mit Rückfrage).'],
      ['Reihenfolge', '„Angebote zuerst“ oder „Eigene Reihenfolge“ – dann am Griff ⠿ verschieben.'],
      ['Zahl am Stern', 'unten in der Leiste: wie viele Favoriten gerade im Angebot sind.'],
    ] },
  { id: 'zettel', ico: '📝', title: 'Einkaufszettel',
    intro: 'Euer gemeinsamer Zettel – Änderungen erscheinen sofort bei allen in der Gruppe.',
    items: [
      ['Eintippen', 'z.B. „3 l Milch“ oder „2 Butter“ – Menge und Einheit werden erkannt. Vorschläge kommen aus Verlauf und Favoriten. ❗ vor dem Absenden = wichtig.'],
      ['Wischen', 'nach rechts = abhaken (Rückgängig möglich), nach links = löschen.'],
      ['Antippen', 'öffnet die Bearbeitung: Menge, Notiz, Kategorie, Preis, passende Favoriten und Angebote.'],
      ['💡 im Angebot', 'zeigt in der Ansicht „Details“, dass es zu einem Eintrag gerade ein Angebot gibt.'],
      ['Lange drücken (Details)', 'öffnet die passenden Angebote – bei getippten Einträgen dieselben Treffer wie die Suche oben. Ein Angebot nach rechts wischen ersetzt den Eintrag durch dieses Angebot – Menge und Notiz bleiben.'],
      ['Ansichten', '„Einfach“ zeigt nur Namen und Mengen, „Details“ zusätzlich Angebote und Preise; sortierbar nach Eingabe, A–Z oder Kategorie.'],
      ['Verlauf', 'früher Eingetragenes – ＋ setzt es wieder auf den Zettel, nach links wischen entfernt es aus dem Verlauf.'],
    ] },
  { id: 'mehr', ico: '⚙️', title: 'Mehr',
    intro: 'Einstellungen – das meiste gilt nur für dieses Gerät.',
    items: [
      ['👥 Gruppe', 'dein Name (erscheint als „von …“ auf dem Zettel), Mitglieder, Gruppen-Code. Admins verwalten Mitglieder und Einladungen.'],
      ['📍 Gebiet & Händler', 'Wohnort mit Umkreis, optional eine Strecke (z.B. Arbeitsweg) und die Händler – gilt für die ganze Gruppe (legt der Admin fest).'],
      ['🔎 Filter', 'welche Apps/Kundenkarten du nutzt (sonst zählt der Normalpreis), Kategorien ausblenden, einzelne Märkte wählen oder „Keiner“, Online- und Vorschau-Angebote.'],
      ['🎨 Darstellung', 'Farbschema, Start-Tab und 🔔 Benachrichtigung bei neuen Favoriten-Angeboten (nach dem Abruf um 5 und 14 Uhr, mit Zahl am App-Symbol).'],
      ['📊 Daten & Abruf', 'Stand der Angebote und der einzelnen Quellen; Admins sehen das Kontingent der kostenlosen Dienste.'],
      ['💬 Feedback', 'Fehler oder Ideen direkt an den Entwickler schicken.'],
    ] },
  { id: 'begriffe', ico: '🔤', title: 'Begriffe & Symbole',
    intro: 'Was die Hinweise an den Angeboten bedeuten.',
    items: [
      ['Grundpreis', 'Preis je kg, l, Stück oder Waschladung – damit lassen sich verschiedene Packungsgrößen vergleichen.'],
      ['ab … €/kg', 'die Packungsgröße schwankt (z.B. 165–190 g): Grundpreis der größten Packung.'],
      ['📱 Preis', 'gilt nur mit der App/Kundenkarte des Händlers; darunter „ohne App …“. Unter Filter abschaltbar.'],
      ['📱 1/13 Märkte', 'der beste Preis gilt nur in einem Teil der Märkte – die Details zeigen, wo.'],
      ['+ Marktkauf', 'dasselbe Angebot gibt es auch bei einem weiteren Händler derselben Kette.'],
      ['✓ / ❗ vor dem Titel', 'steht schon auf dem Zettel (❗ = als wichtig).'],
      ['NEU, −30 %, bis Sa 03.10.', 'noch nicht gesehen, Rabatt laut Prospekt, Gültigkeit; „ab Mo …“ = Vorschau auf nächste Woche.'],
    ] },
];

const guideHtml = () => `<div class="guide">${GUIDE.filter(g => Cloud.enabled || g.id !== 'gruppe').map(g => `
  <details class="guide-sec"><summary><span class="gs-i">${g.ico}</span><span><b>${g.title}</b><small>${g.intro}</small></span></summary>
    <ul>${g.items.filter(([k]) => Cloud.enabled || !/Gruppe|Feedback/.test(k)).map(([k, t]) => `<li><b>${k}</b> – ${t}</li>`).join('')}</ul>
  </details>`).join('')}</div>`;

// Einführung: je Seite ein Bereich mit den wichtigsten Punkten
// Beispiel-Ausschnitte für den Rundgang (echte Bausteine der App, nicht antippbar)
const TOUR_MOCK = {
  // Produktgruppe wählen, Marke markieren, merken – Tipp-Punkte zeigen, was gerade angetippt wird
  kat: () => `<div class="tour-mock tm-kat"><div class="tm-cap">Beispiel: Kategorie „Süßes & Snacks“</div>
    <div class="chips wrap pick"><span class="chip tk-alle">Alle <i>263</i></span><span class="chip">Riegel <i>29</i></span>
      <span class="chip tk-s1 tm-tap t1">Schokolade <i>51</i></span><span class="chip">Pralinen <i>12</i></span></div>
    <div class="chips-sep"><span>Marken</span></div>
    <div class="chips wrap pick"><span class="chip">Nur Markenprodukte</span><span class="chip tk-s2 tm-tap t2">Milka <i>9</i></span>
      <span class="chip">Lindt <i>1</i></span><span class="chip">Ritter Sport <i>3</i></span></div>
    <div class="chips wrap grp-acts"><span class="btn act-fav tk-fav tm-tap t3"><span class="tk-a">☆ Auswahl merken</span><span class="tk-b">★ Gemerkt</span></span>
      <span class="btn act-list">＋ Zettel</span></div></div>`,
  // Sortierung umschalten: die Reihenfolge der Angebote ändert sich mit
  alle: () => `<div class="tour-mock tm-alle"><div class="tm-cap">Beispiel: Sortierung umschalten</div>
    <div class="sortbar"><span>3 Angebote</span><div class="seg"><button class="ta-1">Grundpreis</button><button class="ta-2">Preis</button><button class="ta-3">Rabatt</button></div></div>
    <div class="ta-list">${[['ta-a', '🧀', 'Gouda am Stück', '1,49 €', '5,96 €/kg', '−20 %'], ['ta-b', '🧀', 'Frischkäse', '0,99 €', '9,90 €/kg', '−40 %'],
      ['ta-c', '🧀', 'Käse XXL', '2,49 €', '4,15 €/kg', '−10 %']].map(([c, i, n, p, u, d]) =>
      `<div class="ta-row ${c}"><span>${i}</span><b>${n}</b><span class="ta-u">${u}</span><span class="ta-p">${p}</span><span class="ta-d">${d}</span></div>`).join('')}</div></div>`,
  // Favorit mit Preis-Leiste; antippen klappt die Angebote auf
  fav: () => `<div class="tour-mock tm-fav"><div class="tm-cap">Beispiel: Favorit aufklappen</div>
    <div class="tf-box"><div class="tf-h tm-tap t1"><span style="font-size:18px">🧈</span><span class="tf-t"><b>Butter <span class="new">2 neu</span></b><small>Milch & Molkerei · 3 Angebote</small></span>
      <b class="tf-best">ab 5,16 €/kg</b></div>
      ${priceBar({ n: 24, min: 4.76, avg: 6.4, max: 8.9, u: 'kg', cur: 5.16 })}
      <div class="tf-open">${[['Kerrygold Butter', 'Lidl', '5,16 €/kg'], ['Meggle Butter', 'Edeka', '5,96 €/kg']].map(([n, r, p]) =>
        `<div class="tf-row"><b>${n}</b><small>${r}</small><span>${p}</span></div>`).join('')}</div></div></div>`,
  // Ansicht umschalten: in „Details“ erscheint der Angebots-Hinweis
  zettel: () => `<div class="tour-mock tm-zettel"><div class="tm-cap">Beispiel: Ansicht „Einfach“ ↔ „Details“</div>
    <div class="sortbar"><span>Ansicht</span><div class="seg"><button class="tz-1">Einfach</button><button class="tz-2 tm-tap t1">Details</button></div></div>
    <div class="tz-list">${[['🥛', 'Milch', '2 l', 'Aldi 0,99 €/l · 5 Angebote'], ['🧈', 'Butter', '', 'Lidl 5,16 €/kg · 14 Angebote']].map(([i, n, q, h]) =>
      `<div class="tz-row"><span>${i}</span><span class="tz-t"><b>${n}</b><small class="tz-h">💡 im Angebot: ${h}</small></span><span class="tz-q">${q}</span><span class="tz-c">✓</span></div>`).join('')}</div></div>`,
  // Untermenüs nacheinander antippen
  mehr: () => `<div class="tour-mock tm-mehr"><div class="tm-cap">Beispiel: Untermenüs unter „Mehr“</div>
    <nav class="more-menu">${[['🔎', 'Filter', 'Apps, Kategorien, Märkte'], ['🎨', 'Darstellung', 'Farbschema · Start-Tab · 🔔'],
      ['ℹ️', 'Über die App', 'Anleitung je Reiter']].map(([i, t, d], k) => `<span class="more-item tm-tap tmm t${k + 1}"><span class="mi-ico">${i}</span>
      <span class="mi-txt"><b>${t}</b><small>${d}</small></span><span class="mi-go">›</span></span>`).join('')}</nav></div>`,
};

// Rundgang beim ersten Start: je Reiter eine Seite (tab = markierter Reiter in der Mini-Leiste), dazu das Wischen
const TOUR_TABS = [['🗂️', 'Kategorien'], ['🏷️', 'Alle'], ['⭐', 'Favoriten'], ['📝', 'Zettel'], ['⚙️', 'Mehr']];
const TOUR = [
  { tab: 0, ico: '🗂️', title: 'Kategorien',
    text: 'Die Angebote der Woche nach Warengruppen – zum Stöbern. Oben suchst du, die farbigen <b>Händler-Chips</b> filtern.',
    points: ['Kachel antippen, dann eine <b>Produktgruppe</b> und darunter <b>Marken</b> wählen.',
      'Gelb <b>☆ Gruppe merken</b> = als Favorit, grün <b>＋ Zettel</b> = auf den Einkaufszettel.',
      'Verglichen wird nach <b>Grundpreis</b> (€/kg, €/l) – so sind verschiedene Packungen vergleichbar.'], mock: 'kat' },
  { tab: 1, ico: '🏷️', title: 'Alle & Suche',
    text: 'Alle Angebote in einer Liste – sortiert nach Grundpreis, Preis oder Rabatt.',
    points: ['Die <b>Suche</b> oben gilt überall, z.B. „Butter“ oder „Jacobs Kaffee“.',
      '<b>📱</b> = Preis nur mit Händler-App; unter Mehr → Filter wählst du, welche Apps du nutzt.',
      'Angebot <b>antippen</b>: Details mit Märkten, Preisverlauf und Preis-Leiste.'], mock: 'alle' },
  { tab: 1, ico: '👉', title: 'Wischen statt Knöpfe',
    text: 'Ein Angebot oder einen Favoriten <b>nach rechts wischen</b> – schon steht er auf dem Einkaufszettel.',
    demo: true,
    points: ['<b>Obere Hälfte</b> der Karte: auf den Zettel.', '<b>Untere Hälfte</b>: ❗ wichtig auf den Zettel.',
      'Ein grünes <b>✓</b> vor dem Titel zeigt: steht schon auf dem Zettel.'] },
  { tab: 2, ico: '⭐', title: 'Favoriten',
    text: 'Merk dir, was du regelmäßig kaufst – Produktgruppen, Marken oder einzelne Produkte. Die App zeigt, wo es gerade im Angebot ist.',
    points: ['<b>＋ Hinzufügen</b> oder <b>☆</b> an einem Angebot. Die Zahl am Stern unten = Favoriten im Angebot.',
      'Antippen klappt die Angebote auf; die <b>Preis-Leiste</b> zeigt günstig (grün) bis teuer (rot) im Jahresvergleich.',
      'Nach links wischen entfernt einen Favoriten, <b>⋮</b> öffnet seine Einstellungen (z.B. Preisalarm).'], mock: 'fav' },
  { tab: 3, ico: '📝', title: 'Einkaufszettel',
    text: 'Einfach eintippen, z.B. „3 l Milch“. Der Zettel ist für alle in der Gruppe derselbe.',
    points: ['<b>Rechts wischen</b> = abhaken, <b>links wischen</b> = löschen, <b>antippen</b> = bearbeiten.',
      'In der Ansicht „Details“ zeigt <b>💡 im Angebot</b>, wo es etwas gibt; <b>lange drücken</b> listet die Angebote – nach rechts wischen ersetzt den Eintrag.',
      'Der <b>Verlauf</b> merkt sich, was ihr schon gekauft habt.'], mock: 'zettel' },
  { tab: 4, ico: '⚙️', title: 'Mehr',
    text: 'Einstellungen und Hilfe.',
    points: ['<b>Filter</b>: genutzte Apps, Kategorien ausblenden, einzelne Märkte.',
      '<b>Darstellung</b>: Start-Tab und 🔔 Benachrichtigung bei neuen Favoriten-Angeboten.',
      '<b>Über die App</b>: die ausführliche Anleitung zu allen Reitern · <b>Feedback</b> an den Entwickler.'], mock: 'mehr' },
];
const tourHtml = t => `<div class="tour-tabs">${TOUR_TABS.map(([i, l], k) => `<span class="${k === t.tab ? 'on' : ''}"><i>${i}</i>${l}</span>`).join('')}</div>
  <h2>${t.ico} ${t.title}</h2><p>${t.text}</p>
  ${t.demo ? `<div class="tour-demo"><div class="td-z">＋ Auf den Zettel</div><div class="td-w">❗ Wichtig</div>
    <div class="td-card"><span class="td-th">🧈</span><span><b>Markenbutter</b><small>Beispiel · 250 g</small></span><b class="td-p">5,16 €/kg</b></div></div>` : ''}
  ${t.mock ? TOUR_MOCK[t.mock]() : ''}
  <ul class="tour-pts">${t.points.map(x => `<li>${x}</li>`).join('')}</ul>`;

const INTRO = [
  ['🗂️', 'Kategorien & Alle', 'Angebote stöbern. Oben suchen und über die farbigen Chips Händler auswählen.'],
  ['👉', 'Nach rechts wischen', 'auf einem Angebot oder Favoriten – schon steht es auf dem Einkaufszettel.'],
  ['⭐', 'Favoriten', 'Produkte, Produktgruppen oder Marken merken. Die Zahl am Stern zeigt, wie viele gerade im Angebot sind.'],
  ['📝', 'Einkaufszettel', 'Eintrag nach rechts wischen = abhaken, nach links = löschen, antippen = Menge ändern, ⚙️ = Details. Vorschläge beim Tippen kennen eure Favoriten und den Verlauf.'],
  ['👥', 'Gruppe', 'Der Zettel ist für alle in der Gruppe derselbe – Änderungen erscheinen sofort bei den anderen.'],
  ['⚙️', 'Mehr', 'Gebiet & Händler, Filter, Darstellung und Start-Tab.'],
];
const introHtml = () => `<ul class="intro">${INTRO.filter(([, t]) => Cloud.enabled || t !== 'Gruppe')
  .map(([i, t, d]) => `<li><span class="intro-i">${i}</span><span><b>${t}</b><br><span class="muted">${d}</span></span></li>`).join('')}</ul>`;

function renderWizard() {
  const w = S.wizard, id = w.steps[w.step], last = w.step === w.steps.length - 1;
  const body = {
    welcome: () => `<h2>👋 Willkommen${Cloud.group() ? ` in der Gruppe „${esc(Cloud.group())}“` : ''}!</h2>
      <p>Die App vergleicht die Wochenangebote der Discounter und Supermärkte in eurer Gegend nach Grundpreis –
        und führt euren gemeinsamen Einkaufszettel.</p>
      <p class="muted">Erst ein, zwei Einstellungen, dann ein kurzer Rundgang durch alle Reiter (${TOUR.length} Seiten). Alles lässt sich später unter „Mehr“ ändern,
        die ausführliche Anleitung steht unter Mehr → Über die App.</p>`,
    area: () => `<h2>📍 Gebiet & Händler</h2>
      <p class="muted">Wo kauft ihr ein? Wohnort mit Umkreis, optional eine Strecke (z.B. Arbeitsweg) und die Händler.</p>${areaPanel()}`,
    start: () => `<h2>🏁 Start-Tab</h2><p class="muted">Was soll beim Öffnen der App erscheinen?</p>
      <div class="panel">${START_TABS.map(([k, l]) => `<label class="line switch"><input type="radio" name="wizStart" data-set="startTab" value="${k}" ${(S.f.startTab || '') === k ? 'checked' : ''}> ${l}</label>`).join('')}</div>`,
    intro: () => `<h2>💡 So funktioniert's</h2>${introHtml()}`,
  }[id]?.() ?? tourHtml(TOUR[Number(id.slice(4))]);
  view.innerHTML = `<div class="wiz">
    <div class="wiz-dots">${w.steps.map((_, i) => `<span class="${i === w.step ? 'on' : ''}"></span>`).join('')}</div>
    ${body}
    <div class="wiz-nav">
      ${w.step ? '<button class="btn" data-act="wizBack">Zurück</button>' : '<button class="btn" data-act="wizDone">Überspringen</button>'}
      <button class="btn primary" data-act="wizNext">${last ? 'Los geht\'s' : 'Weiter'}</button>
    </div></div>`;
}

Object.assign(onClick, {
  wizBack: () => { S.wizard.step--; render(); },
  wizNext: async () => {
    const w = S.wizard;
    if (w.steps[w.step] === 'area' && S.areaDraft && !$('[data-act="areaSave"]')?.disabled) await onClick.areaSave();
    if (w.step < w.steps.length - 1) { w.step++; S.areaDraft = null; render(); window.scrollTo(0, 0); }
    else onClick.wizDone();
  },
  wizDone: () => {
    save('onboarded', true);
    S.wizard = null;
    S.areaDraft = null;
    const st = S.f.startTab === 'last' ? '' : S.f.startTab || '';
    nav('#/' + st);
  },
  wizShow: () => { S.wizard = wizardStart(); render(); window.scrollTo(0, 0); },
});


document.addEventListener('submit', async e => {
  if (e.target.id === 'createForm') {
    e.preventDefault();
    e.target.querySelector('button').disabled = true;
    try {
      const code = await Cloud.createGroup($('#inviteCode').value, $('#groupName').value, $('#loginName').value);
      view.innerHTML = `<div class="panel login">
        <h2>✅ Gruppe „${esc(Cloud.group())}“ angelegt</h2>
        <p>Euer Gruppen-Code:</p><p class="grp-code big">${esc(code)}</p>
        <p class="muted">Gib ihn an die anderen weiter – damit schalten sie die App frei. Du findest ihn jederzeit unter
          Mehr → Gruppe.</p>
        <button class="btn primary" data-act="loginDone">Weiter</button></div>`;
    } catch (err) {
      showLogin(err.message, 'create');
    }
    return;
  }
  if (e.target.id !== 'loginForm') return;
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    if (await Cloud.login($('#loginCode').value, $('#loginName').value)) await afterLogin();
    else showLogin('Der Code stimmt nicht.');
  } catch (err) {
    showLogin(err instanceof LoginNeeded ? 'Der Code stimmt nicht.' : `Keine Verbindung: ${err.message}`);
  }
});

// Start; aufgerufen am Ende von list.js, wenn alle Teile geladen sind
function boot() {
  applyTheme();
  // App-Start ohne bestimmte Seite: eingestellten Start-Tab öffnen – nicht beim Aktualisieren (Wischen nach unten),
  // dann bleibt die aktuelle Seite (sessionStorage überlebt das Neuladen, nicht das Beenden der App)
  let reload = false;
  try { reload = !!sessionStorage.getItem('ap.session'); sessionStorage.setItem('ap.session', '1'); } catch { /* egal */ }
  if (!reload && (!location.hash || location.hash === '#/')) {
    const st = S.f.startTab === 'last' ? load('lastTab', '') : S.f.startTab || '';
    if (st) { history.replaceState(null, '', '#/' + st); lastHash = location.hash; }
  }
  initHistory();
  // Einführung beim ersten Start; bisherige Nutzer (schon angemeldet bzw. mit Zettel) sehen sie nicht automatisch
  if (!load('onboarded', false)) {
    if ((Cloud.enabled && Cloud.loggedIn()) || R.item.size || R.hist.size || S.favs.length) save('onboarded', true);
    else if (!Cloud.enabled) S.wizard = wizardStart();
  }
  render();
  if (Cloud.enabled && !Cloud.loggedIn()) showLogin();
  else {
    loadData();
    Sync.run();
    // Gerät in der Gruppe melden (letzter Besuch, höchstens stündlich); bisherige Geräte werden so Mitglied
    const before = JSON.stringify(grpSet());
    if (Cloud.enabled) Cloud.touch().then(() => {
      areaChanged(before);
      if (Cloud.switchedGroup()) { liResetGroup(); liFavsPush(S.favs); Sync.run(); liRefresh(); }
    }).catch(() => {});
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
