'use strict';
/* Einkaufszettel (Tab „Zettel“)
   - Einträge: frei („3 l Milch, 1,5 %“), konkretes Angebot oder Wunsch (Filter -> günstigstes aktuelles Angebot)
   - Menge + Einheit, Notiz, Kategorie (automatisch, änderbar, wird je Name gemerkt), Preis (aus Angebot oder manuell)
   - eigene Einkaufs-Kategorien mit Symbol/Farbe in Laden-Reihenfolge; Ansichten Einfach (Standard) und Details, sortiert nach Kategorie/Eingabe/A–Z
   - „zuletzt abgehakt“, Wischgesten (rechts = abhaken, links = löschen), Rückgängig, Bildschirm bleibt an
   - Abgleich über Supabase (cloud.js): jede Zeile (Eintrag, Kategorie, Gelerntes, Historie) trägt ihre
     Änderungszeit u; neuere Stände gewinnen, gelöscht wird per del-Markierung. */

/* ---------- Kategorien, Einheiten, Schlagwörter ---------- */

const LI_DEFAULT_CATS = [
  ['obst', 'Obst & Gemüse', '🥦', '#43a047'], ['brot', 'Brot & Backwaren', '🥖', '#c68a3a'],
  ['kuehl', 'Milch, Eier & Kühlregal', '🥛', '#3d9ad1'], ['kaese', 'Käse', '🧀', '#d4a200'],
  ['wurst', 'Wurst & Aufschnitt', '🥓', '#d35d6e'], ['fleisch', 'Fleisch & Fisch', '🥩', '#c0392b'],
  ['tk', 'Tiefkühl', '🧊', '#4aa8d8'], ['vorrat', 'Nudeln, Reis & Konserven', '🥫', '#b9770e'],
  ['backen', 'Backen, Öl & Gewürze', '🧂', '#a0826d'], ['fruehstueck', 'Frühstück & Aufstrich', '🍯', '#e67e22'],
  ['suess', 'Süßes & Snacks', '🍫', '#8e5a3c'], ['kaffee', 'Kaffee & Tee', '☕', '#6d4c41'],
  ['getraenke', 'Getränke', '🥤', '#16a085'], ['alkohol', 'Bier, Wein & Spirituosen', '🍷', '#8e44ad'],
  ['drogerie', 'Drogerie & Pflege', '🧴', '#d670a8'], ['haushalt', 'Haushalt & Reinigung', '🧽', '#7f8c8d'],
  ['baby', 'Baby & Kind', '🍼', '#e8a0a0'], ['tier', 'Tierbedarf', '🐾', '#a1887f'],
  ['sonstiges', 'Sonstiges', '📦', '#95a5a6'],
];

// Angebots-Kategorien (Backend) -> Einkaufs-Kategorien
const LI_OFFER_CAT = {
  'Obst & Gemüse': 'obst', 'Fleisch & Geflügel': 'fleisch', 'Wurst & Aufschnitt': 'wurst', 'Fisch & Meeresfrüchte': 'fleisch',
  'Milch & Molkerei': 'kuehl', 'Käse': 'kaese', 'Brot & Backwaren': 'brot', 'Tiefkühl': 'tk', 'Vorrat & Konserven': 'vorrat',
  'Frühstück & Aufstrich': 'fruehstueck', 'Süßes & Snacks': 'suess', 'Kaffee & Tee': 'kaffee', 'Getränke': 'getraenke',
  'Bier': 'alkohol', 'Wein & Sekt': 'alkohol', 'Spirituosen': 'alkohol', 'Drogerie & Pflege': 'drogerie',
  'Baby & Kind': 'baby', 'Haushalt & Reinigung': 'haushalt', 'Tierbedarf': 'tier', 'Non-Food': 'sonstiges',
  'Sonstiges': 'sonstiges',
};

// Schlagwörter für freie Einträge; Reihenfolge = Priorität („Milchschokolade“ ist Süßes, nicht Milch).
// Wort: kommt irgendwo vor · ^Wort: Wortanfang · =Wort: ganzes Wort
const LI_WORDS = [
  ['obst', 'wassermelone'],
  ['tier', 'katzen hunde tierfutter vogelfutter leckerli whiskas felix pedigree frolic sheba katzenstreu'],
  ['baby', 'windel pampers babynahrung ^brei hipp milupa aptamil schnuller'],
  ['tk', 'tiefkühl =tk pizza fischstäbchen =eis eiscreme speiseeis pommes kroketten rahmspinat gefrier magnum cornetto schlemmerfilet'],
  ['alkohol', '^bier pils weizenbier hefeweizen radler =alster =helles kölsch =wein rotwein weißwein =rosé ^sekt prosecco likör ' +
    'schnaps =korn wodka vodka whisky =rum =gin aperol jägermeister sangria glühwein cider cidre weinbrand ouzo tequila ' +
    'amaretto riesling merlot dornfelder chardonnay grauburgunder'],
  ['getraenke', 'wasser ^saft säfte schorle =limo limonade ^cola fanta sprite eistee sprudel energy smoothie nektar tonic ' +
    'apfelsaft orangensaft multivitamin'],
  ['suess', 'schoko praline bonbon gummibär ^gummi haribo ^chips flips cracker salzstangen nüsse ^erdnüsse keks popcorn riegel ' +
    'kaugummi lakritz ^waffel muffin milka ritter sport twix snickers =mars studentenfutter'],
  ['kaffee', 'kaffee espresso cappuccino kapseln =pads =tee früchtetee kräutertee schwarztee grüntee teebeutel kakao'],
  ['fruehstueck', 'marmelade konfitüre ^honig nutella aufstrich müsli cornflakes haferflocken flakes porridge erdnussbutter'],
  ['backen', '^mehl ^zucker backpulver ^hefe vanillezucker ^salz pfeffer gewürz paprikapulver ^zimt =öl olivenöl ' +
    'sonnenblumenöl rapsöl ^essig puderzucker speisestärke backmischung gelatine streusel'],
  ['vorrat', 'nudeln spaghetti ^penne fusilli lasagne ^reis couscous bulgur linsen bohnen kichererbsen konserve ' +
    'tomatenmark passierte ketchup ^mayo ^senf brühe bouillon suppe ^soße ^sauce pesto =mais thunfisch sauerkraut ' +
    'gewürzgurken essiggurken oliven ravioli fertiggericht kokosmilch'],
  ['kaese', 'käse gouda emmentaler mozzarella ^feta parmesan camembert ^brie halloumi ricotta leerdammer cheddar'],
  ['kuehl', 'milch joghurt jogurt ^quark butter sahne schmand crème fraîche creme fraiche =eier =ei margarine skyr ' +
    'pudding kefir ^tofu hummus tortellini gnocchi blätterteig pizzateig mascarpone'],
  ['wurst', 'wurst salami schinken aufschnitt lyoner mortadella wiener ^speck bacon kassler'],
  ['fleisch', 'fleisch ^hack hähnchen ^huhn hühner ^pute schnitzel steak braten gulasch filet kotelett ^rind ^schwein ' +
    '^lamm ^ente =gans fisch lachs forelle garnelen shrimps kabeljau seelachs hering chicken nuggets frikadelle'],
  ['brot', '^brot brötchen baguette toast croissant brezel laugen ciabatta kuchen torte zwieback knäckebrot wraps ' +
    'tortilla semmel schrippe'],
  ['obst', 'äpfel ^apfel birne banane orange mandarine clementine zitrone limette traube erdbeer himbeer heidelbeer blaubeer beere ' +
    'kirsche pfirsich nektarine pflaume melone ananas mango =kiwi avocado ^obst gemüse salat tomate gurke paprika zucchini ' +
    'aubergine karotte möhre kartoffel zwiebel knoblauch ^lauch porree brokkoli broccoli blumenkohl ^kohl rotkohl ' +
    'weißkohl spinat champignon pilze radieschen sellerie ingwer kräuter petersilie schnittlauch basilikum rucola ' +
    'feldsalat spargel kürbis'],
  ['drogerie', 'shampoo duschgel seife zahnpasta zahncreme zahnbürste =deo deodorant creme lotion rasier binden tampons ' +
    'taschentücher watte pflaster haargel haarspray sonnencreme nivea feuchttücher'],
  ['haushalt', 'spülmittel spültabs waschmittel weichspüler reiniger putzmittel schwamm müllbeutel alufolie frischhaltefolie ' +
    'backpapier klopapier toilettenpapier küchenrolle küchentücher servietten batterien glühbirne kerzen teelichter ' +
    'entkalker =wc allzweck spülmaschine lappen handschuhe zewa'],
];
const liWordRules = LI_WORDS.map(([cat, words]) => [cat, words.split(' ').map(w => {
  const mode = w[0] === '^' || w[0] === '=' ? w[0] : '';
  return { mode, t: norm(mode ? w.slice(1) : w).replace(/[^a-z0-9]+/g, ' ').trim() };
})]);

// Einheiten und Schreibweisen bei der Eingabe
const LI_UNITS = [
  ['Stk', 'stk stck stuck st'], ['Pck', 'pck pack packung packungen pkg pckg'], ['g', 'g gr gramm'],
  ['kg', 'kg kilo kilogramm'], ['ml', 'ml'], ['l', 'l ltr liter'], ['Fl', 'fl flasche flaschen'], ['Dose', 'dose dosen'],
  ['Glas', 'glas glaser'], ['Becher', 'becher'], ['Bund', 'bund'], ['Kasten', 'kasten kiste kisten'],
  ['Beutel', 'beutel btl'], ['Rolle', 'rolle rollen'], ['Netz', 'netz netze'], ['Tafel', 'tafel tafeln'],
  ['Schale', 'schale schalen'],
];
const LI_UNIT_MAP = {};
for (const [u, aliases] of LI_UNITS) for (const a of aliases.split(' ')) LI_UNIT_MAP[a] = u;
const LI_MEASURE = new Set(['g', 'kg', 'ml', 'l']);  // Mengenangabe = Gewicht/Volumen, Preis nicht multiplizieren

/* ---------- Zustand & Speicher ---------- */

const LI_KINDS = ['item', 'cat', 'learn', 'hist', 'fav'];
const R = Object.fromEntries(LI_KINDS.map(k => [k, new Map()]));
const LI = {
  dirty: new Set(load('li.dirty', [])),
  cursor: load('li.cursor', null),
  // Ansicht „simple“ (Standard) oder „plain“ (Details); Händler- und Kategorien-Ansicht gibt es nicht mehr
  view: load('li.viewV2', false) && load('li.view', 'simple') === 'plain' ? 'plain' : 'simple',
  sort: load('li.sortV2', false) ? load('li.sort', 'added') : 'added',  // Sortierung, Standard „Eingabe“ (einmalig für alle Geräte gesetzt)
  prices: load('li.prices', true),
  wake: load('li.wake', true),
  doneOpen: false,
  draft: '',
  prioNext: false,
  noteOpen: new Set(),  // Einträge, deren Notiz aufgeklappt ist (🗒️ antippen)
  histOpen: false, histAll: false, histSort: load('li.histSort', 'last'),  // Schalter ❗ neben der Eingabe: nächster Eintrag wird als wichtig angelegt
  editId: null,
  lock: null,
  syncing: false, lastSync: null, syncErr: null,
  suppress: 0,
  hints: new Map(), hintsFor: null,
};

// streng steigende Zeit-ID (Reihenfolge des Hinzufügens) + Zufallsteil gegen Gleichstand zwischen Geräten
let liLastId = 0;
function liNewId() {
  liLastId = Math.max(Date.now(), liLastId + 1);
  return liLastId.toString(36) + Math.random().toString(36).slice(2, 7);
}
const nkey = s => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();

