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
  f: Object.assign({ only: [], place: '', hideApp: false, hideOnline: true, onlyCurrent: false, hideNonFood: false, theme: 'auto' },
    load('filters', {}), { off: undefined, only: [] }),  // only = markierte Händler (leer = alle), gilt nur bis zum Neustart
  favs: load('favs', []),
  favSort: load('favSort', 'offers'),  // Favoriten: 'offers' = mit Angeboten zuerst, 'own' = eigene Reihenfolge
  seen: new Set(load('seen', [])),
};

/* ---------- Text-Normalisierung & Suche ---------- */

function norm(s) {
  return (s || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
}
const spaced = s => ' ' + s.replace(/[^a-z0-9]+/g, ' ');
const qTokens = q => norm(q).split(/[^a-z0-9]+/).filter(t => t.length >= 2);

function prep(o) {
  o._ts = spaced(norm(`${o.brand} ${o.title}`));
  o._gs = spaced(norm(`${o.group} ${o.category}`));
  o._ds = spaced(norm(o.description));
  o._tw = o._ts.split(' ').filter(w => w.length >= 3);
  o._dw = o._ds.split(' ').filter(w => w.length >= 3);
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Treffer eines Suchworts: kurze Wörter nur am Wortanfang, lange auch in Komposita; sonst tippfehlertolerant
function hit(t, s, words) {
  if (t.length < 5 ? s.includes(' ' + t) : s.includes(t)) return true;
  if (t.length < 4) return false;
  const tol = t.length >= 8 ? 2 : 1;
  return words.some(w => w.length >= t.length - tol &&
    (lev(t, w.slice(0, t.length), tol) <= tol || lev(t, w, tol) <= tol));
}

// null = kein Treffer; strong = alle Suchwörter in Name/Marke/Gruppe (nicht nur in der Beschreibung)
function matchQuery(o, qt) {
  if (!qt.length) return null;
  let strong = true;
  for (const t of qt) {
    if (hit(t, o._ts, o._tw) || o._gs.includes(' ' + t)) continue;
    if (hit(t, o._ds, o._dw)) { strong = false; continue; }
    return null;
  }
  return { strong };
}

/* ---------- Preise & Filter ---------- */

function applyEff() {
  for (const o of S.offers) {
    if (S.f.hideApp && o.app_price && o.regular_price) {
      o.ep = o.regular_price;
      o.eu = o.unit_price ? Math.round(o.unit_price * o.regular_price / o.price * 100) / 100 : null;
      o.ea = false;
    } else {
      o.ep = o.price; o.eu = o.unit_price; o.ea = o.app_price;
    }
  }
}

function passes(o) {
  const f = S.f;
  if (f.only.length && !f.only.includes(o.retailer)) return false;
  if (f.place && o.places.length && !o.places.includes(f.place)) return false;
  if (f.hideApp && o.app_price && !o.regular_price) return false;
  if (f.hideOnline && o.online_only) return false;
  if (f.onlyCurrent && o.upcoming) return false;
  if (f.hideNonFood && o.category === 'Non-Food') return false;
  return true;
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
const RETAILER_ORDER = ['edeka', 'lidl', 'aldi', 'penny', 'rossmann', 'netto', 'rewe', 'combi'];
const rname = o => S.retailers[o.retailer]?.name || o.retailer;

function dshort(iso) {
  const d = new Date(iso + 'T00:00');
  return `${WD[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
}

function sortOffers(list, mode = S.sort) {
  const val = o => o.eu ?? Infinity;
  if (mode === 'price') return list.sort((a, b) => a.ep - b.ep);
  if (mode === 'discount') return list.sort((a, b) => (disc(b) || 0) - (disc(a) || 0) || val(a) - val(b));
  // Grundpreis: Einheiten nicht vermischen – häufigste Einheit zuerst, innerhalb aufsteigend
  const cnt = {};
  for (const o of list) if (o.eu) cnt[o.unit] = (cnt[o.unit] || 0) + 1;
  const rank = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  const r = o => o.eu ? rank.indexOf(o.unit) : 99;
  return list.sort((a, b) => r(a) - r(b) || val(a) - val(b) || a.ep - b.ep);
}

function countBy(list, fn) {
  const c = {};
  for (const x of list) { const k = fn(x); c[k] = (c[k] || 0) + 1; }
  return c;
}

/* ---------- Favoriten ---------- */

function tokMatch(a, b) {
  if (!a?.length || !b?.length) return false;
  const A = new Set(a), B = new Set(b);
  return a.every(t => B.has(t)) || b.every(t => A.has(t));
}

function favMatch(f, o) {
  switch (f.type) {
    case 'group':
      if (o.category !== f.category || (f.group && o.group !== f.group)) return false;
      if (f.brands?.length && !f.brands.includes(o.brand_key)) return false;
      if (f.brandOnly && o.brand_type !== 'marke') return false;
      break;
    case 'brand':
      if (o.brand_key !== f.brand_key) return false;
      break;
    case 'product':
      if (o.brand_key !== f.brand_key || !tokMatch(f.tokens, o.tokens)) return false;
      break;
    case 'search':
      if (!matchQuery(o, qTokens(f.q))?.strong) return false;
      // mitgemerkte Filter der Suche: Produktgruppe und Marken
      if (f.category && (o.category !== f.category || o.group !== f.group)) return false;
      if (f.brands?.length && !f.brands.includes(o.brand_key)) return false;
      break;
    default:
      return false;
  }
  if (f.max) {
    if (byPack(f)) { if (o.ep > f.max) return false; }
    else if (!(o.eu && o.unit === (f.maxUnit || o.unit) && o.eu <= f.max)) return false;
  }
  return true;
}

// Vergleichsmaß je Favorit: Grundpreis (Standard) oder Packungspreis (z.B. Kaffeekapseln, feste Packungsgrößen)
const byPack = f => f?.metric === 'price';
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

function saveFavs() { save('favs', S.favs); liFavsPush(S.favs); updateBadges(); }
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
    names[k] = x ? (x.brand || 'Ohne Marke') : k;
  }
  return names;
}

// Gruppenfavorit anlegen/aktualisieren/entfernen (eine Auswahl je Gruppe)
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
  for (const { m } of favRows(vis)) for (const o of m) if (!S.seen.has(o.id)) ids.add(o.id);
  return ids.size;
}

function markSeen(ids) {
  const current = new Set(S.offers.map(o => o.id));
  S.seen = new Set([...S.seen, ...ids].filter(id => current.has(id)));
  save('seen', [...S.seen]);
  updateBadges();
}

/* ---------- Einkaufszettel: siehe list.js (Li.hasOffer, Li.toggleOffer, Li.addWish) ---------- */

const inList = o => Li.hasOffer(o);

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

function card(o, opts = {}) {
  const r = S.retailers[o.retailer] || { name: o.retailer, color: '#888' };
  const d = disc(o);
  const tags = [];
  if (opts.isNew?.(o)) tags.push('<span class="tag newt">NEU</span>');
  if (d && d > 0) tags.push(`<span class="tag red">−${d}%</span>`);
  if (o.ea) tags.push(`<span class="tag app">📱 ${esc(appName(o))}</span>`);
  else if (o.app_note && !S.f.hideApp) tags.push(`<span class="tag app" title="${esc(o.app_note)}">📱 ${esc(appNoteShort(o))}</span>`);
  if (o.online_only) tags.push('<span class="tag">online</span>');
  if (o.upcoming) tags.push(`<span class="tag blue">ab ${dshort(o.valid_from)}</span>`);
  else if (o.valid_to) tags.push(`<span class="tag">bis ${dshort(o.valid_to)}</span>`);
  if (o.markets?.length > 1) tags.push(`<span class="tag">${o.markets.length} Märkte</span>`);
  const img = o.image
    ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(o.image)}" alt="" onerror="this.replaceWith('${ICONS[o.category] || '📦'}')">`
    : ICONS[o.category] || '📦';
  return `<article class="card" data-act="open" data-id="${esc(o.id)}">
    <div class="thumb">${img}</div>
    <div class="info">
      <div class="meta"><span class="rt" style="--c:${r.color}">${esc(r.name)}</span>${o.brand ? `<span class="brand">${esc(o.brand)}</span>` : ''}</div>
      <h3>${esc(o.name || o.title)}</h3>
      ${o.description ? `<p class="desc">${esc(o.description)}</p>` : ''}
      <div class="tags">${tags.join('')}</div>
    </div>
    <div class="side">
      ${priceBlock(o, opts.metric)}
      <div class="acts">
        <button class="ic ${isProductFav(o) ? 'on' : ''}" data-act="star" data-id="${esc(o.id)}" aria-label="Produkt merken">★</button>
        <button class="ic add ${inList(o) ? 'on' : ''}" data-act="add" data-id="${esc(o.id)}" aria-label="Auf den Einkaufszettel">＋</button>
        <button class="ic prio ${Li.isPrioOffer(o) ? 'on' : ''}" data-act="prioOffer" data-id="${esc(o.id)}" aria-label="Wichtig auf den Einkaufszettel">❗</button>
      </div>
    </div>
  </article>`;
}

function offerList(list, opts = {}) {
  if (!list.length) return '<p class="empty">Keine passenden Angebote.</p>';
  const limit = opts.limit ?? S.limit;
  const headers = (opts.sort ?? S.sort) === 'unit';
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
  return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

const groupsOf = cat => [...new Set([...(S.groups[cat] || []), OTHER])];

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
  h += `<div class="chips scroll"><a class="chip ${group ? '' : 'on'}" href="#/c/${enc(cat)}">Alle <i>${all.length}</i></a>` +
    groups.map(g => `<a class="chip ${g === group ? 'on' : ''}" href="#/c/${enc(cat)}/${enc(g)}">${esc(g)} <i>${gc[g]}</i></a>`).join('') + '</div>';
  if (group) {
    const brands = brandCounts(list);
    h += `<div class="chips scroll"><button class="chip ${S.brandOnly ? 'on' : ''}" data-act="brandOnly">Nur Markenprodukte</button>` +
      brands.map(b => `<button class="chip ${S.brands.has(b.key) ? 'on' : ''}" data-act="brand" data-b="${esc(b.key)}">${esc(b.name)} <i>${b.n}</i></button>`).join('') + '</div>';
    if (S.brandOnly) list = list.filter(o => o.brand_type === 'marke');
    if (S.brands.size) list = list.filter(o => S.brands.has(o.brand_key));
    const ex = findFav({ type: 'group', category: cat, group });
    const same = ex && JSON.stringify(ex.brands || []) === JSON.stringify([...S.brands].sort()) && !!ex.brandOnly === S.brandOnly;
    const label = ex ? (same ? '★ Gemerkt' : '★ Auswahl übernehmen') : (S.brands.size ? '☆ Auswahl merken' : '☆ Gruppe merken');
    h += `<div class="chips wrap">
      <button class="btn ${ex ? 'on' : ''}" data-act="groupFav" data-c="${esc(cat)}" data-g="${esc(group)}">${label}</button>
      <button class="btn" data-act="groupWish" data-c="${esc(cat)}" data-g="${esc(group)}">＋ Zettel</button>
      <a class="btn" href="#/add/${enc(cat)}/${enc(group)}">Marken & Produkte ›</a></div>`;
  }
  h += sortbar(list.length) + offerList(sortOffers(list));
  view.innerHTML = h;
}

// Tab „Alle“: alle Angebote der gewählten Händler, nach Kategorie, darin nach Rabatt (höchster zuerst), sonst A–Z
function renderAll() {
  const rank = new Map(S.categories.map((c, i) => [c, i]));
  const disc = o => (o.discount > 0 && o.discount < 100 ? o.discount : 0);
  const list = visible().sort((a, b) => (rank.get(a.category) ?? 999) - (rank.get(b.category) ?? 999)
    || disc(b) - disc(a) || (a.name || '').localeCompare(b.name || '', 'de'));
  const sel = S.f.only.map(k => S.retailers[k]?.name || k);
  let h = `<div class="head"><h2>🏷️ Alle Angebote</h2></div>
    <div class="sortbar"><span>${list.length} Angebote · ${sel.length ? esc(sel.join(', ')) : 'alle Händler'}</span></div>`;
  if (!list.length) { view.innerHTML = h + '<p class="empty">Keine passenden Angebote.</p>'; return; }
  h += '<div class="list">';
  let last = null;
  for (const o of list.slice(0, S.limit)) {
    if (o.category !== last) {
      h += `<div class="unit-head cat-head">${ICONS[o.category] || '📦'} ${esc(o.category)}</div>`;
      last = o.category;
    }
    h += card(o);
  }
  if (list.length > S.limit) h += `<button class="btn more-btn" data-act="more" data-auto>Weitere ${list.length - S.limit} werden geladen …</button>`;
  view.innerHTML = h + '</div>';
}

function renderSearch() {
  const qt = qTokens(S.q);
  const res = [];
  for (const o of visible()) {
    const m = matchQuery(o, qt);
    if (m) res.push([o, m.strong]);
  }
  const strong = res.filter(r => r[1]).map(r => r[0]);
  const weakN = res.length - strong.length;
  let list = strong.length && !S.showWeak ? strong : res.map(r => r[0]);
  const fc = countBy(list, o => o.category + '\u0001' + o.group);
  const facets = Object.entries(fc).sort((a, b) => b[1] - a[1]).slice(0, 14);
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
    h += '<p class="sub">Nach Produktgruppe eingrenzen:</p><div class="chips scroll">' +
      `<button class="chip ${S.qFacet ? '' : 'on'}" data-act="facet" data-k="">Alle</button>` +
      facets.map(([k, n]) => {
        const [c, g] = k.split('\u0001');
        return `<button class="chip ${S.qFacet === k ? 'on' : ''}" data-act="facet" data-k="${esc(k)}" title="${esc(c)}">${ICONS[c] || ''} ${esc(g === OTHER ? c : g)} <i>${n}</i></button>`;
      }).join('') + '</div>';
  }
  if (brands.length > 1 || S.qBrands.size) {
    h += '<p class="sub">Nach Marke eingrenzen:</p><div class="chips scroll">' +
      `<button class="chip ${S.qBrands.size ? '' : 'on'}" data-act="qBrand" data-b="">Alle</button>` +
      brands.map(b => `<button class="chip ${S.qBrands.has(b.key) ? 'on' : ''}" data-act="qBrand" data-b="${esc(b.key)}">${esc(b.name)} <i>${b.n}</i></button>`).join('') +
      '</div>';
  }
  if (weakN && strong.length && !S.showWeak) {
    h += `<div class="chips"><button class="btn small" data-act="showWeak">+ ${weakN} Treffer nur in der Beschreibung</button></div>`;
  }
  h += sortbar(list.length) + offerList(sortOffers(list));
  view.innerHTML = h;
}

function dominantUnit(list) {
  const c = countBy(list.filter(o => o.eu), o => o.unit);
  return Object.keys(c).sort((a, b) => c[b] - c[a])[0];
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
  const rows = favRows(vis);
  if (!own) rows.sort((a, b) => (b.m.length > 0) - (a.m.length > 0));
  h += `<div class="sortbar"><span>${S.favs.length} Favorit${S.favs.length === 1 ? '' : 'en'}${own ? ' · zum Verschieben ⠿ ziehen' : ''}</span>
    <div class="seg"><button class="${own ? '' : 'on'}" data-act="favSort" data-s="offers">Angebote zuerst</button>
    <button class="${own ? 'on' : ''}" data-act="favSort" data-s="own">Eigene Reihenfolge</button></div></div>`;
  const seenNow = [];
  const isNew = o => !S.seen.has(o.id);
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
      <div class="t"><b>${esc(L.title)}</b><small>${esc(L.sub)}${pack ? ' · Packungspreis' : ''}${f.max ? ` · ${esc(maxLabel(f))}` : ''}</small></div>
      <div class="fav-r">${m.length ? `<span class="cnt">${m.length}</span>` : '<span class="none">kein Angebot</span>'}
        ${fresh ? `<span class="new">${fresh} neu</span>` : ''}
        ${best ? `<span class="fav-best${best.ea ? ' is-app' : ''}">ab ${best.ea ? '📱 ' : ''}${esc(pack ? `${fmt(best.ep)} €` : priceLine(best))}</span>
          <span class="fav-rt">${esc(rname(best))}</span>` : ''}
        <span class="fav-acts">
          <button class="ic add ${wish ? 'on' : ''}" data-act="favWish" data-fid="${f.id}" aria-label="Auf den Einkaufszettel">＋</button>
          <button class="ic prio ${wish?.prio ? 'on' : ''}" data-act="favWish" data-fid="${f.id}" data-prio="1" aria-label="Wichtig auf den Einkaufszettel">❗</button>
          <button class="ic ${settings ? 'on' : ''}" data-act="favSettings" data-fid="${f.id}" aria-label="Einstellungen">⚙️</button>
        </span></div></div>`;
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
      h += offerList(m, { limit: 200, sort: metricSort(f), metric: metricSort(f), isNew });
      m.forEach(o => seenNow.push(o.id));
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
  } else if (!group) {
    const entries = S.catalog.filter(e => e.category === cat);
    const gc = countBy(entries, e => e.group);
    const lc = countBy(entries.filter(e => live.has(e.product_key)), e => e.group);
    const whole = findFav({ type: 'group', category: cat, group: null });
    h = `<div class="head"><h2>${ICONS[cat] || ''} ${esc(cat)}</h2></div>
      <p class="sub">Haken = ganze Produktgruppe merken. Pfeil = Marken und Produkte auswählen.</p>
      <div class="rows"><div class="row ${whole ? 'sel' : ''}">
        <button class="check ${whole ? 'on' : ''}" data-act="pickGroup" data-c="${esc(cat)}" data-g="">✓</button>
        <div class="t"><b>Ganze Kategorie</b><small>alle ${entries.length} Produkte</small></div></div>` +
      groupsOf(cat).filter(g => gc[g]).map(g => {
        const f = findFav({ type: 'group', category: cat, group: g });
        const sel = f ? (f.brands?.length ? `${f.brands.length} Marke${f.brands.length > 1 ? 'n' : ''} gewählt` : 'alle Marken') : '';
        return `<div class="row ${f ? 'sel' : ''}">
          <button class="check ${f ? 'on' : ''}" data-act="pickGroup" data-c="${esc(cat)}" data-g="${esc(g)}">✓</button>
          <a class="t" href="#/add/${enc(cat)}/${enc(g)}"><b>${esc(g)}</b>
            <small>${gc[g]} Produkte${lc[g] ? ` · <span class="live">${lc[g]} im Angebot</span>` : ''}${sel ? ' · ★ ' + sel : ''}</small></a>
          <a class="chev" href="#/add/${enc(cat)}/${enc(g)}">›</a></div>`;
      }).join('') + '</div>';
  } else {
    const d = draftFor(cat, group);
    h = `<div class="head"><h2>${esc(group)}</h2><a class="btn small" href="#/c/${enc(cat)}/${enc(group)}">Angebote ansehen</a></div>
      <p class="sub">${esc(cat)} · Marken ankreuzen (keine Auswahl = alle Marken) oder mit ★ einzelne Produkte merken.</p>
      <div class="chips wrap"><label class="switch"><input type="checkbox" data-field="draftBrandOnly" ${d.brandOnly ? 'checked' : ''}> Nur Markenprodukte (ohne Handelsmarken)</label></div>
      <input id="pickQ" class="filter-input" type="search" placeholder="Marke oder Produkt filtern …" value="${esc(S.pickQ)}">
      <div id="pickList">${pickList(cat, group, live)}</div>
      <div class="savebar"><span id="draftInfo">${draftInfo(d)}</span>
        <span style="display:flex;gap:8px">${d.exists ? '<button class="btn danger" data-act="draftDel">Entfernen</button>' : ''}
        <button class="btn primary" data-act="draftSave">${d.exists ? 'Aktualisieren' : 'Gruppe merken'}</button></span></div>`;
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
  let list = [...brands.values()];
  if (q) {
    list = list.map(b => {
      if (norm(b.name).includes(q)) return b;
      const items = b.items.filter(e => norm(e.name).includes(q));
      return items.length ? { ...b, items, forceOpen: true } : null;
    }).filter(Boolean);
  }
  list.sort((a, b) => b.live - a.live || b.items.length - a.items.length || a.name.localeCompare(b.name));
  if (!list.length) return '<p class="empty">Nichts gefunden.</p>';
  return '<div class="rows">' + list.map(b => {
    const on = d.brands.has(b.key);
    const open = b.forceOpen || S.pickOpen === b.key;
    let r = `<div class="row ${on ? 'sel' : ''}">
      <button class="check ${on ? 'on' : ''}" data-act="draftBrand" data-b="${esc(b.key)}">✓</button>
      <div class="t" data-act="pickOpen" data-b="${esc(b.key)}"><b>${esc(b.name)}</b>
        <small>${b.items.length} Produkt${b.items.length > 1 ? 'e' : ''}${b.live ? ` · <span class="live">${b.live} im Angebot</span>` : ''}${b.type === 'eigen' ? ' · Handelsmarke' : ''}</small></div>
      <button class="ic" data-act="pickOpen" data-b="${esc(b.key)}" aria-label="Produkte zeigen">${open ? '▾' : '›'}</button></div>`;
    if (open) {
      r += b.items.sort((x, y) => live.has(y.product_key) - live.has(x.product_key) || x.name.localeCompare(y.name)).map(e => {
        const f = catalogProductFav(e);
        const has = !!findFav(f);
        const best = e.best?.unit_price ? `${fmt(e.best.unit_price)} €/${e.best.unit}` : e.best ? `${fmt(e.best.price)} €` : '';
        return `<div class="row sub">
          <button class="ic ${has ? 'on' : ''}" data-act="pickProduct" data-pk="${esc(e.product_key)}">★</button>
          <div class="t">${esc(e.name)}<small>${live.has(e.product_key) ? '<span class="live">im Angebot</span> · ' : ''}${best ? `bester Preis bisher ${best} (${esc(S.retailers[e.best.retailer]?.name || e.best.retailer)})` : ''}</small></div></div>`;
      }).join('');
    }
    return r;
  }).join('') + '</div>';
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
}

function renderMore() {
  const f = S.f;
  const counts = countBy(S.offers, o => o.retailer);
  view.innerHTML = `<div class="head"><h2>⚙️ Einstellungen & Daten</h2></div>
    <div class="panel"><h3>Filter</h3>
      <label class="line">Ort <select data-set="place"><option value="">Alle Orte der Strecke</option>
        ${S.places.map(p => `<option value="${p.key}" ${f.place === p.key ? 'selected' : ''}>${esc(p.name)} (${p.zip})</option>`).join('')}</select></label>
      <label class="line switch"><input type="checkbox" data-set="hideApp" ${f.hideApp ? 'checked' : ''}> App-/Kundenkartenpreise ignorieren (Normalpreis verwenden)</label>
      <label class="line switch"><input type="checkbox" data-set="hideOnline" ${f.hideOnline ? 'checked' : ''}> Nur-online-Angebote ausblenden</label>
      <label class="line switch"><input type="checkbox" data-set="onlyCurrent" ${f.onlyCurrent ? 'checked' : ''}> Nur aktuell gültige (keine Vorschau auf nächste Woche)</label>
      <label class="line switch"><input type="checkbox" data-set="hideNonFood" ${f.hideNonFood ? 'checked' : ''}> Non-Food ausblenden</label>
      <p class="muted" style="margin:6px 0 0;font-size:.85rem">Oben über die farbigen Chips Händler markieren: dann werden nur diese angezeigt, ohne Markierung alle.</p>
    </div>
    <div class="panel"><h3>Darstellung</h3>
      <label class="line">Farbschema <select data-set="theme">
        ${[['auto', 'wie System'], ['light', 'hell'], ['dark', 'dunkel']].map(([k, l]) => `<option value="${k}" ${f.theme === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="panel"><h3>Daten</h3>
      <p style="margin:0 0 8px">${S.offers.length} Angebote · Stand ${S.generated ? new Date(S.generated).toLocaleString('de-DE') : '–'}</p>
      <p class="muted" style="margin:0 0 8px;font-size:.85rem">${Object.entries(S.retailers).map(([k, r]) => `${esc(r.name)} ${counts[k] || 0}`).join(' · ')}</p>
      ${DATA.server ? '' : '<p class="muted" style="margin:0 0 8px;font-size:.85rem">Die Angebote werden täglich vom PC zu Hause abgerufen und hochgeladen.</p>'}
      <div id="status"><p class="muted">Status wird geladen …</p></div>
    </div>
    ${Cloud.enabled ? `<div class="panel"><h3>Familie</h3>
      <label class="line">Dein Name <input class="filter-input" style="margin:0;width:auto;flex:1" data-set-name value="${esc(Cloud.name())}" placeholder="z.B. Anna"></label>
      <p class="muted" style="margin:4px 0 8px;font-size:.85rem">Erscheint beim Einkaufszettel als „von …“ bei den anderen.
        Deine Favoriten werden zwischen allen Geräten mit demselben Namen abgeglichen.</p>
      <button class="btn small" data-act="logout">Familien-Code auf diesem Gerät entfernen</button></div>` : ''}
    <div class="panel"><h3>Über die App</h3>
      ${appVersionLine()}
    </div>
    <div class="panel"><h3>Als App installieren</h3>
      <p class="muted" style="margin:0;font-size:.88rem">Android/Chrome: Menü ⋮ → „App installieren“.
      iPhone/Safari: Teilen → „Zum Home-Bildschirm“.</p>
    </div>`;
  loadStatus();
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

async function openDetail(id) {
  const o = S.byId.get(id);
  if (!o) return;
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
      <div><span>Einordnung</span><span><a href="#/c/${enc(o.category)}/${enc(o.group)}" data-act="goto">${esc(o.category)} › ${esc(o.group)}</a></span></div>
      ${o.markets?.length ? `<div><span>Märkte</span><span>${o.markets.slice(0, 8).map(esc).join('<br>')}${o.markets.length > 8 ? `<br>+ ${o.markets.length - 8} weitere` : ''}</span></div>` : ''}
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
    ${S.f.hideApp && o.app_price ? ' · App-Preise werden laut Einstellung nicht berücksichtigt' : ''}</p>`;
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
  el.innerHTML = `<h3>Preisverlauf</h3><p class="hint" style="margin:6px 0">${hint}</p>
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
  if (!S.loaded) return;
  if (tab === 'browse') {
    if (S.q) renderSearch();
    else if (r[0] === 'c' && r[1]) renderCategory(r[1], r[2]);
    else renderHome();
  } else if (r[0] === 'add') renderPicker(r[1], r[2]);
  else if (tab === 'favs') renderFavs();
  else if (tab === 'list') renderShop();
  else if (tab === 'all') renderAll();
  else renderMore();
  updateBadges();
}

// Position in „Kategorien“ und „Alle“ merken (nur im Speicher, also bis zum Neustart der App):
// Unterseite, Suche, Filter, geladene Menge und Scrollposition
const tabOf = hash => {
  const r = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return r[0] === 'all' ? 'all' : !r[0] || r[0] === 'c' ? 'browse' : null;
};
const tabMem = {};
let lastHash = location.hash || '#/', restoring = null;

function onRoute() {
  const old = tabOf(lastHash);
  if (old) tabMem[old] = { hash: lastHash, y: window.scrollY, limit: S.limit, brands: S.brands, brandOnly: S.brandOnly,
    q: S.q, qFacet: S.qFacet, qBrands: new Set(S.qBrands), showWeak: S.showWeak };
  lastHash = location.hash || '#/';
  const m = restoring && restoring.hash === lastHash ? restoring : null;
  restoring = null;
  S.limit = m?.limit || 60;
  S.brands = m?.brands || new Set();
  S.brandOnly = m?.brandOnly || false;
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
  if ((location.hash || '#/') === m.hash) onRoute(); else location.hash = m.hash;
});

function renderChips() {
  $('#retailerChips').innerHTML = Object.entries(S.retailers).map(([k, r]) =>
    `<button class="chip ${S.f.only.includes(k) ? 'sel' : ''}" data-act="rt" data-r="${k}" style="--c:${r.color}"><span class="dot"></span>${esc(r.name)}</button>`
  ).join('');
}

function updateBadges() {
  if (!S.loaded) return;
  const fresh = freshCount(visible());
  const fb = $('#favBadge');
  fb.hidden = !fresh;
  fb.textContent = fresh;
  const open = Li.openCount();
  const lb = $('#listBadge');
  lb.hidden = !open;
  lb.textContent = open;
}

function applyTheme() {
  if (S.f.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = S.f.theme;
}

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
  sort: el => { S.sort = el.dataset.s; save('sort', S.sort); rerender(); },
  rt: el => {
    const k = el.dataset.r;
    S.f.only = S.f.only.includes(k) ? S.f.only.filter(x => x !== k) : [...S.f.only, k];
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
  facet: el => { S.qFacet = el.dataset.k || null; S.qBrands.clear(); S.limit = 60; rerender(); },
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
    location.hash = '#/add/' + enc(d.cat);
  },
  draftDel: () => {
    const d = S.draft;
    const ex = findFav({ type: 'group', category: d.cat, group: d.group });
    if (ex) { S.favs = S.favs.filter(x => x !== ex); saveFavs(); toast(`„${d.group}“ entfernt`); }
    S.draft = null;
    location.hash = '#/add/' + enc(d.cat);
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
    hideSheet();
    history.replaceState(null, '', el.getAttribute('href'));
    onRoute();
  },
  closeSheet: () => closeSheet(),
  logout: async () => {
    if (!confirm('Familien-Code auf diesem Gerät entfernen? Zum erneuten Zugriff muss er wieder eingegeben werden.')) return;
    await Cloud.logout();
    S.loaded = false;
    showLogin();
  },
  refresh: async () => {
    await DATA.refresh();
    S.wasRunning = true;
    loadStatus();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
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
    if (S.q && r[0] && r[0] !== 'c') { location.hash = '#/'; return; }
    render();
  }, 160);
});
qInput.addEventListener('keydown', e => { if (e.key === 'Enter') qInput.blur(); });
$('#clearQ').addEventListener('click', () => { clearSearch(); qInput.focus(); });

$('#back').addEventListener('click', () => {
  if (S.q) { clearSearch(); return; }
  const r = route();
  if (r[0] === 'c') location.hash = r.length > 2 ? `#/c/${enc(r[1])}` : '#/';
  else if (r[0] === 'add') location.hash = r.length > 1 ? '#/' + ['add', ...r.slice(1, -1)].map(enc).join('/') : '#/favs';
  else location.hash = '#/';
});

window.addEventListener('hashchange', onRoute);
window.addEventListener('popstate', () => { if (S.sheetOpen) hideSheet(); });
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
    S.offers = j.offers;
    // feste Reihenfolge der Händler (auch für bereits hochgeladene Daten); unbekannte hinten anhängen
    const rank = k => { const i = RETAILER_ORDER.indexOf(k); return i < 0 ? 99 : i; };
    S.retailers = Object.fromEntries(Object.entries(j.retailers).sort(([a], [b]) => rank(a) - rank(b)));
    if (S.retailers.aldi) S.retailers.aldi = { ...S.retailers.aldi, name: 'Aldi' };  // auch für ältere hochgeladene Daten
    S.categories = j.categories;
    S.groups = j.groups;
    S.places = j.places;
    S.placeName = Object.fromEntries(j.places.map(p => [p.key, p.name]));
    S.generated = j.generated;
    S.byId = new Map(S.offers.map(o => [o.id, o]));
    S.offers.forEach(prep);
    applyEff();
    S.catalog = null;
    S.loaded = true;
    renderChips();
    render();
  } catch (err) {
    if (err instanceof LoginNeeded) { showLogin(err.message); return; }
    view.innerHTML = `<p class="empty">Angebote konnten nicht geladen werden.<br><small>${esc(err.message)}</small><br><br>
      <button class="btn" onclick="location.reload()">Erneut versuchen</button></p>`;
  }
}

