'use strict';
// PGA: centrum wyjazdu – serwer bez zależności (http, fs, crypto).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3050;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'pga.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PASSWORD = process.env.PASSWORD || '';
const TITLE = process.env.TITLE || 'PGA: centrum wyjazdu';
const DAYS_RAW = process.env.DAYS || 'Piątek:rano,popołudnie,wieczór;Sobota:rano,popołudnie,wieczór;Niedziela:rano,popołudnie';
const CATS = ['atrakcje', 'jedzenie', 'pga', 'inne'];
const SCHEMA = 3;
const COOKIE = 'sesja';
const SESSION_DAYS = 90;

// ---------- konfiguracja ----------
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const keyOf = n => clean(n, 24).toLowerCase();

const DAYS = DAYS_RAW.split(';').map(chunk => {
  const [day, parts = ''] = chunk.split(':');
  const name = clean(day, 20);
  return { name, parts: parts.split(',').map(p => clean(p, 20)).filter(Boolean).map(p => ({ name: p, id: `${name}|${p}` })) };
}).filter(d => d.name && d.parts.length);
const SLOTS = new Set(DAYS.flatMap(d => d.parts.map(p => p.id)));
if (!SLOTS.size) { console.error('DAYS nie zawiera żadnego dnia z porami.'); process.exit(1); }

// ---------- stan ----------
// interest: { [ideaId]: { [klucz osoby]: 1|2|3 } }  3 = bardzo chcę, 2 = chętnie, 1 = mogę
// board:    { slots: { [slotId]: [ideaId] } }        jeden wspólny plan ekipy
// plans:    { [klucz]: { away: [slotId], updatedAt } }
// locations: { [klucz]: { lat, lng, acc, note, t } }  „Jestem tutaj”, ważne LOCATION_TTL
// expenses: [ { id, title, amount (grosze), payer, split: [klucz], settle?, byKey, at } ]  dzielone po równo
let state = { schema: SCHEMA, v: 1, people: {}, ideas: [], interest: {}, board: { slots: {} }, plans: {}, locations: {}, expenses: [], events: [] };
const LOCATION_TTL = 2 * 3600e3;

function migrate(s) {
  s.schema = s.schema || 1;
  if (s.schema < 2) {
    // Osobiste plansze → zainteresowanie „chętnie” + wspólny plan z polem, które wybrało najwięcej osób.
    s.interest = s.interest || {};
    s.board = s.board || { slots: {} };
    const votes = {};
    for (const [key, plan] of Object.entries(s.plans || {})) {
      for (const [slot, ids] of Object.entries(plan.slots || {})) for (const id of ids) {
        (s.interest[id] = s.interest[id] || {})[key] = 2;
        const v = (votes[id] = votes[id] || {});
        v[slot] = (v[slot] || 0) + 1;
      }
      delete plan.slots;
      plan.away = plan.away || [];
    }
    for (const [id, bySlot] of Object.entries(votes)) {
      const slot = Object.entries(bySlot).sort((a, b) => b[1] - a[1])[0][0];
      if (SLOTS.has(slot)) (s.board.slots[slot] = s.board.slots[slot] || []).push(id);
    }
    s.schema = 2;
  }
  if (s.schema < 3) {
    // Kategorie konwentowe → prostsze, wokół całego wyjazdu.
    const map = { program: 'pga', gry: 'pga', cosplay: 'pga', zakupy: 'atrakcje' };
    for (const i of s.ideas || []) i.cat = map[i.cat] || (CATS.includes(i.cat) ? i.cat : 'inne');
    s.schema = 3;
  }
  return s;
}

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return;
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const loaded = JSON.parse(raw);
  backup(raw);
  state = migrate({ ...state, ...loaded });
  if ((loaded.schema || 1) < SCHEMA) save();
}

function backup(raw) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(BACKUP_DIR, `pga-${stamp}.json`), raw);
    const old = fs.readdirSync(BACKUP_DIR).filter(f => /^pga-.*\.json$/.test(f)).sort().slice(0, -5);
    for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
  } catch (e) { console.error('Kopia zapasowa nieudana:', e.message); }
}

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DATA_FILE);
}

function log(who, type, extra = {}) {
  const e = { t: Date.now(), who, type, ...extra };
  const last = state.events[state.events.length - 1];
  // Kilka szybkich zmian oceny tego samego pomysłu (albo kolejne „Jestem tutaj”) to jedno zdarzenie.
  const same = last && last.type === type && last.who === who &&
    ((type === 'interest' && last.id === e.id && e.t - last.t < 60e3) || (type === 'locate' && e.t - last.t < 10 * 60e3));
  if (same) {
    state.events[state.events.length - 1] = e;
    return;
  }
  state.events.push(e);
}