function liSave() {
  save('li.rows', Object.fromEntries(LI_KINDS.map(k => [k, [...R[k].values()]])));
  save('li.dirty', [...LI.dirty]);
}

// Änderung merken: Zeitstempel, zum Abgleich vormerken, speichern
function put(kind, obj) {
  obj.u = Math.max(Date.now(), (obj.u || 0) + 1);
  R[kind].set(obj.id, obj);
  LI.dirty.add(kind + '|' + obj.id);
  liSave();
  Sync.soon();
}

// Standard-Kategorien (u = 1: jede Änderung eines Geräts ist neuer)
function liDefaultCats() {
  LI_DEFAULT_CATS.forEach(([id, name, emoji, color], i) => {
    if (!R.cat.has(id)) R.cat.set(id, { id, name, emoji, color, order: i * 10, hidden: false, u: 1 });
  });
}

// Gerät ist in eine andere Gruppe gewechselt: lokalen Zettel verwerfen (gehört der alten Gruppe) und alles neu
// holen. Die eigenen Favoriten (S.favs) bleiben und werden danach per liFavsPush in die neue Gruppe gesendet.
function liResetGroup() {
  for (const k of LI_KINDS) R[k].clear();
  LI.dirty.clear();
  LI.cursor = null;
  save('li.cursor', null);
  liDefaultCats();
  liSave();
}

function liLoad() {
  const d = load('li.rows', null);
  if (d) for (const k of LI_KINDS) for (const o of d[k] || []) R[k].set(o.id, o);
  liDefaultCats();
  if (!d) liMigrate();
  // endgültig löschen: seit 60 Tagen gelöschte, bereits abgeglichene Einträge
  const old = Date.now() - 60 * 864e5;
  for (const [id, it] of R.item) if (it.del && it.u < old && !LI.dirty.has('item|' + id)) R.item.delete(id);
  liSave();
}

// Übernahme des bisherigen Zettels (ap.list)
function liMigrate() {
  for (const it of load('list', [])) {
    const base = { id: liNewId(), qty: it.qty || 1, unit: '', note: '', price: null, pm: null, done: !!it.done, dt: null, by: '' };
    if (it.kind === 'offer') {
      R.item.set(base.id, {
        ...base, kind: 'offer', name: `${it.brand ? it.brand + ' ' : ''}${it.title}`, cat: liGuess(it.title),
        offer: { id: it.offerId, retailer: it.retailer, brand: it.brand, title: it.title, price: it.price,
          unit_price: it.unit_price, unit: it.unit, valid_to: it.valid_to, app: it.app || '' }, u: Date.now(),
      });
    } else if (it.kind === 'wish') {
      R.item.set(base.id, { ...base, kind: 'wish', name: it.label, fav: it.fav,
        cat: LI_OFFER_CAT[it.fav?.category] || liGuess(it.label), u: Date.now() });
    }
    LI.dirty.add('item|' + base.id);
  }
}

const liItems = () => [...R.item.values()].filter(i => !i.del);
const liOpen = () => liItems().filter(i => !i.done);
const liCats = () => [...R.cat.values()].filter(c => !c.del).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
function catInfo(id) {
  const c = R.cat.get(id);
  if (c && !c.del) return c;
  return R.cat.get('sonstiges') || { id: 'sonstiges', name: 'Sonstiges', emoji: '📦', color: '#95a5a6', order: 9999 };
}

/* ---------- Erkennen: Menge, Kategorie ---------- */

const toNum = s => s === '½' ? 0.5 : s === '¼' ? 0.25 : Number(String(s).replace(',', '.'));
const LI_NUM = '(\\d+(?:[.,]\\d+)?|½|¼)';
const LI_RX = {
  times: new RegExp(`^${LI_NUM}\\s*(?:x|×|\\*)\\s*(.+)$`, 'i'),
  unitFirst: new RegExp(`^${LI_NUM}\\s*([A-Za-zÄÖÜäöüß]+)\\.?\\s+(.+)$`),
  numFirst: new RegExp(`^${LI_NUM}\\s+(.+)$`),
  numLast: new RegExp(`^(.+?)\\s+${LI_NUM}\\s*([A-Za-zÄÖÜäöüß]*)\\.?$`),
};

// "3 l Milch, 1,5 %" -> {name: "Milch, 1,5 %", qty: 3, unit: "l"}; Text hinter einem Komma gehört zum Namen
function liParse(text) {
  let s = text.trim(), extra = '';
  const prio = s.startsWith('!');  // "!Milch" = wichtig
  if (prio) s = s.replace(/^!+\s*/, '');
  const cm = s.match(/(?<!\d),|,(?=\s)/);
  if (cm) { extra = s.slice(cm.index + 1).trim(); s = s.slice(0, cm.index).trim(); }
  let qty = null, unit = '', m;
  const u = w => LI_UNIT_MAP[norm(w)];
  if ((m = s.match(LI_RX.times))) { qty = toNum(m[1]); s = m[2]; }
  else if ((m = s.match(LI_RX.unitFirst)) && u(m[2])) { qty = toNum(m[1]); unit = u(m[2]); s = m[3]; }
  else if ((m = s.match(LI_RX.numFirst))) { qty = toNum(m[1]); s = m[2]; }
  else if ((m = s.match(LI_RX.numLast)) && (!m[3] || u(m[3]))) { s = m[1]; qty = toNum(m[2]); unit = m[3] ? u(m[3]) : ''; }
  if (qty !== null && !(qty > 0)) qty = null;
  return { name: (s + (extra ? ', ' + extra : '')).trim(), qty, unit, prio };
}
const liSplit = text => text.split(/\s+und\s+|\s*;\s*|\s*\n\s*|\s+\+\s+/i).map(s => s.trim()).filter(Boolean);

function liWordCat(name) {
  const text = ' ' + nkey(name) + ' ';
  for (const [cat, words] of liWordRules) {
    for (const w of words) {
      if (w.mode === '^' ? text.includes(' ' + w.t) : w.mode === '=' ? text.includes(' ' + w.t + ' ') : text.includes(w.t)) return cat;
    }
  }
  return null;
}

/* ---------- Angebote zu freien Einträgen finden ----------
   Regel je Eintrag: words (müssen vorkommen – Name, Marke, Gruppe oder Beschreibung), soft (Sortenwörter wie
   „Zero“: nur Bonus in der Reihenfolge), brands (nur diese Marken), group („Kategorie\u0001Gruppe“).
   Automatisch aus dem Namen abgeleitet; im Bearbeiten-Dialog je Name anpassbar (R.learn[name].match, abgeglichen). */

// Sortenwörter: Angebote gelten meist für alle Sorten („Coca-Cola versch. Sorten“) -> kein Pflichtwort
const LI_VARIANTS = new Set(('zero light classic original mini xxl xl sorten sorte versch verschiedene neu extra family ' +
  'familienpackung vorratspackung').split(' ').map(nkey));
// Namen, hinter denen eine andere Marke steht; keep = Wort muss trotzdem vorkommen (Ferrero ist mehr als Nutella)
const LI_ALIASES = [
  ['coke', ['cocacola']], ['cola zero', ['cocacola']], ['cola light', ['cocacola']], ['coca cola', ['cocacola']],
  ['fanta', ['cocacola'], true], ['sprite', ['cocacola'], true], ['mezzo mix', ['cocacola'], true],
  ['nutella', ['nutella', 'ferrero'], true], ['duplo', ['ferrero'], true], ['hanuta', ['ferrero'], true],
  ['kinder schokolade', ['ferrero'], true], ['kinder riegel', ['ferrero'], true], ['kinder bueno', ['ferrero'], true],
  ['raffaello', ['ferrero'], true], ['mon cheri', ['ferrero'], true], ['rocher', ['ferrero'], true],
  ['knoppers', ['storck'], true], ['merci', ['merci', 'storck'], true], ['toffifee', ['storck'], true],
  ['red bull', ['redbull']],
].map(([w, brands, keep]) => ({ w: nkey(w), brands, keep: !!keep }));
// allgemeine Warenwörter sind keine Marken, auch wenn ein Händler sie als Marke führt
const LI_GENERIC = new Set(liWordRules.flatMap(([, ws]) => ws.map(w => w.t.replace(/ /g, ''))));

const liHitAny = (o, t) => hit(t, o._ts, o._tw) || o._gs.includes(' ' + t) || hit(t, o._ds, o._dw);

// Markennamen der aktuellen Angebote (normalisiert -> brand_key) und Anzeigenamen
function liBrandIndex() {
  if (LI.brandFor !== S.offers) {
    LI.brandIdx = new Map();
    LI.brandName = new Map();
    for (const o of S.offers) {
      if (!o.brand_key) continue;
      LI.brandName.set(o.brand_key, o.brand);
      const k = norm(o.brand).replace(/[^a-z0-9]/g, '');
      if (o.brand_type === 'marke' && k.length >= 4 && !LI_GENERIC.has(k)) LI.brandIdx.set(k, o.brand_key);
    }
    LI.brandFor = S.offers;
  }
  return LI.brandIdx;
}

function liAutoRule(name) {
  const text = ' ' + nkey(name) + ' ';
  const toks = qTokens(name);
  const used = new Set(), brands = new Set();
  let keep = false;
  for (const a of LI_ALIASES) {
    if (!text.includes(' ' + a.w + ' ')) continue;
    a.brands.forEach(b => brands.add(b));
    if (a.keep) keep = true;
    else a.w.split(' ').forEach(w => used.add(w));
  }
  // Marke am Namen erkennen, auch mehrteilig ("Coca Cola", "Red Bull")
  const idx = liBrandIndex(), ws = nkey(name).split(' ');
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= ws.length; i++) {
      const part = ws.slice(i, i + n);
      if (part.some(w => used.has(w))) continue;
      const b = idx.get(part.join(''));
      if (b) { brands.add(b); part.forEach(w => used.add(w)); }
    }
  }
  let words = toks.filter(t => !used.has(t) && !LI_VARIANTS.has(t));
  let soft = toks.filter(t => !used.has(t) && LI_VARIANTS.has(t));
  if (!brands.size && !words.length) { words = soft; soft = []; }
  return { words, soft, brands: [...brands], group: null, auto: true, keep };
}

function liRuleFor(name) {
  const m = R.learn.get(nkey(name));
  if (m && !m.del && m.match) return { soft: [], ...m.match, auto: false };
  return liAutoRule(name);
}

