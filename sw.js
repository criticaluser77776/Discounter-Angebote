// Service Worker: App-Gerüst aus dem Cache, API-Daten "network first" mit Offline-Fallback.
// Pfade relativ zum Ort des Service Workers, damit die App auch unter …github.io/<repo>/ läuft.
const SHELL = 'shell-v65';
const DATA = 'data-v1';
const BASE = new URL('./', self.location).pathname;
const SHELL_FILES = ['./', 'index.html', 'app.js', 'cloud.js', 'goods.js', 'brands.js', 'match.js', 'list.js', 'config.js', 'style.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

// Suche/Favoriten-Treffer wie in der App (für die Zählung neuer Favoriten-Angebote bei Push)
try { importScripts('brands.js', 'match.js'); } catch { /* ohne Zählung: allgemeiner Hinweis */ }

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(f => new Request(f, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => /^(shell|data)-/.test(k) && k !== SHELL && k !== DATA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith(BASE + 'api/')) {
    if (url.pathname === BASE + 'api/status') return;  // immer live
    e.respondWith(fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(DATA).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request)));
    return;
  }
  // Gerüst: erst Netz, dabei den HTTP-Cache umgehen (GitHub Pages erlaubt 10 Min. Zwischenspeichern) –
  // unveränderte Dateien kosten dank ETag kaum Daten; offline aus dem Cache
  // (Seitenaufrufe lassen sich nicht mit Optionen weiterreichen -> neu über die URL anfragen)
  const fresh = e.request.mode === 'navigate'
    ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(fetch(fresh)
    .then(r => { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match(BASE))));
});

/* ---------- Push nach dem Abruf: neue Favoriten-Angebote zählen und anzeigen ---------- */

async function pushCtx() {
  try {
    const r = await (await caches.open('ap-ctx')).match('https://cache.local/ctx');
    return r ? r.json() : null;
  } catch { return null; }
}

async function loadOffers(cloud) {
  const r = await fetch(`${cloud.url}/rest/v1/app_data?key=eq.offers&select=data,updated_at`, {
    headers: { apikey: cloud.key, 'x-family-code': cloud.code, 'x-device': cloud.device },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const rows = await r.json();
  if (!rows.length) return [];
  // gleich für den nächsten App-Start zwischenspeichern (wie cloud.js)
  try {
    const c = await caches.open('ap-cloud-v1');
    await c.put(new Request('https://cache.local/offers'),
      new Response(JSON.stringify(rows[0].data), { headers: { 'x-updated': rows[0].updated_at } }));
  } catch { /* egal */ }
  return rows[0].data.offers || [];
}

// neue (noch nicht gesehene) Angebote, die einen Favoriten treffen und die Filter der App bestehen;
// gezählt je zusammengefasstem Angebot (wie aggregate in app.js, Kennung = erste Variante)
function countNew(ctx, offers) {
  const f = ctx.f || {}, seen = new Set(ctx.seen || []), area = ctx.area && new Set(ctx.area);
  const noApp = f.noApp || [], markets = f.markets || {}, hideCats = f.hideCats || [];
  const groups = new Map();
  for (const v of offers) {
    const k = [v.retailer === 'marktkauf' ? 'edeka' : v.retailer, v.brand_key, norm(v.title), v.valid_from, v.valid_to].join('|');
    if (!groups.has(k)) groups.set(k, { key: v.id, vs: [] });
    groups.get(k).vs.push(v);
  }
  let n = 0;
  for (const g of groups.values()) {
    if (seen.has(g.key)) continue;
    const hit = g.vs.some(o => {
      if (ctx.grpRet && !ctx.grpRet.includes(o.retailer)) return false;
      if (area && o.places?.length && !o.places.some(p => area.has(p))) return false;
      if (f.hideOnline && o.online_only) return false;
      if (f.onlyCurrent && o.upcoming) return false;
      if (hideCats.includes(o.category)) return false;
      const ms = markets[o.retailer];
      if (ms?.[0] === '-') return false;
      if (ms?.length && o.markets?.length && !o.markets.some(m => ms.includes(m))) return false;
      if (o.app_price && noApp.includes(o.retailer)) {
        if (!o.regular_price) return false;
        o.ep = o.regular_price;
        o.eu = o.unit_price ? Math.round(o.unit_price * o.regular_price / o.price * 100) / 100 : null;
      } else { o.ep = o.price; o.eu = o.unit_price; }
      prep(o);
      return (ctx.favs || []).some(fv => favMatch(fv, o));
    });
    if (hit) n++;
  }
  return n;
}

self.addEventListener('push', e => {
  let msg = {};
  try { msg = e.data?.json() || {}; } catch { /* ohne Inhalt */ }
  e.waitUntil((async () => {
    if (msg.t === 'test') {  // python -m backend.push --test
      await self.registration.showNotification('🔔 Test-Benachrichtigung', {
        tag: 'favs', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', body: 'Benachrichtigungen funktionieren.',
        data: { url: BASE + '#/favs' } });
      return;
    }
    let n = null;
    const ctx = await pushCtx();
    if (ctx?.cloud?.code && typeof favMatch === 'function') {
      try { n = countNew(ctx, await loadOffers(ctx.cloud)); } catch { n = null; }
    }
    const opts = { tag: 'favs', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: BASE + '#/favs' } };
    if (n === 0) {
      // Chrome verlangt eine sichtbare Meldung je Push – ohne Treffer gleich wieder schließen
      await self.registration.showNotification('Neue Angebote geladen', { ...opts, silent: true });
      (await self.registration.getNotifications({ tag: 'favs' })).forEach(x => x.close());
      return;
    }
    const title = n ? `${n} neue${n === 1 ? 's' : ''} Favoriten-Angebot${n === 1 ? '' : 'e'}` : 'Neue Angebote sind da';
    await self.registration.showNotification(title, { ...opts, body: 'Antippen zum Ansehen', renotify: true });
    try { if (n) await self.navigator.setAppBadge?.(n); } catch { /* nicht überall verfügbar */ }
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || BASE;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(c => new URL(c.url).pathname.startsWith(BASE));
    if (w) { await w.focus(); w.navigate?.(url).catch(() => {}); } else await self.clients.openWindow(url);
  })());
});
