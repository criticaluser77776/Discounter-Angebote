'use strict';
/* Suche und Favoriten-Treffer – gemeinsam für die App (app.js) und den Service Worker (sw.js, Zählung neuer
   Favoriten-Angebote bei Push-Nachrichten). Braucht brands.js (bekannte Marken) davor. */

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

// Treffer eines Suchworts: kurze Wörter nur am Wortanfang, lange auch in Komposita; tippfehlertolerant nur mit fuzzy
// (Suche: erst ohne, damit „cola“ nicht „Collagen“/„Colgate“ findet)
function hit(t, s, words, fuzzy = true) {
  if (t.length < 5 ? s.includes(' ' + t) : s.includes(t)) return true;
  if (!fuzzy || t.length < 4) return false;
  const tol = t.length >= 8 ? 2 : 1;
  return words.some(w => w.length >= t.length - tol &&
    (lev(t, w.slice(0, t.length), tol) <= tol || lev(t, w, tol) <= tol));
}

// null = kein Treffer; strong = alle Suchwörter in Name/Marke/Gruppe (nicht nur in der Beschreibung)
function matchQuery(o, qt, fuzzy = false) {
  if (!qt.length) return null;
  let strong = true;
  for (const t of qt) {
    if (hit(t, o._ts, o._tw, fuzzy) || o._gs.includes(' ' + t)) continue;
    if (hit(t, o._ds, o._dw, fuzzy)) { strong = false; continue; }
    return null;
  }
  return { strong };
}

// Vergleichsmaß je Favorit: Grundpreis (Standard) oder Packungspreis (z.B. Kaffeekapseln, feste Packungsgrößen)
const byPack = f => f?.metric === 'price';

function tokMatch(a, b) {
  if (!a?.length || !b?.length) return false;
  const A = new Set(a), B = new Set(b);
  return a.every(t => B.has(t)) || b.every(t => A.has(t));
}

function favMatch(f, o) {
  switch (f.type) {
    case 'group':
      if (o.category !== f.category || (f.group && o.group !== f.group)) return false;
      if (f.brands?.length && !brandHit(f, o)) return false;
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
      if (f.category && (o.category !== f.category || (f.group && o.group !== f.group))) return false;
      if (f.brands?.length && !brandHit(f, o)) return false;
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

const bkey = s => norm(s).replace(/[^a-z0-9]/g, '');

// Namen aller bekannten Marken und Eigenmarken (Schlüssel -> Anzeigename) für brandHit
const KNOWN_NAME = new Map();
for (const [name] of (typeof KNOWN_OWN === 'undefined' ? [] : KNOWN_OWN)) KNOWN_NAME.set(bkey(name), name);
for (const list of Object.values(typeof KNOWN_BRANDS === 'undefined' ? {} : KNOWN_BRANDS))
  for (const n of list.split(',').map(x => x.trim()).filter(Boolean)) if (!KNOWN_NAME.has(bkey(n))) KNOWN_NAME.set(bkey(n), n);

// Marke eines Favoriten trifft ein Angebot: gleicher Markenschlüssel oder der Markenname als ganze Wortfolge im Titel
// (Prospekte führen z.B. Twix oft unter „Mars“)
const phraseCache = new Map();
function brandPhrase(name) {
  if (!phraseCache.has(name)) phraseCache.set(name, spaced(norm(name)).trim());
  return phraseCache.get(name);
}
function brandHit(f, o) {
  if (f.brands.includes(o.brand_key)) return true;
  const ts = o._ts + ' ';
  return f.brands.some(k => {
    const n = f.brandNames?.[k] || KNOWN_NAME.get(k);
    const ph = n && brandPhrase(n);
    return ph && ph.length >= 3 && ts.includes(' ' + ph + ' ');
  });
}