// passende aktuelle Angebote zu einem freien Eintrag (für Hinweis, Kategorie und Bearbeiten-Dialog);
// automatisch und ohne Marke nur Angebote der Einkaufs-Kategorie („Milch“ ist keine Milchschokolade)
function liMatches(name, cat) {
  if (!S.loaded) return [];
  if (LI.hintsFor !== S.offers) { LI.hints.clear(); LI.hintsFor = S.offers; }
  const k = nkey(name) + '|' + (cat || '');
  if (!LI.hints.has(k)) {
    const rule = liRuleFor(name);
    let cand = visible();
    if (rule.brands.length) cand = cand.filter(o => rule.brands.includes(o.brand_key));
    if (rule.group) cand = cand.filter(o => o.category + '\u0001' + o.group === rule.group);
    let m;
    if (rule.words.length) m = cand.filter(o => rule.words.every(t => liHitAny(o, t)));
    else m = rule.brands.length || rule.group ? cand : [];
    // Marke erkannt, Restwort passt nicht ("Milka Schokolade" -> alle Milka-Angebote)
    if (!m.length && rule.auto && rule.brands.length && !rule.keep) m = cand;
    if (rule.auto && !rule.brands.length) {
      if (cat && cat !== 'sonstiges') m = m.filter(o => (LI_OFFER_CAT[o.category] || 'sonstiges') === cat);
      // genaueste Stufe: Wort im Namen – ganz oder als Grundwort am Ende eines zusammengesetzten Worts
      // („Gulasch“ findet Rindergulasch, aber nicht Gulaschtopf; „Milch“ Vollmilch, aber nicht Milchschokolade),
      // sonst Wort = Produktgruppe, sonst alle Treffer
      const word = (s, t) => (s + ' ').includes(' ' + t + ' ');
      const head = (s, t) => (s + ' ').includes(t + ' ');
      const inGroup = m.filter(o => rule.words.every(t => word(spaced(norm(o.group)), t)));
      const inName = m.filter(o => rule.words.every(t => head(o._ts, t)));
      m = inName.length ? inName : inGroup.length ? inGroup : m;
    }
    m = sortOffers([...m], 'unit');
    // Sortenwörter ("Zero") nach vorne, sonst Grundpreis-Reihenfolge
    if (rule.soft.length) {
      const score = o => rule.soft.filter(t => liHitAny(o, t)).length;
      m = m.map((o, i) => [o, score(o), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(x => x[0]);
    }
    LI.hints.set(k, curFirst(m));
  }
  return LI.hints.get(k);
}

// Chips im Bearbeiten-Dialog: Wörter, Marken und Produktgruppen, über die Angebote gefunden werden
function liMatchUI(it) {
  if (!S.loaded) return '';
  const rule = liRuleFor(it.name);
  const toks = qTokens(it.name);
  // Auswahl-Chips: nur echte Treffer am Wortanfang (ohne Tippfehler-Toleranz), sonst erscheinen z.B. „Colgate“ bei „Cola“
  const pool = visible().filter(o => rule.brands.includes(o.brand_key) || toks.some(t => o._ts.includes(' ' + t) || o._gs.includes(' ' + t)));
  if (!pool.length && !rule.brands.length) return '';
  liBrandIndex();
  const top = (arr, key) => Object.entries(countBy(arr, key)).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const bList = [...new Set([...rule.brands, ...top(pool.filter(o => o.brand_key), o => o.brand_key).slice(0, 8)])];
  const gList = [...new Set([...(rule.group ? [rule.group] : []), ...top(pool, o => o.category + '\u0001' + o.group).slice(0, 6)])];
  const chip = (type, v, label, on) =>
    `<button class="chip ${on ? 'on' : ''}" data-act="liMatch" data-t="${type}" data-v="${esc(v)}">${esc(label)}</button>`;
  return `<h3 class="li-sec">Angebote finden über</h3><div class="li-match">
    ${toks.length ? `<div class="li-mrow"><span>Wörter</span><div class="chips wrap">${toks.map(t => chip('word', t, t, rule.words.includes(t))).join('')}</div></div>` : ''}
    ${bList.length ? `<div class="li-mrow"><span>Marke</span><div class="chips wrap">${bList.map(b => chip('brand', b, LI.brandName.get(b) || b, rule.brands.includes(b))).join('')}</div></div>` : ''}
    ${gList.length ? `<div class="li-mrow"><span>Gruppe</span><div class="chips wrap">${gList.map(g => {
      const [c, gr] = g.split('\u0001');
      return chip('group', g, gr === OTHER ? c : gr, rule.group === g);
    }).join('')}</div></div>` : ''}
    <p class="sub li-mnote">${rule.auto ? 'Automatisch erkannt – antippen zum Anpassen' : `Eigene Zuordnung – gilt für „${esc(it.name)}“ auf allen Geräten`}
      ${rule.auto ? '' : ' <button class="btn small" data-act="liMatchAuto">Automatisch</button>'}</p></div>`;
}

function liGuess(name) {
  const learned = R.learn.get(nkey(name));
  const ok = id => id && R.cat.has(id) && !R.cat.get(id).del;
  if (learned && !learned.del && ok(learned.cat)) return learned.cat;
  const g = liGoodsCat.get(nkey(name));
  if (ok(g)) return g;
  const w = liWordCat(name);
  if (ok(w)) return w;
  const c = countBy(liMatches(name).slice(0, 20), o => LI_OFFER_CAT[o.category] || 'sonstiges');
  const best = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
  return ok(best) ? best : 'sonstiges';
}

/* ---------- Einträge ändern ---------- */

// Verlauf (R.hist, je Name): bleibt dauerhaft – Löschen, Abhaken oder Leeren des Zettels entfernen nichts.
// c = wie oft auf dem Zettel, b = wie oft gekauft (abgehakt), last/bought = zuletzt; Wünsche merken ihren Filter
// konkrete Angebote kommen nicht in den Verlauf – bei ersetzten Einträgen zählt nur der ursprüngliche Eintrag
function liRemember(it, when = Date.now()) {
  if (!it || it.kind === 'offer') return;
  const k = nkey(it.name);
  if (!k) return;
  const h = R.hist.get(k) || { id: k, c: 0, b: 0 };
  Object.assign(h, { name: it.name, c: (h.c || 0) + 1, cat: it.cat, last: Math.max(h.last || 0, when), del: false });
  if (it.kind === 'wish' && it.fav) h.fav = it.fav;
  if (it.qty && it.unit) Object.assign(h, { qty: it.qty, unit: it.unit });
  put('hist', h);
}

function liBought(it) {
  if (it.kind === 'offer') {
    if (!it.orig) return;
    it = { name: it.orig, cat: it.cat, qty: it.qty, unit: it.unit };
  }
  if (!nkey(it.name)) return;
  const h = R.hist.get(nkey(it.name));
  if (!h) { liRemember(it); return liBought(it); }
  Object.assign(h, { b: (h.b || 0) + 1, bought: Date.now() });
  put('hist', h);
}

// einmalig: vorhandene Einträge (auch gelöschte/abgehakte) in den Verlauf übernehmen
// Eintrag aus dem Verlauf entfernen (kommt zurück, sobald er wieder auf den Zettel gesetzt wird)
function liHistDelete(h) {
  h.del = true;
  put('hist', h);
  liRefresh();
  toast(`Aus Verlauf entfernt: ${h.name}`, { label: 'Rückgängig', fn: () => { h.del = false; put('hist', h); liRefresh(); } });
}

function liHistOfferClean() {
  if (load('li.histOfferClean', false)) return;
  const own = new Set([...R.item.values()].filter(i => i.kind !== 'offer').map(i => nkey(i.name)));
  for (const i of R.item.values()) if (i.orig) own.add(nkey(i.orig));
  for (const i of R.item.values()) {
    const h = i.kind === 'offer' && R.hist.get(nkey(i.name));
    if (h && !h.del && !own.has(h.id)) { h.del = true; put('hist', h); }
  }
  save('li.histOfferClean', true);
}

function liHistBackfill() {
  if (load('li.histFilled', false)) return;
  for (const it of R.item.values()) {
    if (R.hist.has(nkey(it.name))) continue;
    liRemember(it, parseInt(it.id.slice(0, 8), 36) || it.u || Date.now());
    if (it.done) liBought(it);
  }
  save('li.histFilled', true);
}

function liAddFree(name, qty, unit, prio = false) {
  const k = nkey(name);
  const ex = liItems().find(i => nkey(i.name) === k);
  if (ex) {
    if (prio) ex.prio = true;
    if (ex.done) {
      Object.assign(ex, { done: false, dt: null });
      if (qty) Object.assign(ex, { qty, unit });
      toast(`„${ex.name}“ wieder auf dem Zettel`);
    } else {
      if (!qty) ex.qty = (ex.qty || 1) + 1;
      else if ((unit || '') === (ex.unit || '')) ex.qty = (ex.qty || (unit ? 0 : 1)) + qty;
      else Object.assign(ex, { qty, unit });
      toast(`„${ex.name}“ ist schon auf dem Zettel – Menge erhöht`);
    }
    put('item', ex);
    liRemember(ex);
    return ex;
  }
  const it = { id: liNewId(), kind: 'free', name, qty, unit: unit || '', note: '', prio: !!prio, cat: liGuess(name),
    price: null, pm: null, done: false, dt: null, by: Cloud.name() };
  put('item', it);
  liRemember(it);
  return it;
}

function liAddText(text) {
  const prio = liTakePrio();
  const added = liSplit(text).map(p => liParse(p)).filter(p => p.name).map(p => liAddFree(p.name, p.qty, p.unit, p.prio || prio));
  return added.length;
}

// Schalter ❗ abfragen und zurücksetzen (gilt für genau eine Eingabe)
function liTakePrio() {
  const on = LI.prioNext;
  if (on) {
    LI.prioNext = false;
    const b = $('#liPrioBtn');
    if (b) { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); }
  }
  return on;
}

const offerSnap = o => ({
  id: o.id, retailer: o.retailer, brand: o.brand, title: o.name || o.title, price: o.ep, unit_price: o.eu,
  unit: o.unit, valid_from: o.valid_from, valid_to: o.valid_to, app: o.ea ? appName(o) : '', category: o.category, image: o.image || '',
});
const liOfferItem = o => liOpen().find(i => i.kind === 'offer' && i.offer?.id === o.id);

function liSetDone(it, done) {
  Object.assign(it, { done, dt: done ? Date.now() : null });
  put('item', it);
  if (done) liBought(it);
}

function liDelete(it, undoText = 'Gelöscht') {
  it.del = true;
  put('item', it);
  toast(`${undoText}: ${it.name}`, { label: 'Rückgängig', fn: () => { it.del = false; put('item', it); liRefresh(); } });
}

// Schnittstelle für Angebotskarten, Favoriten und Detailansicht (app.js)
const Li = {
  hasOffer: o => !!liOfferItem(o),
  isPrioOffer: o => !!liOfferItem(o)?.prio,
  // offener Wunsch zu einem Favoriten (gleicher Filter)
  favWish: f => liOpen().find(i => i.kind === 'wish' && i.fav && favSig(i.fav) === favSig(f)),
  // ＋ / ❗ am Favoriten: hinzufügen; erneut ＋ = vom Zettel nehmen, erneut ❗ = Markierung umschalten
  toggleFavWish(f, label, prio) {
    const ex = this.favWish(f);
    if (!ex) { this.addWish(f, label, { prio }); return; }
    if (prio) { ex.prio = !ex.prio; put('item', ex); toast(ex.prio ? `❗ ${ex.name} ist wichtig` : `${ex.name}: nicht mehr wichtig`); return; }
    liDelete(ex, 'Vom Zettel entfernt');
  },
  // ❗ an der Angebotskarte: als wichtig hinzufügen bzw. Markierung umschalten (Eintrag bleibt auf dem Zettel)
  togglePrioOffer(o) {
    const ex = liOfferItem(o);
    if (ex?.prio) { ex.prio = false; put('item', ex); toast(`${ex.name}: nicht mehr wichtig`); return; }
    this.toggleOffer(o, true);
  },
  openCount: () => liOpen().length,
  // Zettel-Eintrag durch ein konkretes Angebot ersetzen (Menge, Notiz, „wichtig“ und Kategorie bleiben)
  replaceWithOffer(id, o) {
    const it = R.item.get(id);
    if (!it || !o) return;
    const before = JSON.parse(JSON.stringify(it));
    const { fav, ...rest } = it;
    const name = `${o.brand ? o.brand + ' ' : ''}${o.name || o.title}`;
    // ursprünglichen Eintrag merken, er steht in der Zeile vorne („Schinken · Montorsi Prosciutto …“)
    const orig = it.kind === 'offer' ? it.orig : it.name;
    const next = { ...rest, kind: 'offer', name, orig: orig || undefined, offer: offerSnap(o), price: null, pm: null };
    put('item', next);
    toast(`„${before.name}“ ersetzt: ${name.length > 40 ? name.slice(0, 38).trimEnd() + ' …' : name}`, { label: 'Rückgängig', fn: () => { put('item', before); liRefresh(); } });
    liRefresh();
  },
  toggleOffer(o, prio = false) {
    const ex = liOfferItem(o);
    if (ex && prio && !ex.prio) { ex.prio = true; put('item', ex); toast(`❗ ${ex.name} als wichtig markiert`); return; }
    if (ex) { liDelete(ex, 'Vom Zettel entfernt'); return; }
    const name = `${o.brand ? o.brand + ' ' : ''}${o.name || o.title}`;
    const learned = R.learn.get(nkey(name));
    put('item', { id: liNewId(), kind: 'offer', name, qty: 1, unit: '', note: '', price: null, pm: null,
      cat: learned && !learned.del ? learned.cat : LI_OFFER_CAT[o.category] || 'sonstiges',
      offer: offerSnap(o), done: false, dt: null, by: Cloud.name(), prio });
    toast(prio ? '❗ Wichtig auf den Einkaufszettel' : '＋ Auf den Einkaufszettel');
  },
  addWish(filter, label, parsed) {
    const { id, ...fav } = filter;
    put('item', { id: liNewId(), kind: 'wish', name: label, fav, qty: parsed?.qty || 1, unit: parsed?.unit || '', note: '',
      price: null, pm: null, prio: !!parsed?.prio,
      cat: LI_OFFER_CAT[fav.category] || liGuess(label), done: false, dt: null, by: Cloud.name() });
    liRemember([...R.item.values()].filter(i => i.kind === 'wish' && i.name === label).pop());
    toast(`＋ „${label}“ auf den Einkaufszettel`);
  },
};

/* ---------- Favoriten abgleichen ----------
   Nur zwischen Geräten derselben Person (erkannt am eingegebenen Namen): Zeile 'fav' mit id "<name>:<Favorit-ID>".
   app.js ruft liFavsPush bei jeder Änderung der Favoriten auf; beim Abgleich übernimmt liFavsPull die eigenen. */

const favOwner = () => nkey(Cloud.name());
const favCopy = f => JSON.parse(JSON.stringify(f));

function liFavsPush(favs) {
  const own = favOwner();
  if (!Cloud.enabled || !Cloud.loggedIn() || !own) return;
  const keep = new Set();
  for (const f of favs) {
    const id = `${own}:${f.id}`;
    keep.add(id);
    const cur = R.fav.get(id);
    if (!cur || cur.del || JSON.stringify(cur.fav) !== JSON.stringify(f)) put('fav', { id, owner: own, fav: favCopy(f), del: false });
  }
  for (const [id, r] of R.fav) if (r.owner === own && !r.del && !keep.has(id)) put('fav', { ...r, del: true });
}

// eigene Favoriten aus den abgeglichenen Zeilen übernehmen; Ergebnis: ob sich etwas geändert hat
function liFavsPull() {
  const own = favOwner();
  if (!own) return false;
  const favs = [...R.fav.values()].filter(r => r.owner === own && !r.del).map(r => favCopy(r.fav))
    .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.id).localeCompare(String(b.id)));
  if (JSON.stringify(favs) === JSON.stringify(S.favs)) return false;
  S.favs = favs;
  save('favs', S.favs);
  return true;
}