function publicState() {
  return {
    v: state.v,
    config: { title: TITLE, days: DAYS, cats: CATS },
    people: Object.entries(state.people)
      .map(([key, p]) => ({ key, name: p.name, joinedAt: p.joinedAt }))
      .sort((a, b) => a.joinedAt - b.joinedAt),
    ideas: state.ideas,
    interest: state.interest,
    board: state.board,
    plans: state.plans,
    locations: Object.fromEntries(Object.entries(state.locations).filter(([, l]) => Date.now() - l.t < LOCATION_TTL)),
    expenses: state.expenses,
    events: state.events,
  };
}

// ---------- akcje ----------
class UserError extends Error {}
const fail = msg => { throw new UserError(msg); };

function person(body) {
  const name = clean(body.name, 24);
  if (!name) fail('Najpierw podaj imię.');
  const key = keyOf(name);
  if (!state.people[key]) {
    state.people[key] = { name, joinedAt: Date.now() };
    log(name, 'join');
  }
  return { key, name: state.people[key].name };
}
function planOf(key) {
  const p = state.plans[key] || (state.plans[key] = { away: [], updatedAt: 0 });
  p.updatedAt = Date.now();
  return p;
}
// „12,50”, „12.5”, „12 zł” → 1250 groszy
function grosze(v) {
  const s = String(v ?? '').replace(/\s|zł|pln/gi, '').replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) fail('Podaj kwotę, np. 120 albo 45,50.');
  const g = Math.round(Number(s) * 100);
  if (g <= 0) fail('Kwota musi być większa od zera.');
  return g;
}
function knownPerson(key, what) {
  key = String(key ?? '');
  if (!Object.hasOwn(state.people, key)) fail(`Nie ma takiej osoby (${what}).`);
  return key;
}
function ideaFields(body) {
  const title = clean(body.title, 60);
  if (!title) fail('Wpisz, co robimy.');
  let link = clean(body.link, 300);
  if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
  if (link) { try { new URL(link); } catch { fail('Ten link wygląda na niepoprawny.'); } }
  return { title, link, cat: CATS.includes(body.cat) ? body.cat : 'inne' };
}
function findIdea(id) {
  const idea = state.ideas.find(i => i.id === id);
  if (!idea) fail('Tego pomysłu już nie ma.');
  return idea;
}
function boardSlotOf(id) {
  for (const [s, ids] of Object.entries(state.board.slots)) if (ids.includes(id)) return s;
  return null;
}
function unplace(id) {
  for (const s of Object.keys(state.board.slots)) {
    state.board.slots[s] = state.board.slots[s].filter(x => x !== id);
    if (!state.board.slots[s].length) delete state.board.slots[s];
  }
}