// Zugang zur veröffentlichten Fassung: Familien-Code + Name, einmal je Gerät
function showLogin(msg) {
  S.loaded = false;
  view.innerHTML = `<div class="panel login">
    <h2>🔒 Familien-Zugang</h2>
    <p class="muted">Einmal auf diesem Gerät den Familien-Code eingeben – danach bleibt die App freigeschaltet.</p>
    ${msg && msg !== 'Bitte Familien-Code eingeben' ? `<p class="err">${esc(msg)}</p>` : ''}
    <form id="loginForm">
      <label class="li-f">Familien-Code<input id="loginCode" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
      <label class="li-f">Dein Name (auf allen eigenen Geräten gleich – dann werden deine Favoriten abgeglichen)<input id="loginName" value="${esc(Cloud.name())}" placeholder="z.B. Anna" autocomplete="given-name" required></label>
      <button class="btn primary">Freischalten</button>
    </form></div>`;
}

document.addEventListener('submit', async e => {
  if (e.target.id !== 'loginForm') return;
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    if (await Cloud.login($('#loginCode').value, $('#loginName').value)) {
      view.innerHTML = '<p class="loading">Lade Angebote …</p>';
      liFavsPush(S.favs);
      await loadData();
      Sync.run();
    } else {
      showLogin('Der Code stimmt nicht.');
    }
  } catch (err) {
    showLogin(err instanceof LoginNeeded ? 'Der Code stimmt nicht.' : `Keine Verbindung: ${err.message}`);
  }
});

// Start; aufgerufen am Ende von list.js, wenn alle Teile geladen sind
function boot() {
  applyTheme();
  render();
  if (Cloud.enabled && !Cloud.loggedIn()) showLogin();
  else { loadData(); Sync.run(); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