/* ---------- Preise & Anzeige ---------- */

function liBest(it) {
  if (it.kind !== 'wish' || !S.loaded) return null;
  return curFirst(sortOffers(visible().filter(o => favMatch(it.fav, o)), metricSort(it.fav)))[0] || null;
}

// Preis des Eintrags: manuell > Angebot > günstigstes Angebot zum Wunsch; × Menge außer bei Gewicht/Volumen
function liPrice(it, best) {
  let each = null, app = false;
  if (it.kind === 'offer') { each = it.offer.price; app = !!it.offer.app; }
  else if (best) { each = best.ep; app = best.ea; }
  if (it.price != null) { each = it.price; app = false; }
  if (each == null) return null;
  const mult = it.pm === 'fixed' || LI_MEASURE.has(it.unit) ? 1 : (it.qty || 1);
  return { total: Math.round(each * mult * 100) / 100, app };
}

// Preis rechts in der Zeile; bei Wünschen (Favoriten, Produktgruppen) mit Grundpreis-Vergleich wie in den Favoriten:
// Grundpreis groß, Packungspreis (× Menge) klein darunter
function liPriceHtml(it, best, p) {
  const cls = `li-p${p.app ? ' is-app' : ''}`;
  if (it.kind === 'wish' && best?.eu && it.price == null && !byPack(it.fav)) {
    return `<span class="${cls} li-p2">${fmt(best.eu)} €/${esc(best.unit)}<small>${fmt(p.total)} €</small></span>`;
  }
  return `<span class="${cls}">${fmt(p.total)} €</span>`;
}

const fmtQty = q => Number.isInteger(q) ? String(q) : q.toLocaleString('de-DE', { maximumFractionDigits: 2 });
function qtyLabel(it) {
  if (!it.qty || (it.qty === 1 && !it.unit)) return it.unit || '';  // "1×" nicht anzeigen
  return it.unit ? `${fmtQty(it.qty)} ${it.unit}` : `${fmtQty(it.qty)}×`;
}

// Ansicht „Einfach“: wie „Details“, aber nur Name (+ Menge) – keine Angebote, Preise, Notizen, „von“
const liSimple = () => LI.view === 'simple';
const liShowPrices = () => LI.prices && !liSimple();

function liRow(it, best) {
  const c = catInfo(it.cat);
  // Favoriten-Wünsche: kein Preis rechts (Hinweis „💡 im Angebot“ reicht), außer von Hand eingetragen – wie freie Einträge
  const p = liShowPrices() && (it.kind !== 'wish' || it.price != null) ? liPrice(it, best) : null;
  const sub = [];
  if (liSimple()) { /* nur der Name */ } else if (it.kind === 'offer') {
    const o = it.offer;
    const expired = o.valid_to && o.valid_to < today();
    const from = o.valid_from || S.byId.get(o.id)?.valid_from;  // ältere Einträge ohne valid_from: aus dem Angebot
    sub.push(`<span class="rt" style="--c:${S.retailers[o.retailer]?.color || '#888'}">${esc(S.retailers[o.retailer]?.name || o.retailer)}</span>` +
      `${o.app ? ` 📱 ${esc(o.app)}` : ''}${o.unit_price ? ` · ${fmt(o.unit_price)} €/${esc(o.unit)}` : ''}` +
      (o.valid_to ? (expired ? ' · <span class="err">abgelaufen</span>' : ` · bis ${dshort(o.valid_to)}`) : '') +
      (from ? ` ${fromTag({ valid_from: from })}` : ''));
  } else if (it.kind === 'wish') {
    // wie bei getippten Einträgen: allgemeiner Hinweis mit günstigstem Preis und Anzahl (Details per langem Drücken)
    const n = best ? liOffersOf(it).length : 0;
    sub.push(best ? `<span class="li-hint">💡 im Angebot: ${esc(rname(best))} ${best.ea ? '📱 ' : ''}${esc(metricLine(best, it.fav))}${n > 1 ? ` · ${n} Angebote` : ''}</span> ${fromTag(best)}`
      : 'Wunsch · derzeit kein Angebot');
  } else if (!it.done && it.price == null) {
    const m = liMatches(it.name, catInfo(it.cat).id);
    const n = m.length ? liSearchOffers(it).length : 0;  // Anzahl wie Suche / langes Drücken
    if (m.length) sub.push(`<span class="li-hint">💡 im Angebot: ${esc(rname(m[0]))} ${esc(priceLine(m[0]))}${n > 1 ? ` · ${n} Angebote` : ''}</span> ${fromTag(m[0])}`);
  }
  if (!liSimple() && Cloud.enabled && it.by && it.by !== Cloud.name()) sub.push(`von ${esc(it.by)}`);
  const q = qtyLabel(it);
  const qe = LI.qtyId === it.id && !it.done;  // angetippt: Menge als Textfeld, ⚙️ statt Abhaken
  // konkrete Angebote: Artikelbild statt Kategorie-Symbol, Name einzeilig gekürzt
  const offer = it.kind === 'offer';
  const img = offer && (it.offer.image || S.byId.get(it.offer.id)?.image);
  const prio = it.prio && !it.done ? '<b class="li-prio" title="wichtig">❗</b>' : '';
  const nameHtml = offer
    ? `<span class="li-l1"><span class="li-nm" title="${esc(it.orig ? `${it.orig} · ${it.name}` : it.name)}">${prio}${it.orig ? `<span class="li-orig">${esc(it.orig)}</span> · ` : ''}${esc(it.name)}</span>${it.note ? liNoteHtml(it, 'ico') : ''}</span>${it.note ? liNoteHtml(it, 'text') : ''}`
    : `${prio}${esc(it.name)}${it.note ? liNoteHtml(it) : ''}`;
  return `<div class="li-row${it.done ? ' done' : ''}${it.prio && !it.done ? ' prio' : ''}" data-lid="${it.id}">
    <div class="li-bg"><span class="li-bg-done">✓ ${it.done ? 'zurück' : 'erledigt'}</span><span class="li-bg-del">Löschen 🗑</span></div>
    <div class="li-fg">
      ${img ? `<span class="li-ico li-img" style="--c:${c.color}" title="${esc(c.name)}"><img loading="lazy" referrerpolicy="no-referrer" src="${esc(img)}" alt="" onerror="this.replaceWith('${c.emoji}')"></span>`
        : `<span class="li-ico" style="--c:${c.color}" title="${esc(c.name)}">${c.emoji}</span>`}
      <div class="li-t" data-act="liEdit" data-lid="${it.id}">${nameHtml}${sub.length ? `<small>${sub.join(' · ')}</small>` : ''}</div>
      ${qe ? `<input class="li-qin" data-liq="text" data-lid="${it.id}" value="${esc(q)}" placeholder="Menge" enterkeyhint="done" aria-label="Menge, z.B. 2 kg">`
        : q ? `<span class="li-q">${esc(q)}</span>` : ''}
      ${p && !qe ? liPriceHtml(it, best, p) : ''}
      ${qe ? `<button class="check li-qset" data-act="liQSet" data-lid="${it.id}" aria-label="Einstellungen">⚙️</button>`
        : `<button class="check${it.done ? ' on' : ''}" data-act="liToggle" data-lid="${it.id}" aria-label="${it.done ? 'wieder auf den Zettel' : 'abhaken'}">✓</button>`}
    </div></div>`;
}

// Notiz: kleines 🗒️ hinter dem Namen (in beiden Ansichten), antippen klappt den Text darunter auf/zu
function liNoteHtml(it, part) {
  const open = LI.noteOpen.has(it.id);
  if (part === 'text') return open ? `<span class="li-note">${esc(it.note)}</span>` : '';
  return `<button class="li-note-ico${open ? ' on' : ''}" data-act="liNote" data-lid="${it.id}" aria-label="Notiz ${open ? 'zuklappen' : 'anzeigen'}" aria-expanded="${open}">🗒️</button>` +
    (open && part !== 'ico' ? `<span class="li-note">${esc(it.note)}</span>` : '');
}

// Mengenfeld: „2,5 kg“, „3“, „3x“, „2 Pck“ → Menge + Einheit (bekannte Einheiten vereinheitlicht)
function liQtyParse(s) {
  const m = s.trim().match(/^(\d+(?:[.,]\d+)?)?\s*(.*)$/);
  const qty = m[1] ? toNum(m[1]) : null;
  let unit = m[2].trim().replace(/\.$/, '');
  if (/^[x×]$/i.test(unit)) unit = '';
  else unit = LI_UNIT_MAP[unit.toLowerCase()] || unit.slice(0, 12);
  return { qty: qty > 0 ? qty : null, unit: qty > 0 || unit ? unit : '' };
}