const actions = {
  join(body) { person(body); },

  idea(body) {
    const me = person(body);
    const { title, link, cat } = ideaFields(body);
    const idea = { id: crypto.randomBytes(6).toString('base64url'), title, note: '', link, cat, by: me.name, byKey: me.key, at: Date.now() };
    state.ideas.push(idea);
    log(me.name, 'idea', { idea: title });
  },

  ideaEdit(body) {
    const me = person(body);
    const idea = findIdea(body.id);
    if (idea.byKey !== me.key) fail('Pomysł może edytować tylko osoba, która go dodaje.');
    const next = ideaFields(body);
    if (next.title === idea.title && next.link === idea.link && next.cat === idea.cat) return;
    const from = idea.title;
    Object.assign(idea, next);
    log(me.name, 'idea_edit', { idea: idea.title, ...(from !== idea.title ? { from } : {}) });
  },

  ideaDelete(body) {
    const me = person(body);
    const idea = findIdea(body.id);
    if (idea.byKey !== me.key) fail('Pomysł może usunąć tylko osoba, która go dodaje.');
    state.ideas = state.ideas.filter(i => i !== idea);
    delete state.interest[idea.id];
    unplace(idea.id);
    log(me.name, 'idea_del', { idea: idea.title });
  },

  interest(body) {
    const me = person(body);
    const idea = findIdea(body.id);
    const level = Number(body.level);
    if (![0, 1, 2, 3].includes(level)) fail('Niepoprawna ocena.');
    const map = state.interest[idea.id] || (state.interest[idea.id] = {});
    if ((map[me.key] || 0) === level) return;
    if (level) map[me.key] = level; else delete map[me.key];
    if (!Object.keys(map).length) delete state.interest[idea.id];
    log(me.name, 'interest', { id: idea.id, idea: idea.title, level });
  },

  // Wspólny plan: każdy może wstawiać, przenosić i zdejmować.
  place(body) {
    const me = person(body);
    const idea = findIdea(body.id);
    const to = body.slot == null ? null : String(body.slot);
    if (to !== null && !SLOTS.has(to)) fail('Nie ma takiego pola.');
    const from = boardSlotOf(idea.id);
    unplace(idea.id);
    if (to) {
      const list = state.board.slots[to] || (state.board.slots[to] = []);
      const i = Number.isInteger(body.index) && body.index >= 0 ? Math.min(body.index, list.length) : list.length;
      list.splice(i, 0, idea.id);
    }
    if (from === to) return;                       // sama zmiana kolejności w polu
    if (to) log(me.name, 'place', { idea: idea.title, ...(from ? { from } : {}), to });
    else log(me.name, 'unplace', { idea: idea.title, from });
  },

  // Współrzędne nie trafiają do historii, tylko sam fakt udostępnienia.
  locate(body) {
    const me = person(body);
    const lat = Number(body.lat), lng = Number(body.lng), acc = Number(body.acc);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail('Niepoprawna lokalizacja.');
    const round = x => Math.round(x * 1e5) / 1e5;
    state.locations[me.key] = {
      lat: round(lat), lng: round(lng),
      acc: Number.isFinite(acc) && acc > 0 ? Math.min(Math.round(acc), 100000) : 0,
      note: clean(body.note, 60), t: Date.now(),
    };
    for (const [k, l] of Object.entries(state.locations)) if (Date.now() - l.t >= LOCATION_TTL) delete state.locations[k];
    log(me.name, 'locate', state.locations[me.key].note ? { note: state.locations[me.key].note } : {});
  },

  locateClear(body) {
    const me = person(body);
    if (!state.locations[me.key]) return;
    delete state.locations[me.key];
    log(me.name, 'locate_off');
  },

  // Wydatek dzielony po równo między osoby z listy split. settle = zwrot długu (payer oddaje split[0]).
  expense(body) {
    const me = person(body);
    const amount = grosze(body.amount);
    const payer = knownPerson(body.payer, 'kto płaci');
    if (!Array.isArray(body.split) || !body.split.length) fail('Zaznacz, kto się składa.');
    const split = [...new Set(body.split.map(k => knownPerson(k, 'kto się składa')))];
    const settle = !!body.settle;
    if (settle && (split.length !== 1 || split[0] === payer)) fail('Zwrot musi iść od jednej osoby do innej.');
    const title = settle ? 'Zwrot' : clean(body.title, 60);
    if (!title) fail('Wpisz, za co.');
    const e = { id: crypto.randomBytes(6).toString('base64url'), title, amount, payer, split, byKey: me.key, at: Date.now(), ...(settle ? { settle } : {}) };
    state.expenses.push(e);
    const pay = state.people[payer].name;
    log(me.name, settle ? 'settle' : 'expense', settle
      ? { amount, payer: pay, to: state.people[split[0]].name }
      : { idea: title, amount, payer: pay, n: split.length });
  },

  expenseDelete(body) {
    const me = person(body);
    const e = state.expenses.find(x => x.id === body.id);
    if (!e) fail('Tego wydatku już nie ma.');
    if (e.byKey !== me.key) fail('Wydatek może usunąć tylko osoba, która go dodaje.');
    state.expenses = state.expenses.filter(x => x !== e);
    log(me.name, 'expense_del', { idea: e.title, amount: e.amount });
  },

  away(body) {
    const me = person(body);
    const slot = String(body.slot ?? '');
    if (!SLOTS.has(slot)) fail('Nie ma takiego pola.');
    const plan = planOf(me.key);
    const isAway = plan.away.includes(slot);
    if (!!body.away === isAway) return;
    plan.away = body.away ? [...plan.away, slot] : plan.away.filter(s => s !== slot);
    log(me.name, body.away ? 'away' : 'back', { to: slot });
  },
};