function renderShop() {
  view.innerHTML = `<div class="head li-head"><h2>📝 Einkaufszettel</h2><span id="liSum" class="li-sum"></span>
      <button class="icon-btn li-menu-btn" data-act="liMenu" aria-label="Menü">⋯</button></div>
    <form id="liForm" class="li-form" autocomplete="off">
      <input id="liIn" type="text" enterkeyhint="done" placeholder="Ich brauche …  z.B. 3 l Milch, 1,5 %" value="${esc(LI.draft)}">
      <button type="button" id="liPrioBtn" class="btn li-prio-btn${LI.prioNext ? ' on' : ''}" data-act="liPrioNext"
        aria-pressed="${LI.prioNext}" aria-label="Als wichtig hinzufügen" title="Nächsten Eintrag als wichtig hinzufügen">❗</button>
      <button class="btn primary" aria-label="Hinzufügen">＋</button></form>
    <div id="liSug" class="li-sug" hidden></div>
    <div class="li-tools"><span class="li-lbl">Ansicht</span><span class="seg">
      <button class="${LI.view === 'simple' ? 'on' : ''}" data-act="liView" data-v="simple">Einfach</button>
      <button class="${LI.view === 'plain' ? 'on' : ''}" data-act="liView" data-v="plain">Details</button></span>
      <button id="liSync" class="li-sync" data-act="liSyncInfo" hidden></button></div>
    <div id="liBody"></div>`;
  liBody();
  liSyncBadge();
  liWake();
}

function liBody() {
  const body = $('#liBody');
  if (!body) return;
  const open = liOpen(), done = liItems().filter(i => i.done);
  const best = new Map(open.filter(i => i.kind === 'wish').map(i => [i.id, liBest(i)]));
  const order = new Map(liCats().map((c, i) => [c.id, i]));
  const catRank = it => order.get(catInfo(it.cat).id) ?? 9999;
  let total = 0, priced = 0;
  // Summe nur aus konkreten Preisen (Angebot oder von Hand) – Bestpreise der Favoriten-Wünsche zählen nicht mit
  for (const it of open) {
    const p = it.kind === 'offer' || it.price != null ? liPrice(it) : null;
    if (p) { total += p.total; priced++; }
  }
  const sum = $('#liSum');
  if (sum) sum.innerHTML = open.length ? `${open.length} offen${liShowPrices() && priced ? ` · ${priced < open.length ? 'ca. ' : ''}<b>${fmt(total)} €</b>` : ''}` : '';

  let h = '';
  if (!open.length && !done.length) {
    h = `<p class="empty">Der Zettel ist leer.<br><br>Oben eintippen, was du brauchst – z.B. „3 l Milch und 6 Eier“; mit „!“ davor (z.B. „!Brot“) steht ein Eintrag als wichtig immer oben.
      Bei Angeboten fügt ＋ das Angebot hinzu; in Produktgruppen und Favoriten legt „＋ Zettel“ einen Wunsch an,
      für den immer das günstigste aktuelle Angebot angezeigt wird.</p>`;
  } else if (!open.length) {
    h = '<p class="empty">Alles erledigt 🎉</p>';
  }
  if (open.length) {
    // eine Liste ohne Überschriften, wichtige oben; sortiert nach Kategorie (Laden-Reihenfolge), Eingabe (IDs beginnen mit der Uhrzeit)
    // oder alphabetisch
    const byName = (a, b) => (a.orig || a.name).localeCompare(b.orig || b.name, 'de');  // ersetzte Einträge nach dem ursprünglichen Namen
    let sorter = LI.sort === 'added' ? (a, b) => a.id.localeCompare(b.id)
      : LI.sort === 'alpha' ? byName : (a, b) => catRank(a) - catRank(b) || byName(a, b);
    const s0 = sorter;
    sorter = (a, b) => !!b.prio - !!a.prio || s0(a, b);  // wichtige immer oben
    h += `<div class="li-sortbar">Sortierung <span class="seg">${[['added', 'Eingabe'], ['alpha', 'A–Z'], ['cat', 'Kategorie']]
      .map(([k, l]) => `<button class="${LI.sort === k ? 'on' : ''}" data-act="liSort" data-s="${k}">${l}</button>`).join('')}</span></div>
      <section class="li-group">${[...open].sort(sorter).map(it => liRow(it, best.get(it.id))).join('')}</section>`;
  }
  if (done.length) {
    done.sort((a, b) => (b.dt || 0) - (a.dt || 0));
    h += `<section class="li-group li-done"><h3 data-act="liDoneOpen">✓ Zuletzt abgehakt <i>${done.length}</i>
      <span class="li-gsum">${LI.doneOpen ? '▴' : '▾'}</span></h3>
      ${LI.doneOpen ? done.slice(0, 60).map(it => liRow(it, null)).join('') +
        '<div class="li-done-acts"><button class="btn small" data-act="liClearDone">Abgehakte entfernen</button></div>' : ''}</section>`;
  }
  // Verlauf ohne die Einträge, die gerade offen auf dem Zettel stehen
  const openKeys = new Set(open.map(i => nkey(i.name)));
  const hist = [...R.hist.values()].filter(x => !x.del && x.name && !openKeys.has(nkey(x.name)));
  if (hist.length) {
    const d = ts => ts ? new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
    const sorter = LI.histSort === 'freq' ? (a, b) => (b.c || 0) - (a.c || 0) || (b.last || 0) - (a.last || 0)
      : LI.histSort === 'alpha' ? (a, b) => a.name.localeCompare(b.name, 'de') : (a, b) => (b.last || 0) - (a.last || 0);
    h += `<section class="li-group li-done li-hist"><h3 data-act="liHistOpen">🕘 Verlauf <i>${hist.length}</i>
      <span class="li-gsum">${LI.histOpen ? '▴' : '▾'}</span></h3>
      ${LI.histOpen ? `<div class="li-sortbar" style="padding:8px 14px 4px">Sortierung <span class="seg">${[['last', 'Zuletzt'], ['freq', 'Häufig'], ['alpha', 'A–Z']]
        .map(([k, l]) => `<button class="${(LI.histSort || 'last') === k ? 'on' : ''}" data-act="liHistSort" data-s="${k}">${l}</button>`).join('')}</span></div>` +
        hist.sort(sorter).slice(0, LI.histAll ? 1000 : 60).map(x => {
          const c = catInfo(x.cat);
          return `<div class="li-row" data-hid="${esc(x.id)}">
            <div class="li-bg"><span class="li-bg-done"></span><span class="li-bg-del">Aus Verlauf entfernen 🗑</span></div><div class="li-fg">
            <span class="li-ico" style="--c:${c.color}">${c.emoji}</span>
            <div class="li-t">${esc(x.name)}${liSimple() ? '' : `<small>${x.fav ? '★ Wunsch · ' : ''}${x.c || 1}× auf dem Zettel${x.b ? ` · ${x.b}× gekauft, zuletzt ${d(x.bought)}` : ` · zuletzt ${d(x.last)}`}</small>`}</div>
            <button class="ic add" data-act="liHistAdd" data-hid="${esc(x.id)}" aria-label="Wieder auf den Zettel">＋</button>
          </div></div>`;
        }).join('') + (hist.length > 60 && !LI.histAll ? '<div class="li-done-acts"><button class="btn small" data-act="liHistAll" data-auto>Weitere werden geladen …</button></div>' : '') : ''}</section>`;
  }
  body.innerHTML = h;
  updateBadges();
}

// nach Änderungen: nur den Listenbereich neu zeichnen (Eingabezeile behält Fokus und Text)
function liRefresh() {
  if (route()[0] === 'list' && $('#liBody')) liBody();
  else updateBadges();
  liWake();
}

// Abgleich-Status als Symbol mit fester Breite (Text wechselt sonst bei jedem Abgleich und lässt die Seite
// am Handy springen); Details per Tipp
function liSyncState() {
  const t = LI.lastSync ? new Date(LI.lastSync).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
  const n = LI.dirty.size;
  if (LI.syncErr) return ['⚠', 'err', `Offline – ${n ? n + ' Änderung' + (n > 1 ? 'en werden' : ' wird') : 'Abgleich wird'} nachgeholt`];
  if (n) return ['⟳', '', `${n} Änderung${n > 1 ? 'en' : ''} noch nicht abgeglichen`];
  if (t) return ['✓', 'ok', `Abgeglichen um ${t}`];
  return ['⟳', '', 'Wird abgeglichen …'];
}

function liSyncBadge() {
  const el = $('#liSync');
  if (!el || !Cloud.enabled) return;
  const [icon, cls, text] = liSyncState();
  el.hidden = false;
  if (el.textContent !== icon) el.textContent = icon;
  el.className = 'li-sync ' + cls;
  el.title = text;
  el.setAttribute('aria-label', text);
}

/* ---------- Vorschläge beim Tippen ---------- */

// Favoriten, die zu einem Namen passen (für Vorschläge und den Bearbeiten-Dialog)
function liFavsFor(name) {
  const toks = qTokens(name);
  if (!toks.length || !S.favs.length) return [];
  const q = nkey(name);
  const offers = S.loaded ? liMatches(name) : [];
  const score = f => {
    const L = favLabel(f), title = nkey(`${L.title} ${f.q || ''} ${f.group || ''}`);
    if (title.includes(q)) return 3;
    if (toks.every(t => (' ' + title).includes(' ' + t))) return 2;
    return offers.slice(0, 30).some(o => favMatch(f, o)) ? 1 : 0;
  };
  return S.favs.map(f => [f, score(f)]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
}

// Vorschläge beim Eintippen – Verfahren wie bei „Die Einkaufsliste“: Punkte je Treffer (genau 1000, Wortanfang 800,
// Wortanfang innerhalb 700, irgendwo im Wort 600 − Länge; letzteres erst ab 2 Buchstaben) plus Gewicht der Quelle.
// Quellen: ★-Favoriten > eigener Verlauf (je Nutzung stärker) > Warenliste (goods.js) > Warengruppen der Angebote > Marken.
// Außer Favoriten (Wunsch mit Preisvergleich) nur Namen – keine Angebote, keine Kategorie-Auswahl.
let liPool = null;
const liGoodsCat = new Map();
for (const [cat, list] of Object.entries(typeof LI_GOODS === 'object' ? LI_GOODS : {})) {
  for (const n of list.split(',').map(s => s.trim()).filter(Boolean)) if (!liGoodsCat.has(nkey(n))) liGoodsCat.set(nkey(n), cat);
}
function liSugPool() {
  if (liPool && liPool.n === S.offers.length) return liPool.items;
  const items = new Map();
  const add = (name, src, extra = {}) => { const k = nkey(name); if (k && !items.has(k)) items.set(k, { name, k, src, ...extra }); };
  for (const [cat, list] of Object.entries(typeof LI_GOODS === 'object' ? LI_GOODS : {})) {
    for (const n of list.split(',').map(s => s.trim()).filter(Boolean)) add(n, 'ware', { cat });
  }
  if (S.loaded) {
    for (const [c, gs] of Object.entries(S.groups)) for (const g of gs) if (g !== OTHER) add(g, 'gruppe', { icon: ICONS[c] });
    // Marken: nur echte Marken, die mehrfach in den Angeboten vorkommen
    const brands = new Map();
    for (const o of S.offers) if (o.brand && o.brand_type === 'marke') brands.set(o.brand, (brands.get(o.brand) || 0) + 1);
    for (const [b, n] of brands) if (n >= 2 && b.length > 2) add(b, 'marke');
  }
  liPool = { n: S.offers.length, items: [...items.values()] };
  return liPool.items;
}
function liSugScore(k, q) {
  if (k === q) return 1000;
  if (k.startsWith(q)) return 800;
  const i = k.indexOf(q);
  if (i < 0) return 0;
  if (k[i - 1] === ' ') return 700;
  return q.length >= 2 ? 600 - k.length : 0;
}
function liSuggest() {
  const box = $('#liSug');
  if (!box) return;
  const parts = liSplit(LI.draft);
  const last = parts.length && !/\s+und\s*$/i.test(LI.draft) ? liParse(parts[parts.length - 1]) : null;
  const q = last ? nkey(last.name) : '';
  if (!q) { box.hidden = true; return; }
  const openKeys = new Set(liOpen().map(i => nkey(i.name)));
  const res = new Map();
  // eigene ★-Favoriten zuerst (unter ihrem eigenen Namen, landen als Wunsch mit Preisvergleich auf dem Zettel)
  for (const f of S.favs) {
    const name = favLabel(f).title, k = nkey(name), s = liSugScore(k, q);
    if (s) res.set(k, { name, k, src: 'fav', fid: f.id, icon: favLabel(f).icon, score: s + 400 });
  }
  for (const h of R.hist.values()) {
    if (h.del || !h.name) continue;
    const k = nkey(h.name), s = liSugScore(k, q);
    if (s && !res.has(k)) res.set(k, { name: h.name, k, src: 'hist', c: h.c || 1, cat: h.cat, score: s + 150 + Math.min(h.c || 1, 20) * 10 });
  }
  const bonus = { ware: 40, gruppe: 20, marke: 10 };
  for (const x of liSugPool()) {
    if (res.has(x.k)) continue;
    const s = liSugScore(x.k, q);
    if (s) res.set(x.k, { ...x, score: s + bonus[x.src] });
  }
  const top = [...res.values()].sort((a, b) => b.score - a.score || a.name.length - b.name.length).slice(0, 8);
  if (!top.length || (top.length === 1 && top[0].k === q && top[0].src !== 'hist')) { box.hidden = true; return; }
  const icon = x => x.src === 'fav' ? '★' : x.src === 'hist' ? catInfo(x.cat).emoji : x.src === 'ware' ? catInfo(x.cat).emoji
    : x.src === 'gruppe' ? (x.icon || '🛒') : '🏷️';
  const label = x => openKeys.has(x.k) ? '✓ auf dem Zettel' : x.src === 'fav' ? 'Favorit'
    : x.src === 'hist' ? (x.c > 1 ? `${x.c}×` : 'Verlauf') : x.src === 'gruppe' ? 'Warengruppe' : x.src === 'marke' ? 'Marke' : '';
  box.innerHTML = top.map(x => `<button type="button" ${x.src === 'fav' ? `data-act="liSugFav" data-fid="${esc(x.fid)}"` : 'data-act="liSug"'} data-name="${esc(x.name)}">
      <span>${icon(x)}</span>${esc(x.name)}<i>${label(x)}</i></button>`).join('');
  box.hidden = false;
}

/* ---------- Bearbeiten ---------- */

function liEditSheet(it) {
  LI.editId = it.id;
  const best = liBest(it);
  const auto = it.kind === 'offer' ? it.offer.price : best?.ep;
  const catOpts = liCats().filter(c => !c.hidden || c.id === it.cat)
    .map(c => `<option value="${c.id}" ${c.id === catInfo(it.cat).id ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('');
  const unitOpts = `<option value="">–</option>` + LI_UNITS.map(([u]) => `<option ${u === it.unit ? 'selected' : ''}>${u}</option>`).join('');
  let extra = '';
  if (it.kind === 'offer') {
    const o = it.offer, live = S.byId.get(o.id);
    extra = `<div class="li-offer"><b>Angebot</b> ${esc(S.retailers[o.retailer]?.name || o.retailer)} · ${esc(o.title)}
      · ${fmt(o.price)} €${o.unit_price ? ` (${fmt(o.unit_price)} €/${esc(o.unit)})` : ''}${o.app ? ` · 📱 ${esc(o.app)}` : ''}
      ${live ? `<br><button class="btn small" data-act="open" data-id="${esc(o.id)}">Angebot ansehen</button>` : '<br><small class="muted">nicht mehr in den aktuellen Angeboten</small>'}</div>`;
  } else {
    const m = it.kind === 'wish' ? curFirst(sortOffers(visible().filter(o => favMatch(it.fav, o)), metricSort(it.fav))) : liMatches(it.name, catInfo(it.cat).id);
    if (it.kind === 'free') {
      const favs = liFavsFor(it.name).slice(0, 4);
      if (favs.length) {
        extra += `<h3 class="li-sec">★ Passende Favoriten</h3><div class="li-offers">${favs.map(f => {
          const L = favLabel(f);
          return `<div class="li-orow"><span>${L.icon}</span><span class="t">${esc(L.title)}<small>${esc(L.sub)} · Vergleich ${byPack(f) ? 'Packungspreis' : 'Grundpreis'}</small></span>
            <button class="btn small" data-act="liUseFav" data-fid="${esc(f.id)}">verwenden</button></div>`;
        }).join('')}</div>
        <p class="sub">Der Eintrag zeigt dann immer das günstigste Angebot des Favoriten – mit dessen Preisvergleich.</p>`;
      }
      extra += liMatchUI(it);
    }
    if (it.kind === 'free' && !m.length) extra += '<p class="sub">Derzeit kein passendes Angebot.</p>';
    if (m.length) {
      extra += `<h3 class="li-sec">${it.kind === 'wish' ? 'Passende Angebote (günstigstes wird verwendet)' : 'Passende Angebote'}</h3>
        <div class="li-offers">${m.slice(0, 6).map(o => `<div class="li-orow">
          <span class="rt" style="--c:${S.retailers[o.retailer]?.color}">${esc(rname(o))}</span>
          <span class="t" data-act="open" data-id="${esc(o.id)}">${esc(o.brand)} ${esc(o.name)}<small>${esc(priceLine(o))}${o.ea ? ' · 📱' : ''}</small></span>
          <b>${fmt(o.ep)} €</b>
          <button class="btn small" data-act="liUseOffer" data-oid="${esc(o.id)}">übernehmen</button></div>`).join('')}</div>
        ${m.length > 6 ? `<p class="sub">+ ${m.length - 6} weitere – oben im Suchfeld nach „${esc(it.name)}“ suchen.</p>` : ''}`;
    }
  }
  openSheet(`<div class="grab"></div><div class="li-edit">
    <div class="head"><h2>Eintrag bearbeiten</h2></div>
    <label class="li-f">Name<input data-li="name" value="${esc(it.name)}" autocomplete="off"></label>
    <div class="li-f li-qrow"><span>Menge</span>
      <button type="button" class="ic" data-act="liQtyStep" data-d="-1">−</button>
      <input data-li="qty" inputmode="decimal" value="${it.qty ? fmtQty(it.qty) : ''}" placeholder="–">
      <button type="button" class="ic" data-act="liQtyStep" data-d="1">＋</button>
      <select data-li="unit">${unitOpts}</select></div>
    <label class="li-f">Notiz<span class="li-note-f"><input data-li="note" value="${esc(it.note || '')}" placeholder="z.B. laktosefrei, die grüne Packung">
      ${it.note ? `<button type="button" class="btn li-note-del" data-act="liNoteDel" data-lid="${it.id}" aria-label="Notiz löschen">🗑</button>` : ''}</span></label>
    <label class="li-f">Kategorie<select data-li="cat">${catOpts}</select></label>
    <label class="li-f">Preis (€)<input data-li="price" inputmode="decimal" value="${it.price != null ? fmt(it.price) : ''}"
      placeholder="${auto != null ? 'aus Angebot: ' + fmt(auto) : 'optional'}"></label>
    <label class="switch li-f"><input type="checkbox" data-li="prio" ${it.prio ? 'checked' : ''}> ❗ Wichtig – steht immer oben</label>
    <label class="switch li-f"><input type="checkbox" data-li="fixed" ${it.pm === 'fixed' ? 'checked' : ''}> Einzelpreis – nicht mit der Menge multiplizieren</label>
    ${extra}
    <div class="actions"><button class="btn danger" data-act="liDelEdit">Löschen</button>
      <button class="btn" data-act="liToggleEdit">${it.done ? 'Wieder auf den Zettel' : 'Abhaken'}</button>
      <button class="btn primary" data-act="closeSheet">Fertig</button></div></div>`);
}

function liEditField(el) {
  const it = R.item.get(LI.editId);
  if (!it) return;
  const f = el.dataset.li, v = el.value.trim();
  if (f === 'name') { if (!v) return; it.name = v; }
  else if (f === 'qty') it.qty = v ? (toNum(v) > 0 ? toNum(v) : it.qty) : null;
  else if (f === 'unit') it.unit = v;
  else if (f === 'note') it.note = v;
  else if (f === 'price') it.price = v ? (Number.isFinite(toNum(v)) ? toNum(v) : it.price) : null;
  else if (f === 'fixed') it.pm = el.checked ? 'fixed' : null;
  else if (f === 'prio') it.prio = el.checked;
  else if (f === 'cat') {
    it.cat = v;
    const k = nkey(it.name);
    put('learn', { ...(R.learn.get(k) || {}), id: k, cat: v, del: false });  // beim nächsten Mal gleich richtig
  }
  put('item', it);
  liRefresh();
}

/* ---------- Kategorien verwalten ---------- */

function liCatSheet() {
  const cats = liCats();
  openSheet(`<div class="grab"></div><div class="head"><h2>Kategorien</h2></div>
    <p class="sub">Reihenfolge = Weg durch den Laden. Ausgeblendete Kategorien stehen bei der Auswahl nicht zur Wahl.</p>
    <div class="li-cats">${cats.map((c, i) => `<div class="li-cat${c.hidden ? ' hidden' : ''}">
      <input class="emo" data-cat="${c.id}" data-f="emoji" value="${esc(c.emoji)}" maxlength="4" aria-label="Symbol">
      <input class="nm" data-cat="${c.id}" data-f="name" value="${esc(c.name)}" aria-label="Name">
      <input type="color" data-cat="${c.id}" data-f="color" value="${esc(c.color)}" aria-label="Farbe">
      <button class="ic" data-act="liCatMove" data-cid="${c.id}" data-d="-1" ${i ? '' : 'disabled'} aria-label="nach oben">↑</button>
      <button class="ic" data-act="liCatMove" data-cid="${c.id}" data-d="1" ${i < cats.length - 1 ? '' : 'disabled'} aria-label="nach unten">↓</button>
      <button class="ic" data-act="liCatHide" data-cid="${c.id}" aria-label="${c.hidden ? 'einblenden' : 'ausblenden'}">${c.hidden ? '🚫' : '👁'}</button>
      ${c.id === 'sonstiges' ? '' : `<button class="ic" data-act="liCatDel" data-cid="${c.id}" aria-label="löschen">🗑</button>`}
    </div>`).join('')}</div>
    <div class="actions"><button class="btn" data-act="liCatAdd">＋ Kategorie</button>
      <button class="btn primary" data-act="closeSheet">Fertig</button></div>`);
}

function liCatReorder(cats) {
  cats.forEach((c, i) => { if (c.order !== i * 10) { c.order = i * 10; put('cat', c); } });
}

/* ---------- Menü, Teilen, Bildschirm ---------- */

function liMenuSheet() {
  const canWake = 'wakeLock' in navigator;
  openSheet(`<div class="grab"></div><div class="head"><h2>Einkaufszettel</h2></div>
    <div class="panel">
      <label class="line switch"><input type="checkbox" data-liset="prices" ${LI.prices ? 'checked' : ''} ${liSimple() ? 'disabled' : ''}> Preise anzeigen</label>
      <label class="line switch"><input type="checkbox" data-liset="wake" ${LI.wake ? 'checked' : ''} ${canWake ? '' : 'disabled'}>
        Bildschirm bleibt beim Einkaufen an${canWake ? '' : ' (von diesem Browser nicht unterstützt)'}</label>
    </div>
    <div class="actions">
      <button class="btn" data-act="liCats">🗂️ Kategorien bearbeiten</button>
      <button class="btn" data-act="liShare">📤 Teilen</button>
      <button class="btn" data-act="liClearDone">Abgehakte entfernen</button>
      <button class="btn danger" data-act="liClear">Zettel leeren</button>
      ${Cloud.enabled ? '<button class="btn" data-act="liSyncNow">⟳ Jetzt abgleichen</button>' : ''}
    </div>`);
}

async function liWake() {
  const want = LI.wake && route()[0] === 'list' && document.visibilityState === 'visible' && liOpen().length > 0;
  try {
    if (want && !LI.lock && 'wakeLock' in navigator) {
      LI.lock = await navigator.wakeLock.request('screen');
      LI.lock.addEventListener('release', () => { LI.lock = null; });
    } else if (!want && LI.lock) {
      await LI.lock.release();
      LI.lock = null;
    }
  } catch { /* abgelehnt, z.B. Energiesparmodus */ }
}

function liShareText() {
  const lines = ['Einkaufszettel'];
  const open = liOpen();
  for (const c of liCats()) {
    const items = open.filter(i => catInfo(i.cat).id === c.id);
    if (!items.length) continue;
    lines.push('', `${c.emoji} ${c.name}`);
    for (const it of items) {
      const best = liBest(it);
      const where = it.kind === 'offer' ? ` (${S.retailers[it.offer.retailer]?.name || it.offer.retailer} ${fmt(it.offer.price)} €)`
        : best ? ` (${rname(best)}: ${best.brand} ${best.name} ${fmt(best.ep)} €)` : '';
      lines.push(`- ${it.prio ? '❗ ' : ''}${qtyLabel(it) ? qtyLabel(it) + ' ' : ''}${it.name}${it.note ? ' – ' + it.note : ''}${where}`);
    }
  }
  return lines.join('\n');
}

/* ---------- Abgleich (Supabase) ---------- */

const Sync = {
  t: null,
  soon() {
    if (!Cloud.enabled) return;
    clearTimeout(this.t);
    this.t = setTimeout(() => this.run(), 800);
  },
  async run() {
    if (!Cloud.enabled || !Cloud.loggedIn() || LI.syncing) return;
    LI.syncing = true;
    liSyncBadge();
    let changed = false, favChanged = false;
    try {
      // 1. eigene Änderungen senden (nur als erledigt markieren, wenn sich die Zeile inzwischen nicht geändert hat)
      const keys = [...LI.dirty];
      const rows = [], sent = [];
      for (const k of keys) {
        const [kind, ...rest] = k.split('|');
        const id = rest.join('|'), d = R[kind]?.get(id);
        if (!d) { LI.dirty.delete(k); continue; }
        rows.push({ kind, id, data: d, deleted: !!d.del });
        sent.push([k, kind, id, d.u]);
      }
      for (let i = 0; i < rows.length; i += 400) await Cloud.pushList(rows.slice(i, i + 400));
      for (const [k, kind, id, u] of sent) if (R[kind].get(id)?.u === u) LI.dirty.delete(k);
      // 2. Änderungen der anderen holen (2 s Überlappung gegen gleichzeitige Schreibvorgänge)
      let since = LI.cursor ? new Date(Date.parse(LI.cursor) - 2000).toISOString() : '1970-01-01T00:00:00Z';
      for (;;) {
        const got = await Cloud.pullList(since);
        for (const r of got) {
          if (!R[r.kind]) continue;
          const local = R[r.kind].get(r.id);
          if (local && (local.u || 0) >= (r.data.u || 0)) continue;
          R[r.kind].set(r.id, { ...r.data, del: r.deleted });
          changed = true;
          if (r.kind === 'fav') favChanged = true;
        }
        if (got.length) LI.cursor = got[got.length - 1].updated_at;
        if (got.length < 1000) break;
        since = LI.cursor;
      }
      save('li.cursor', LI.cursor);
      LI.lastSync = Date.now();
      LI.syncErr = null;
    } catch (e) {
      LI.syncErr = e.message;
      if (e instanceof LoginNeeded) showLogin();
    } finally {
      LI.syncing = false;
      liSave();
      if (changed) { LI.hints.clear(); liRefresh(); }  // auch geänderte Zuordnungen anderer Geräte
      if (favChanged && liFavsPull() && S.loaded && route()[0] !== 'list') rerender();
      liSyncBadge();
    }
  },
};

/* ---------- Ereignisse ---------- */

const liById = el => R.item.get(el.dataset.lid);
const swiped = () => Date.now() - LI.suppress < 450;

Object.assign(onClick, {
  liToggle: el => {
    if (swiped()) return;
    const it = liById(el);
    if (!it) return;
    liSetDone(it, !it.done);
    if (it.done) toast(`✓ ${it.name}`, { label: 'Rückgängig', fn: () => { liSetDone(it, false); liRefresh(); } });
    liRefresh();
  },
  liNote: el => {
    if (swiped()) return;
    const id = el.dataset.lid;
    if (!LI.noteOpen.delete(id)) LI.noteOpen.add(id);
    liRefresh();
  },
  liNoteDel: el => {
    // nur in der Bearbeitung (⚙️) des Eintrags
    const it = liById(el);
    if (!it?.note) return;
    const old = it.note;
    const redo = () => { liRefresh(); if (LI.editId === it.id) liEditSheet(it); };
    it.note = '';
    put('item', it);
    LI.noteOpen.delete(it.id);
    toast('Notiz gelöscht', { label: 'Rückgängig', fn: () => { it.note = old; put('item', it); redo(); } });
    redo();
  },
  liEdit: el => {
    if (swiped()) return;
    const it = liById(el);
    if (!it) return;
    if (it.done) { liEditSheet(it); return; }
    if (LI.qtyClosed?.id === it.id && Date.now() - LI.qtyClosed.t < 500) return;
    LI.qtyId = LI.qtyId === it.id ? null : it.id;  // erneut antippen schließt das Mengenfeld
    liRefresh();
    // Mengenfeld fokussieren, aber ohne Tastatur (inputmode none) – erst ein Tipp ins Feld öffnet sie
    if (LI.qtyId) { const inp = $(`.li-qin[data-lid="${it.id}"]`); if (inp) { inp.inputMode = 'none'; inp.focus(); inp.select(); } }
  },
  liQSet: el => { const it = liById(el); if (it) { LI.qtyId = null; liRefresh(); liEditSheet(it); } },

  liView: el => { LI.view = el.dataset.v; save('li.view', LI.view); save('li.viewV2', true); renderShop(); },
  liMatch: el => {
    const it = R.item.get(LI.editId);
    if (!it) return;
    const k = nkey(it.name), cur = liRuleFor(it.name);
    const rule = { words: [...cur.words], soft: [], brands: [...cur.brands], group: cur.group };
    const v = el.dataset.v;
    const flip = (arr, x) => arr.includes(x) ? arr.filter(y => y !== x) : [...arr, x];
    if (el.dataset.t === 'word') rule.words = flip(rule.words, v);
    else if (el.dataset.t === 'brand') rule.brands = flip(rule.brands, v);
    else rule.group = rule.group === v ? null : v;
    put('learn', { ...(R.learn.get(k) || {}), id: k, del: false, match: rule });
    LI.hints.clear();
    liRefresh();
    liEditSheet(it);
  },
  liMatchAuto: () => {
    const it = R.item.get(LI.editId);
    const l = it && R.learn.get(nkey(it.name));
    if (!l) return;
    put('learn', { ...l, match: null });
    LI.hints.clear();
    liRefresh();
    liEditSheet(it);
  },

  liPrioNext: el => {
    LI.prioNext = !LI.prioNext;
    el.classList.toggle('on', LI.prioNext);
    el.setAttribute('aria-pressed', String(LI.prioNext));
    $('#liIn')?.focus();
  },
  liSort: el => { LI.sort = el.dataset.s; save('li.sort', LI.sort); save('li.sortV2', true); liBody(); },
  liDoneOpen: () => { LI.doneOpen = !LI.doneOpen; liBody(); },
  liHistOpen: () => { LI.histOpen = !LI.histOpen; liBody(); },
  liHistSort: el => { LI.histSort = el.dataset.s; save('li.histSort', LI.histSort); liBody(); },
  liHistAll: () => { LI.histAll = true; liBody(); },
  liHistAdd: el => {
    const x = R.hist.get(el.dataset.hid);
    if (!x) return;
    const prio = liTakePrio();
    if (x.fav) Li.addWish(x.fav, x.name, { prio });
    else { liAddFree(x.name, x.qty || null, x.unit || '', prio); toast(`＋ „${x.name}“ wieder auf dem Zettel`); }
    liRefresh();
  },
  liMenu: () => liMenuSheet(),
  liCats: () => liCatSheet(),
  liSug: el => {
    // letzten Teil der Eingabe durch den Vorschlag ersetzen, Menge bleibt erhalten
    const parts = liSplit(LI.draft);
    const last = liParse(parts.pop() || '');
    const q = last.qty ? `${fmtQty(last.qty)}${last.unit ? ' ' + last.unit : ''} ` : '';
    liAddText([...parts, (last.prio ? '!' : '') + q + el.dataset.name].join(' und '));
    LI.draft = '';
    const inp = $('#liIn');
    if (inp) { inp.value = ''; inp.blur(); }  // Vorschlag gewählt: Tastatur schließen
    $('#liSug').hidden = true;
    liRefresh();
  },
  liSugFav: el => {
    const f = S.favs.find(x => x.id === el.dataset.fid);
    if (!f) return;
    const parts = liSplit(LI.draft), last = liParse(parts.pop() || '');
    if (parts.length) liAddText(parts.join(' und '));
    if (Li.favWish(f)) toast(`„${favLabel(f).title}“ ist schon auf dem Einkaufszettel`);
    else Li.addWish(f, favLabel(f).title, { ...last, prio: last.prio || liTakePrio() });
    LI.draft = '';
    const inp = $('#liIn');
    if (inp) { inp.value = ''; inp.blur(); }  // Vorschlag gewählt: Tastatur schließen
    $('#liSug').hidden = true;
    liRefresh();
  },
  liUseFav: el => {
    const it = R.item.get(LI.editId), f = S.favs.find(x => x.id === el.dataset.fid);
    if (!it || !f) return;
    const { id, ...fav } = f;
    Object.assign(it, { kind: 'wish', fav, price: null });
    delete it.offer;
    put('item', it);
    liRefresh();
    liEditSheet(it);
    toast(`★ „${favLabel(f).title}“ verknüpft`);
  },
  liSugWish: el => {
    const c = el.dataset.c, g = el.dataset.g;
    Li.addWish({ type: 'group', category: c, group: g, brands: [], brandOnly: false }, g, { prio: liTakePrio() });
    LI.draft = '';
    const inp = $('#liIn');
    if (inp) { inp.value = ''; inp.blur(); }
    $('#liSug').hidden = true;
    liRefresh();
  },
  liQtyStep: el => {
    const it = R.item.get(LI.editId);
    if (!it) return;
    const step = LI_MEASURE.has(it.unit) ? (it.unit === 'g' || it.unit === 'ml' ? 100 : 0.5) : 1;
    it.qty = Math.max(step, Math.round(((it.qty || (Number(el.dataset.d) > 0 ? 0 : step)) + Number(el.dataset.d) * step) * 100) / 100);
    put('item', it);
    const inp = $('.li-edit [data-li="qty"]');
    if (inp) inp.value = fmtQty(it.qty);
    liRefresh();
  },
  liDelEdit: () => {
    const it = R.item.get(LI.editId);
    closeSheet();
    if (it) { liDelete(it); liRefresh(); }
  },
  liToggleEdit: () => {
    const it = R.item.get(LI.editId);
    closeSheet();
    if (it) { liSetDone(it, !it.done); liRefresh(); }
  },
  liUseOffer: el => {
    const it = R.item.get(LI.editId), o = S.byId.get(el.dataset.oid);
    if (!it || !o) return;
    Object.assign(it, { kind: 'offer', offer: offerSnap(o), price: null });
    delete it.fav;
    put('item', it);
    liRefresh();
    liEditSheet(it);
    toast('Angebot übernommen');
  },
  liClearDone: () => {
    const done = liItems().filter(i => i.done);
    if (!done.length) return;
    done.forEach(it => { it.del = true; put('item', it); });
    if (S.sheetOpen) closeSheet();
    toast(`${done.length} abgehakte entfernt`, { label: 'Rückgängig', fn: () => { done.forEach(it => { it.del = false; put('item', it); }); liRefresh(); } });
    liRefresh();
  },
  liClear: () => {
    const all = liItems();
    if (!all.length || !confirm('Einkaufszettel komplett leeren?')) return;
    all.forEach(it => { it.del = true; put('item', it); });
    if (S.sheetOpen) closeSheet();
    toast('Zettel geleert', { label: 'Rückgängig', fn: () => { all.forEach(it => { it.del = false; put('item', it); }); liRefresh(); } });
    liRefresh();
  },
  liShare: async () => {
    const text = liShareText();
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('In die Zwischenablage kopiert'); }
    } catch { /* abgebrochen */ }
  },
  liSyncNow: () => { closeSheet(); Sync.run(); },
  liSyncInfo: () => { toast(liSyncState()[2]); Sync.run(); },
  liCatMove: el => {
    const cats = liCats(), i = cats.findIndex(c => c.id === el.dataset.cid), j = i + Number(el.dataset.d);
    if (i < 0 || j < 0 || j >= cats.length) return;
    [cats[i], cats[j]] = [cats[j], cats[i]];
    liCatReorder(cats);
    liCatSheet();
    liRefresh();
  },
  liCatHide: el => {
    const c = R.cat.get(el.dataset.cid);
    if (!c) return;
    c.hidden = !c.hidden;
    put('cat', c);
    liCatSheet();
  },
  liCatDel: el => {
    const c = R.cat.get(el.dataset.cid);
    if (!c || !confirm(`Kategorie „${c.name}“ löschen? Einträge landen in „Sonstiges“.`)) return;
    c.del = true;
    put('cat', c);
    liCatSheet();
    liRefresh();
  },
  liCatAdd: () => {
    const name = prompt('Name der neuen Kategorie:');
    if (!name?.trim()) return;
    const cats = liCats();
    const c = { id: 'c' + liNewId(), name: name.trim(), emoji: '🏷️', color: '#607d8b',
      order: (cats.length ? cats[cats.length - 1].order : 0) + 10, hidden: false };
    // vor „Sonstiges“ einsortieren
    const s = cats.find(x => x.id === 'sonstiges');
    put('cat', c);
    if (s) liCatReorder([...cats.filter(x => x !== s), c, s]);
    liCatSheet();
  },
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'liForm') return;
  e.preventDefault();
  const inp = $('#liIn');
  inp.blur();  // Enter schließt die Tastatur immer
  const n = liAddText(inp.value);
  if (n) {
    inp.value = '';
    LI.draft = '';
    $('#liSug').hidden = true;
    liRefresh();
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'liIn') { LI.draft = el.value; liSuggest(); return; }
  if (el.dataset.li && el.dataset.li !== 'cat' && el.dataset.li !== 'unit' && el.type !== 'checkbox') {
    clearTimeout(LI.editTimer);
    LI.editTimer = setTimeout(() => liEditField(el), 350);
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset?.liq) { e.preventDefault(); e.target.blur(); }
  if (e.key === 'Escape' && e.target.dataset?.liq) { LI.qtyId = null; e.target.dataset.liq = ''; liRefresh(); }
});

// Tipp ins Mengenfeld ohne Tastatur: Tastatur freigeben und neu fokussieren (Inhalt markiert zum Überschreiben)
document.addEventListener('pointerdown', e => {
  const el = e.target;
  if (!el.dataset?.liq || el.inputMode !== 'none') return;
  el.inputMode = '';
  el.blur();
  el.addEventListener('focus', () => setTimeout(() => el.select(), 0), { once: true });
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.li) { clearTimeout(LI.editTimer); liEditField(el); return; }
  if (el.dataset.liq) {
    const it = R.item.get(el.dataset.lid);
    if (!it) return;
    Object.assign(it, liQtyParse(el.value));
    put('item', it);
    LI.qtyId = null;
    LI.qtyClosed = { id: it.id, t: Date.now() };  // Tipp auf den Namen, der das Feld verlassen hat, nicht wieder öffnen
    liRefresh();
    return;
  }
  if (el.dataset.liset) {
    LI[el.dataset.liset] = el.checked;
    save('li.' + el.dataset.liset, el.checked);
    liRefresh();
    return;
  }
  if (el.dataset.cat) {
    const c = R.cat.get(el.dataset.cat);
    const v = el.value.trim();
    if (!c || !v) return;
    c[el.dataset.f] = v;
    put('cat', c);
    liRefresh();
  }
});

// Angebote eines Zettel-Eintrags (freier Eintrag: Namens-Treffer, Wunsch: Favoriten-Treffer, Angebot: das Angebot)
function liOffersOf(it) {
  if (!S.loaded || it.done) return [];
  if (it.kind === 'offer') { const o = S.byId.get(it.offer.id); return o ? [o] : []; }
  if (it.kind === 'wish') return curFirst(sortOffers(visible().filter(o => favMatch(it.fav, o)), metricSort(it.fav)));
  return liSearchOffers(it);
}
// freier Eintrag: dieselben Treffer wie die Suche oben (eigene Zuordnung per Chips im Bearbeiten-Dialog hat Vorrang)
function liSearchOffers(it) {
  const learned = R.learn.get(nkey(it.name));
  if (learned && !learned.del && learned.match) return liMatches(it.name, catInfo(it.cat).id);
  // kurz zwischenspeichern: die Zeilen des Zettels fragen beim Zeichnen jeweils einzeln
  const k = nkey(it.name), c = LI.searchCache ||= new Map(), hit = c.get(k);
  if (hit && Date.now() - hit.t < 3000) return hit.m;
  const m = curFirst(sortOffers([...searchHits(it.name)]));
  c.set(k, { m, t: Date.now() });
  return m;
}
// langes Drücken auf einen Eintrag: passende Angebote als Liste; nach rechts wischen ersetzt den Eintrag durch das Angebot
function liShowOffers(it) {
  const m = liOffersOf(it);
  if (!m.length) { toast(`Zu „${it.name}“ gerade kein Angebot`); return; }
  openSheet(`<div class="grab"></div><h2 class="li-sheet-h">Angebote zu „${esc(it.name)}“</h2>
    <p class="sub" style="margin:0 0 6px">${m.length} Angebot${m.length === 1 ? '' : 'e'} · nach rechts wischen: Eintrag durch das Angebot ersetzen</p>
    ${offerList(m, { limit: 40, heads: false, sort: it.kind === 'wish' ? metricSort(it.fav) : S.sort })}`);
  S.replaceFor = it.id;  // nach openSheet setzen (openSheet/hideSheet setzen es zurück)
}

// Wischgesten: rechts = abhaken / zurück, links = löschen (mit Rückgängig); langes Drücken = Angebote zeigen
(() => {
  let sw = null;
  view.addEventListener('pointerdown', e => {
    const fg = e.target.closest('.li-row[data-lid] .li-fg, .li-row[data-hid] .li-fg');  // Zettel und Verlauf
    if (!fg || e.button > 0 || e.target.closest('button, input')) return;
    sw = { fg, row: fg.parentElement, x: e.clientX, y: e.clientY, dx: 0, active: false, id: e.pointerId };
    const it = fg.parentElement.dataset.lid && R.item.get(fg.parentElement.dataset.lid);
    if (it && !it.done && !liSimple()) {  // nur in der Ansicht „Details“
      const s0 = sw;
      s0.lp = setTimeout(() => {
        if (sw !== s0 || s0.active) return;
        s0.long = true;
        LI.suppress = Date.now() + 10e3;  // folgenden Klick (Bearbeiten) unterdrücken, bis losgelassen
        window.getSelection?.().removeAllRanges();  // evtl. schon begonnene Textmarkierung aufheben
        liShowOffers(it);
      }, 500);
    }
  });
  // Kontextmenü/Textauswahl beim langen Drücken auf dem Zettel verhindern
  view.addEventListener('contextmenu', e => { if (!liSimple() && e.target.closest('.li-row[data-lid]')) e.preventDefault(); });
  view.addEventListener('pointermove', e => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(sw.lp);
    if (sw.long) return;
    if (!sw.active) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        sw.active = true;
        sw.fg.setPointerCapture(e.pointerId);
        sw.row.classList.add('swiping');
      } else if (Math.abs(dy) > 12) { sw = null; return; } else return;
    }
    sw.dx = sw.row.dataset.hid ? Math.min(0, dx) : dx;  // Verlauf: nur nach links (entfernen)
    sw.fg.style.transform = `translateX(${sw.dx}px)`;
    sw.row.classList.toggle('to-done', sw.dx > 0);
    sw.row.classList.toggle('to-del', sw.dx < 0);
  });
  const end = () => {
    if (!sw) return;
    const s = sw;
    sw = null;
    clearTimeout(s.lp);
    if (s.long) { LI.suppress = Date.now(); return; }  // Klick nach dem Loslassen noch kurz unterdrücken
    if (!s.active) return;
    LI.suppress = Date.now();
    const limit = Math.min(110, s.row.offsetWidth * 0.3);
    s.row.classList.remove('swiping');
    const hx = s.row.dataset.hid && R.hist.get(s.row.dataset.hid);
    if (hx && s.dx < -limit) { liHistDelete(hx); return; }
    const it = R.item.get(s.row.dataset.lid);
    if (it && s.dx > limit) {
      liSetDone(it, !it.done);
      if (it.done) toast(`✓ ${it.name}`, { label: 'Rückgängig', fn: () => { liSetDone(it, false); liRefresh(); } });
      liRefresh();
    } else if (it && s.dx < -limit) {
      liDelete(it);
      liRefresh();
    } else {
      s.fg.style.transition = 'transform .15s';
      s.fg.style.transform = '';
      setTimeout(() => { s.fg.style.transition = ''; }, 160);
    }
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
})();

document.addEventListener('visibilitychange', () => {
  liWake();
  if (document.visibilityState === 'visible') Sync.run();
});
window.addEventListener('online', () => Sync.run());
setInterval(() => { if (document.visibilityState === 'visible') Sync.run(); }, 20000);
window.addEventListener('hashchange', liWake);

liLoad();
liHistBackfill();
liHistOfferClean();
liFavsPush(S.favs);  // lokale Favoriten dieses Geräts einbringen (nur online und mit Namen)
boot();