// ---------- hasło i sesja ----------
const secret = crypto.createHash('sha256').update('pga-sesja\0' + PASSWORD).digest();
const sign = id => crypto.createHmac('sha256', secret).update(id).digest('base64url');
function newToken() {
  const id = crypto.randomBytes(16).toString('base64url') + '.' + Date.now().toString(36);
  return id + '.' + sign(id);
}
function validToken(tok) {
  if (!tok) return false;
  const i = tok.lastIndexOf('.');
  if (i < 0) return false;
  const id = tok.slice(0, i), sig = Buffer.from(tok.slice(i + 1));
  const good = Buffer.from(sign(id));
  if (sig.length !== good.length || !crypto.timingSafeEqual(sig, good)) return false;
  const born = parseInt(id.split('.')[1], 36);
  return Date.now() - born < SESSION_DAYS * 864e5;
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const authed = req => !PASSWORD || validToken(cookies(req)[COOKIE]);
function passwordOk(given) {
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
function setCookie(req, res, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

// Limit błędnych prób: 8 na IP na 10 minut.
const attempts = new Map();
const LIMIT = 8, WINDOW = 10 * 60e3;
function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  const local = /^(::1|127\.|::ffff:127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::ffff:(10|172|192)\.)/.test(peer);
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return local && fwd.length ? fwd[fwd.length - 1] : peer;   // Caddy dopisuje prawdziwy adres na końcu
}
function limited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter(t => now - t < WINDOW);
  attempts.set(ip, list);
  return list.length >= LIMIT;
}
setInterval(() => {
  for (const [ip, list] of attempts) if (!list.some(t => Date.now() - t < WINDOW)) attempts.delete(ip);
}, WINDOW).unref();

// ---------- HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 16 * 1024) { reject(new UserError('Za dużo danych.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(b && typeof b === 'object' && !Array.isArray(b) ? b : {});
      } catch { reject(new UserError('Niepoprawne dane.')); }
    });
    req.on('error', reject);
  });
}

function withVersions(html) {
  return html.replace(/(href|src)="(app\.js|style\.css)"/g, (m, attr, name) => {
    try {
      const v = crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC_DIR, name))).digest('hex').slice(0, 10);
      return `${attr}="${name}?v=${v}"`;
    } catch { return m; }
  });
}
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Nie ma.');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Nie ma.');
    // Adresy app.js i style.css dostają skrót treści – po zmianie pliku przeglądarka musi pobrać nowy.
    if (rel === 'index.html') data = withVersions(data.toString('utf8'));
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': CSP,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/healthz') return send(res, 200, 'ok');
  if (!p.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Tylko GET.');
    return serveStatic(req, res, p);
  }

  if (p === '/api/login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (limited(ip)) return send(res, 429, { error: 'Za dużo prób. Spróbuj za kilka minut.' });
    const body = await readBody(req);
    if (PASSWORD && !passwordOk(body.password)) {
      attempts.get(ip).push(Date.now());
      return send(res, 401, { error: 'Złe hasło.' });
    }
    setCookie(req, res, newToken(), SESSION_DAYS * 86400);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/logout' && req.method === 'POST') {
    setCookie(req, res, '', 0);
    return send(res, 200, { ok: true });
  }

  if (!authed(req)) return send(res, 401, { error: 'Podaj hasło ekipy.' });

  if (p === '/api/state' && req.method === 'GET') {
    if (url.searchParams.get('v') === String(state.v)) return send(res, 200, { unchanged: true, v: state.v });
    return send(res, 200, publicState());
  }
  if (p === '/api/export' && req.method === 'GET') {
    const day = new Date().toISOString().slice(0, 10);
    return send(res, 200, state, { 'Content-Disposition': `attachment; filename="pga-${day}.json"` });
  }

  const name = p.slice(5);
  if (req.method === 'POST' && Object.hasOwn(actions, name)) {
    const body = await readBody(req);
    const before = JSON.stringify(state);
    try {
      actions[name](body);
    } catch (e) {
      state = JSON.parse(before);                 // akcja nie zostawia połowicznych zmian
      throw e;
    }
    if (JSON.stringify(state) !== before) { state.v++; save(); }
    return send(res, 200, publicState());
  }
  send(res, 404, { error: 'Nie ma takiej akcji.' });
}

try {
  load();
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch (e) {
  console.error(`Nie mogę czytać lub zapisywać danych w ${DATA_DIR}: ${e.message}`);
  if (e.code === 'EACCES') console.error(`Katalog musi należeć do użytkownika procesu (uid ${process.getuid?.()}). Na hoście: sudo chown -R 1000:1000 data`);
  process.exit(1);
}
http.createServer((req, res) => {
  handle(req, res).catch(e => {
    if (e instanceof UserError) return send(res, 400, { error: e.message });
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Błąd serwera.' });
  });
}).listen(PORT, () => {
  console.log(`PGA: http://localhost:${PORT}  (${PASSWORD ? 'z hasłem' : 'BEZ HASŁA'}, ${SLOTS.size} pól, dane: ${DATA_FILE})`);
});
