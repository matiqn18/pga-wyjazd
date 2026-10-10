'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyOf = n => String(n || '').replace(/\s+/g, ' ').trim().toLowerCase();

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* tryb prywatny */ } },
};

let S = null;                       // stan z serwera
const VIEWS = ['pomysly', 'chetni', 'plan', 'moj', 'wydatki'];
const SORTS = ['todo', 'hot', 'new'];
let me = store.get('pga-imie') || '';
let view = VIEWS.includes(store.get('pga-widok')) ? store.get('pga-widok') : 'pomysly';
let sort = SORTS.includes(store.get('pga-sort')) ? store.get('pga-sort') : 'todo';
let filter = store.get('pga-filter') || '';     // '' = wszystko
let selected = null;                // id kafelka wybranego stuknięciem
let drag = null;
let pendingRender = false;
let suppressClickUntil = 0;

const CAT_NAMES = { atrakcje: 'Atrakcje', jedzenie: 'Jedzenie', pga: 'Na PGA', inne: 'Inne' };
const SHAPES = {
  atrakcje: '<polygon points="12,2 15,9 22,9.5 16.5,14.5 18.5,22 12,17.8 5.5,22 7.5,14.5 2,9.5 9,9"/>',
  pga: '<circle cx="12" cy="12" r="9"/>',
  jedzenie: '<path d="M3 16a9 9 0 0 1 18 0z"/>',
  inne: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
};
const shape = cat => `<svg viewBox="0 0 24 24" aria-hidden="true">${SHAPES[cat] || SHAPES.inne}</svg>`;
const PART_ORDER = ['rano', 'południe', 'popołudnie', 'wieczór', 'noc'];
const tintOf = part => {
  const p = part.toLowerCase();
  if (p.includes('ran') || p.includes('śniad')) return 't-rano';
  if (p.includes('połud') || p.includes('dzień')) return 't-dzien';
  if (p.includes('wiecz')) return 't-wieczor';
  if (p.includes('noc')) return 't-noc';
  return '';
};
const AV_COLORS = ['#ff9a4d', '#2cc5b3', '#ff7aa2', '#b3a3ff', '#6cbcff', '#ffd24d'];
// level: 1–3 przy chętnych; „mogę” jest przygaszone.
function avatar(name, big, level) {
  const k = keyOf(name);
  let h = 0; for (const ch of k) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const initials = name.trim().split(/\s+/).map(w => [...w][0]).slice(0, 2).join('').toUpperCase();
  return `<span class="av${big ? ' big' : ''}${level ? ' l' + level : ''}" style="--avc:${AV_COLORS[h % AV_COLORS.length]}" title="${esc(name)}">${esc(initials)}</span>`;
}
function osoby(n) {
  const d = n % 10, s = n % 100;
  if (n === 1) return '1 osoba';
  if (d >= 2 && d <= 4 && !(s >= 12 && s <= 14)) return `${n} osoby`;
  return `${n} osób`;
}
function pomysly(n) {
  const d = n % 10, s = n % 100;
  if (n === 1) return '1 pomysł';
  if (d >= 2 && d <= 4 && !(s >= 12 && s <= 14)) return `${n} pomysły`;
  return `${n} pomysłów`;
}
const slotLabel = id => id ? id.replace('|', ', ') : '';

// ---------- serwer ----------
function toast(msg) {
  const t = $('#toast'); t.textContent = msg;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.textContent = ''; }, 4000);
}
function accept(next) {
  if (!next || next.unchanged) return;
  if (S && next.v < S.v) return;
  S = next; render();
}
async function api(action, body) {
  try {
    const r = await fetch('/api/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: me, ...body }),
    });
    const data = await r.json();
    if (r.status === 401) { showLogin(); return false; }
    if (!r.ok) { toast(data.error || 'Nie udało się zapisać.'); refresh(true); return false; }
    accept(data);
    return true;
  } catch {
    toast('Brak połączenia z serwerem. Zmiana nie została zapisana.');
    return false;
  }
}
async function refresh(force) {
  try {
    const r = await fetch('/api/state' + (S && !force ? '?v=' + S.v : ''));
    if (r.status === 401) return showLogin();
    const data = await r.json();
    if (force && !data.unchanged) { S = data; render(); } else accept(data);
  } catch { /* spróbujemy za chwilę */ }
}
setInterval(() => { if (!document.hidden && !drag && !$('#login').open) refresh(); }, 2500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

// ---------- pomocnicze widoku ----------
const LEVELS = { 3: 'Bardzo chcę', 2: 'Chętnie', 1: 'Mogę' };
const LEVEL_GROUPS = { 3: 'Bardzo chcą', 2: 'Chętnie', 1: 'Mogą' };
const pips = n => `<span class="pips" aria-hidden="true">${'<i></i>'.repeat(n)}</span>`;
const myKey = () => keyOf(me);
const levelOf = (id, key) => (S.interest[id] || {})[key] || 0;
const nameOf = key => (S.people.find(p => p.key === key) || {}).name || key;
// Chętni do pomysłu, od najbardziej zainteresowanych.
function fansOf(id) {
  return Object.entries(S.interest[id] || {})
    .map(([key, level]) => ({ key, level, name: nameOf(key) }))
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name, 'pl'));
}
const scoreOf = id => fansOf(id).reduce((s, f) => s + f.level, 0);
const byScore = (a, b) => scoreOf(b.id) - scoreOf(a.id) || fansOf(b.id).length - fansOf(a.id).length || b.at - a.at;
function boardSlotOf(id) {
  for (const [s, ids] of Object.entries(S.board.slots)) if (ids.includes(id)) return s;
  return null;
}
const awayKeys = slot => Object.entries(S.plans).filter(([, p]) => (p.away || []).includes(slot)).map(([k]) => k);
const fansHTML = fans => fans.map(f => avatar(f.name, false, f.level)).join('');

function rows() {
  const seen = [];
  for (const d of S.config.days) for (const p of d.parts) if (!seen.includes(p.name)) seen.push(p.name);
  const rank = n => { const i = PART_ORDER.indexOf(n.toLowerCase()); return i < 0 ? 99 : i; };
  return seen.map((n, i) => [n, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
}
// Wspólny szkielet planszy; cell(slot, day) zwraca zawartość pola.
function boardHTML(cell, droppable) {
  const days = S.config.days, rs = rows();
  let h = `<div class="board" style="--days:${days.length}">`;
  rs.forEach((r, ri) => { h += `<div class="part-h" style="grid-column:1;grid-row:${ri + 2}">${esc(r)}</div>`; });
  days.forEach((d, di) => {
    h += `<h3 class="day-h" style="grid-column:${di + 2};grid-row:1">${esc(d.name)}</h3>`;
    for (const p of d.parts) {
      const c = cell(p, d);
      h += `<div class="slot ${tintOf(p.name)} ${c.cls || ''}" ${droppable ? `data-drop="${esc(p.id)}"` : ''}
        style="grid-column:${di + 2};grid-row:${rs.indexOf(p.name) + 2}">
        <div class="slot-label">${esc(p.name)}</div>${c.html}</div>`;
    }
  });
  return h + '</div>';
}
// Kafelek wspólnego planu: kto chce i czy ktoś z chętnych nie może w tym polu.
function tileHTML(idea, opts = {}) {
  const fans = fansOf(idea.id);
  const away = opts.slot ? fans.filter(f => awayKeys(opts.slot).includes(f.key)).map(f => f.name) : [];
  return `<div class="tile cat-${esc(idea.cat)}" data-id="${esc(idea.id)}" role="button" tabindex="0"
    aria-pressed="${selected === idea.id}" aria-label="${esc(idea.title)}, ${esc(CAT_NAMES[idea.cat] || '')}, ${osoby(fans.length)} chętnych">
    ${shape(idea.cat)}<span class="tile-title">${esc(idea.title)}</span>
    ${idea.note ? `<span class="tile-meta">${esc(idea.note)}</span>` : ''}
    <span class="tile-who">${fans.length ? fansHTML(fans) : '<span class="tile-meta">nikt jeszcze nie chce</span>'}</span>
    ${away.length ? `<span class="tile-warn">Nie może: ${esc(away.join(', '))}</span>` : ''}
  </div>`;
}
function rateHTML(id) {
  const mine = levelOf(id, myKey());
  return `<div class="rate" role="group" aria-label="Ile chcesz?">${[3, 2, 1].map(l =>
    `<button type="button" data-rate="${esc(id)}" data-level="${l}" aria-pressed="${mine === l}">${pips(l)}${LEVELS[l]}</button>`).join('')}</div>`;
}
function groupsHTML(fans) {
  if (!fans.length) return '<span class="muted">Nikt jeszcze nie ocenia.</span>';
  return [3, 2, 1].map(l => {
    const g = fans.filter(f => f.level === l);
    return g.length ? `<span class="grp">${pips(l)}<span class="sr">${LEVEL_GROUPS[l]}:</span>${g.map(f => avatar(f.name)).join('')}</span>` : '';
  }).join('');
}

// ---------- widoki ----------
function renderIdeas() {
  const k = myKey();
  const todo = S.ideas.filter(i => !levelOf(i.id, k));
  $('#ideas-summary').textContent = !S.ideas.length
    ? 'Nikt jeszcze nic nie zaproponował. Dodaj pierwszy pomysł.'
    : todo.length
      ? `Oceń, co cię interesuje. Do ocenienia: ${pomysly(todo.length)}. Stuknij jeszcze raz, żeby cofnąć ocenę.`
      : 'Wszystko ocenione. Możesz zmienić zdanie w każdej chwili.';
  for (const b of document.querySelectorAll('[data-sort]')) b.setAttribute('aria-pressed', b.dataset.sort === sort);

  if (filter && !S.config.cats.includes(filter)) filter = '';
  const count = c => S.ideas.filter(i => i.cat === c).length;
  $('#filters').innerHTML = S.ideas.length ? [['', 'Wszystko', S.ideas.length], ...S.config.cats.map(c => [c, CAT_NAMES[c] || c, count(c)])]
    .map(([c, label, n]) => `<button type="button" class="${c ? 'cat-' + esc(c) : 'all'}" data-filter="${esc(c)}" aria-pressed="${filter === c}">
      ${c ? shape(c) : ''}${esc(label)} <span class="n">${n}</span></button>`).join('') : '';

  let list = [...S.ideas].reverse().filter(i => !filter || i.cat === filter);
  if (sort === 'hot') list.sort(byScore);
  else if (sort === 'todo') list = [...list.filter(i => !levelOf(i.id, k)), ...list.filter(i => levelOf(i.id, k))];

  $('#ideas').innerHTML = list.map(i => {
    let host = '';
    try { host = new URL(i.link).hostname.replace(/^www\./, ''); } catch { /* brak linku */ }
    const slot = boardSlotOf(i.id);
    return `<article class="idea cat-${esc(i.cat)}">
      <div class="idea-head">${shape(i.cat)}<div><h3>${esc(i.title)}</h3><small>${esc(CAT_NAMES[i.cat] || 'Inne')}</small></div></div>
      <div class="idea-body">
        ${i.note ? `<p>${esc(i.note)}</p>` : ''}
        ${host ? `<p><a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">${esc(host)}</a></p>` : ''}
        ${rateHTML(i.id)}
        <div class="idea-who">${groupsHTML(fansOf(i.id))}</div>
        <div class="idea-actions">
          <span class="muted">${slot ? `W planie: <strong>${esc(slotLabel(slot))}</strong>` : `Dodaje: ${esc(i.by)}`}</span>
          ${i.byKey === k ? `<span class="own-actions"><button type="button" class="mini" data-edit="${esc(i.id)}">Edytuj</button><button type="button" class="mini" data-del="${esc(i.id)}">Usuń</button></span>` : ''}
        </div>
      </div></article>`;
  }).join('') || (filter ? `<p class="muted">Nie ma jeszcze pomysłów w kategorii „${esc(CAT_NAMES[filter] || filter)}”. Dodaj pierwszy.</p>` : '');
}

function renderChetni() {
  const total = S.ideas.length;
  const behind = S.people
    .map(p => ({ name: p.name, left: S.ideas.filter(i => !levelOf(i.id, p.key)).length }))
    .filter(p => p.left)
    .sort((a, b) => b.left - a.left || a.name.localeCompare(b.name, 'pl'));
  $('#rank-summary').innerHTML = !total
    ? '<p class="hint">Nie ma jeszcze pomysłów do oceniania.</p>'
    : behind.length
      ? `<p class="hint">Jeszcze do ocenienia (liczba pomysłów):</p>
        <ul class="todo-people">${behind.map(p => `<li>${avatar(p.name)}<span>${esc(p.name)}</span>
          <span class="n" aria-label="${pomysly(p.left)}">${p.left}</span></li>`).join('')}</ul>`
      : '<p class="hint">Wszyscy ocenili wszystkie pomysły.</p>';

  $('#rank').innerHTML = [...S.ideas].sort(byScore).map((i, n) => {
    const fans = fansOf(i.id), slot = boardSlotOf(i.id);
    return `<article class="rank-row cat-${esc(i.cat)}">
      <span class="rank-n">${n + 1}</span>${shape(i.cat)}
      <div class="rank-main"><strong>${esc(i.title)}</strong>
        <small>${fans.length ? osoby(fans.length) : 'nikt'}${slot ? ' · w planie: ' + esc(slotLabel(slot)) : ' · jeszcze nie w planie'}</small>
        <div class="idea-who">${groupsHTML(fans)}</div></div>
      <span class="rank-score" title="Suma ocen">${scoreOf(i.id)}</span>
    </article>`;
  }).join('');

  const byId = Object.fromEntries(S.ideas.map(i => [i.id, i]));
  $('#people').innerHTML = S.people.map(p => {
    const mine = S.ideas.filter(i => levelOf(i.id, p.key));
    const away = (S.plans[p.key] || {}).away || [];
    const groups = [3, 2, 1].map(l => {
      const g = mine.filter(i => levelOf(i.id, p.key) === l);
      return g.length ? `<h4>${pips(l)}${LEVELS[l]}</h4><ul>${g.map(i => `<li class="cat-${esc(i.cat)}"><span class="dot"></span>${esc(byId[i.id].title)}</li>`).join('')}</ul>` : '';
    }).join('');
    return `<article class="person">
      <div class="person-head">${avatar(p.name, true)}<div><strong>${esc(p.name)}</strong>
        <small>${total ? `oceniono: ${total - S.ideas.filter(i => !levelOf(i.id, p.key)).length} z ${total}` : ''}</small></div></div>
      ${groups || '<p class="muted">Jeszcze nic nie wybiera.</p>'}
      ${away.length ? `<h4>Nie może</h4><p>${esc(away.map(slotLabel).join('; '))}</p>` : ''}
    </article>`;
  }).join('') || '<p class="muted">Nikt jeszcze nie dołączył.</p>';

  const fmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const q = s => `„${esc(s)}”`;
  const text = e => ({
    join: 'dołącza do planowania',
    idea: `dodaje pomysł ${q(e.idea)}`,
    idea_del: `usuwa pomysł ${q(e.idea)}`,
    idea_edit: e.from ? `zmienia nazwę pomysłu ${q(e.from)} na ${q(e.idea)}` : `edytuje pomysł ${q(e.idea)}`,
    interest: ({ 3: `bardzo chce: ${q(e.idea)}`, 2: `chętnie idzie na ${q(e.idea)}`, 1: `może iść na ${q(e.idea)}`, 0: `cofa ocenę ${q(e.idea)}` })[e.level],
    place: e.from ? `przenosi ${q(e.idea)} z pola ${esc(slotLabel(e.from))} na pole ${esc(slotLabel(e.to))}`
                  : `wstawia ${q(e.idea)} do planu: ${esc(slotLabel(e.to))}`,
    unplace: `zdejmuje ${q(e.idea)} z planu (${esc(slotLabel(e.from))})`,
    locate: `udostępnia lokalizację${e.note ? ` (${esc(e.note)})` : ''}`,
    locate_off: 'przestaje udostępniać lokalizację',
    expense: `dodaje wydatek ${q(e.idea)}: ${esc(zl(e.amount))}, płaci ${esc(e.payer)}, dzielone na ${esc(osoby(e.n))}`,
    expense_del: `usuwa wydatek ${q(e.idea)} (${esc(zl(e.amount))})`,
    settle: `zapisuje zwrot: ${esc(e.payer)} oddaje ${esc(e.to)} ${esc(zl(e.amount))}`,
    away: `zaznacza, że nie może: ${esc(slotLabel(e.to))}`,
    back: `jednak może: ${esc(slotLabel(e.to))}`,
  }[e.type] || esc(e.type));
  $('#events-count').textContent = S.events.length ? `(${S.events.length})` : '';
  $('#events').innerHTML = [...S.events].reverse().map(e =>
    `<li><time datetime="${new Date(e.t).toISOString()}">${esc(fmt.format(e.t))}</time><span><strong>${esc(e.who)}</strong> ${text(e)}</span></li>`
  ).join('') || '<li class="muted">Jeszcze nic się nie wydarzyło.</li>';
}

function renderPlan() {
  const byId = Object.fromEntries(S.ideas.map(i => [i.id, i]));
  const placed = new Set(Object.values(S.board.slots).flat());
  const free = S.ideas.filter(i => !placed.has(i.id)).sort(byScore);
  $('#pool').innerHTML = free.length
    ? free.map(i => tileHTML(i)).join('')
    : `<p class="pool-empty">${S.ideas.length ? 'Wszystkie pomysły są już w planie.' : 'Nie ma jeszcze pomysłów. Dodaj pierwszy w zakładce Pomysły.'}</p>`;
  $('#plan-summary').textContent = 'Ten plan jest wspólny: każdy może przestawiać kafelki, a historia zapisuje, kto co zmienia. ' +
    'Pod kafelkiem widać chętnych; ostrzeżenie oznacza, że ktoś chętny w tym czasie nie może.';

  $('#board').innerHTML = boardHTML(p => {
    const tiles = (S.board.slots[p.id] || []).map(id => byId[id]).filter(Boolean).map(i => tileHTML(i, { slot: p.id })).join('');
    const warned = new Set((S.board.slots[p.id] || []).flatMap(id => Object.keys(S.interest[id] || {})));
    const away = awayKeys(p.id).filter(k => !warned.has(k)).map(nameOf);
    return {
      html: `${tiles}<div class="slot-foot">
        ${away.length ? `<span class="away-line">Nie może: ${esc(away.join(', '))}</span>` : ''}
        ${selected ? `<button type="button" class="mini place" data-place="${esc(p.id)}">Wstaw tutaj</button>` : ''}
      </div>`,
    };
  }, true);
}

// ---------- gdzie kto jest ----------
function metres(a, b) {
  const R = 6371e3, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const distText = m => m < 1000 ? `ok. ${Math.max(10, Math.round(m / 10) * 10)} m od ciebie` : `${(m / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} km od ciebie`;
function agoText(t) {
  const min = Math.floor((Date.now() - t) / 60e3);
  if (min < 1) return 'przed chwilą';
  if (min < 60) return `${min} min temu`;
  return `${Math.floor(min / 60)} h ${min % 60} min temu`;
}
function renderWhere() {
  const k = myKey();
  const fresh = Object.entries(S.locations || {}).filter(([, l]) => Date.now() - l.t < 2 * 3600e3);
  const mine = (S.locations || {})[k];
  $('#where-list').innerHTML = fresh.length
    ? `<ul class="where-list">${fresh.sort((a, b) => b[1].t - a[1].t).map(([key, l]) => {
        const map = `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`;
        const meta = [agoText(l.t), key !== k && mine ? distText(metres(mine, l)) : '', l.acc > 50 ? `dokładność ±${l.acc} m` : ''].filter(Boolean).join(' · ');
        return `<li>${avatar(nameOf(key), true)}<div><strong>${esc(nameOf(key))}${key === k ? ' (ty)' : ''}</strong>
          ${l.note ? `<span class="where-note">${esc(l.note)}</span>` : ''}<small>${esc(meta)}</small></div>
          <span class="where-act">${key === k ? '<button type="button" class="mini" data-where-off>Usuń</button>' : ''}
          <a class="mini go" href="${esc(map)}" target="_blank" rel="noopener noreferrer">Mapa</a></span></li>`;
      }).join('')}</ul>`
    : '<p class="muted where-empty">Nikt teraz nie udostępnia lokalizacji.</p>';
}
function locateMe() {
  if (!me) return askName();
  if (!window.isSecureContext || !navigator.geolocation) return toast('Lokalizacja działa tylko na stronie z https.');
  const btn = $('#where-form [type=submit]');
  btn.disabled = true; btn.textContent = 'Szukam…';
  const done = () => { btn.disabled = false; btn.textContent = 'Jestem tutaj'; };
  navigator.geolocation.getCurrentPosition(async pos => {
    const ok = await api('locate', { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, note: $('#where-note').value });
    done();
    if (ok) { $('#where-note').value = ''; toast('Lokalizacja wysłana. Zniknie sama po 2 godzinach.'); }
  }, err => {
    done();
    toast(err.code === 1 ? 'Brak zgody na lokalizację. Włącz ją w ustawieniach przeglądarki dla tej strony.' : 'Nie udało się ustalić lokalizacji. Spróbuj jeszcze raz.');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}
$('#where-form').addEventListener('submit', e => { e.preventDefault(); locateMe(); });
// „5 min temu” ma się zmieniać, nawet gdy stan na serwerze stoi.
setInterval(() => { if (view === 'moj' && !document.hidden) render(); }, 30e3);

function renderMine() {
  renderWhere();
  const k = myKey();
  const byId = Object.fromEntries(S.ideas.map(i => [i.id, i]));
  const plan = S.plans[k] || { away: [] };
  const wanted = S.ideas.filter(i => levelOf(i.id, k));
  const inPlan = wanted.filter(i => boardSlotOf(i.id));
  const notYet = wanted.filter(i => !boardSlotOf(i.id)).sort((a, b) => levelOf(b.id, k) - levelOf(a.id, k));

  $('#mine-summary').textContent = !wanted.length
    ? 'Najpierw oceń pomysły w zakładce Pomysły. Tu zobaczysz, które z nich są we wspólnym planie i kiedy.'
    : `Punkty we wspólnym planie, które cię interesują: ${inPlan.length}. Zaznacz „Nie mogę” tam, gdzie cię nie będzie.`;
  $('#mine-wants').innerHTML = notYet.length
    ? `<div class="wants"><h3>Chcesz, a nie ma tego jeszcze w planie</h3>
        <ul>${notYet.map(i => `<li class="cat-${esc(i.cat)}">${pips(levelOf(i.id, k))}${esc(i.title)}</li>`).join('')}</ul>
        <button type="button" class="btn-line" data-view="plan">Ułóż we wspólnym planie</button></div>`
    : '';

  $('#mine-board').innerHTML = boardHTML(p => {
    const away = (plan.away || []).includes(p.id);
    const ids = (S.board.slots[p.id] || []).filter(id => byId[id]);
    const mine = ids.filter(id => levelOf(id, k)).map(id => byId[id]);
    const others = ids.filter(id => !levelOf(id, k)).map(id => byId[id]);
    const html = mine.map(i => {
      const fans = fansOf(i.id).filter(f => f.key !== k);
      return `<div class="pick win cat-${esc(i.cat)}">${shape(i.cat)}<span class="pick-title">${esc(i.title)}</span>
        ${pips(levelOf(i.id, k))}
        <span class="pick-who">${fans.length ? `<span class="muted">z:</span> ${fansHTML(fans)}` : '<span class="muted">tylko ty</span>'}</span></div>`;
    }).join('');
    return {
      cls: away ? 'is-away' : '',
      html: `${html || (others.length ? '' : '<p class="slot-none">Tu jeszcze pusto.</p>')}
        ${others.length ? `<p class="away-line">Reszta ekipy: ${esc(others.map(i => i.title).join(', '))}</p>` : ''}
        <div class="slot-foot">
          <button type="button" class="mini" data-away="${esc(p.id)}" aria-pressed="${away}">${away ? 'Nie ma mnie' : 'Nie mogę'}</button>
        </div>`,
    };
  }, false);
}

function render() {
  if (!S) return;
  if (drag && drag.started) { pendingRender = true; return; }
  document.title = S.config.title;
  $('#title').textContent = S.config.title;
  $('#me-chip').innerHTML = me ? `${avatar(me)}<span>${esc(me)}</span>` : 'Podaj imię';
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-pressed', b.dataset.view === view);
  for (const v of VIEWS) $('#view-' + v).hidden = v !== view;
  if (selected && !S.ideas.some(i => i.id === selected)) selected = null;
  if (view === 'pomysly') renderIdeas();
  else if (view === 'chetni') renderChetni();
  else if (view === 'plan') renderPlan();
  else if (view === 'moj') renderMine();
  else renderExpenses();
}

// ---------- akcje ----------
function place(id, slot, index) {
  if (!me) return askName();
  for (const s of Object.keys(S.board.slots)) S.board.slots[s] = S.board.slots[s].filter(x => x !== id);
  if (slot) {
    const list = S.board.slots[slot] || (S.board.slots[slot] = []);
    list.splice(index == null ? list.length : Math.min(index, list.length), 0, id);
  }
  selected = null;
  render();                                   // od razu, serwer potwierdzi
  api('place', { id, slot: slot || null, index: index == null ? undefined : index });
}
function rate(id, level) {
  if (!me) return askName();
  const k = myKey();
  const next = levelOf(id, k) === level ? 0 : level;   // drugie stuknięcie cofa ocenę
  const map = S.interest[id] || (S.interest[id] = {});
  if (next) map[k] = next; else delete map[k];
  render();
  api('interest', { id, level: next });
}

document.addEventListener('click', e => {
  const t = e.target;
  const tab = t.closest('[data-view]');
  if (tab) { view = tab.dataset.view; store.set('pga-widok', view); selected = null; render(); return window.scrollTo(0, 0); }
  const fi = t.closest('[data-filter]');
  if (fi) {
    filter = fi.dataset.filter; store.set('pga-filter', filter);
    const radio = filter && document.querySelector(`#cats input[value="${CSS.escape(filter)}"]`);
    if (radio) radio.checked = true;            // nowy pomysł od razu w oglądanej kategorii
    return render();
  }
  if (t.closest('[data-where-off]')) return api('locateClear', {});
  const xd = t.closest('[data-exp-del]');
  if (xd) {
    const x = S.expenses.find(e => e.id === xd.dataset.expDel);
    if (x && confirm(`Usunąć wydatek „${x.title}” (${zl(x.amount)})?`)) api('expenseDelete', { id: x.id });
    return;
  }
  const st = t.closest('[data-settle]');
  if (st) {
    const [from, to, amount] = st.dataset.settle.split('|');
    if (confirm(`Zapisać, że ${nameOf(from)} oddaje ${nameOf(to)} ${zl(+amount)}?`))
      api('expense', { payer: from, split: [to], amount: (+amount / 100).toFixed(2), settle: true });
    return;
  }
  const so = t.closest('[data-sort]');
  if (so) { sort = so.dataset.sort; store.set('pga-sort', sort); return render(); }
  const r = t.closest('[data-rate]');
  if (r) return rate(r.dataset.rate, Number(r.dataset.level));
  if (t.closest('#me-chip')) return askName();
  const ed = t.closest('[data-edit]');
  if (ed) return openEdit(ed.dataset.edit);
  const del = t.closest('[data-del]');
  if (del) {
    const idea = S.ideas.find(i => i.id === del.dataset.del);
    if (idea && confirm(`Usunąć pomysł „${idea.title}”? Zniknie też z oceny i ze wspólnego planu.`)) api('ideaDelete', { id: idea.id });
    return;
  }
  const aw = t.closest('[data-away]');
  if (aw) { if (!me) return askName(); return api('away', { slot: aw.dataset.away, away: aw.getAttribute('aria-pressed') !== 'true' }); }
  const pl = t.closest('[data-place]');
  if (pl && selected) return place(selected, pl.dataset.place);
  if (performance.now() < suppressClickUntil) return;
  const dropEl = t.closest('[data-drop]');
  if (dropEl && selected && !t.closest('.tile')) place(selected, dropEl.dataset.drop === 'pool' ? null : dropEl.dataset.drop);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && selected) { selected = null; render(); return; }
  const tile = e.target.closest && e.target.closest('#view-plan .tile');
  if (tile && e.target === tile && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    const id = tile.dataset.id;
    selected = selected === id ? null : id;
    render();
    const again = document.querySelector(`#view-plan .tile[data-id="${CSS.escape(id)}"]`);
    if (again) again.focus();
  }
});

// ---------- wspólne wydatki ----------
const ZL = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const zl = g => ZL.format(g / 100);
// Podział po równo co do grosza; reszta po groszu dla pierwszych osób z listy.
function sharesOf(x) {
  const n = x.split.length, base = Math.floor(x.amount / n), rest = x.amount - base * n;
  return Object.fromEntries(x.split.map((k, i) => [k, base + (i < rest ? 1 : 0)]));
}
function balances() {
  const bal = Object.fromEntries(S.people.map(p => [p.key, 0]));
  for (const x of S.expenses) {
    bal[x.payer] = (bal[x.payer] || 0) + x.amount;
    for (const [k, s] of Object.entries(sharesOf(x))) bal[k] = (bal[k] || 0) - s;
  }
  return bal;
}
// Najmniej przelewów: największy dłużnik oddaje największemu wierzycielowi.
function transfers(bal) {
  const debt = Object.entries(bal).filter(([, v]) => v < 0).map(([k, v]) => [k, -v]).sort((a, b) => b[1] - a[1]);
  const cred = Object.entries(bal).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const m = Math.min(debt[i][1], cred[j][1]);
    out.push({ from: debt[i][0], to: cred[j][0], amount: m });
    debt[i][1] -= m; cred[j][1] -= m;
    if (!debt[i][1]) i++;
    if (!cred[j][1]) j++;
  }
  return out;
}

// Pola wyboru osób przebudowują się tylko, gdy zmienia się lista osób – nie kasują zaznaczeń.
let pickersFor = '';
function syncExpensePickers() {
  const sig = S.people.map(p => p.key + ':' + p.name).join('|');
  if (sig === pickersFor) return;
  const sel = $('#exp-payer');
  const prevPayer = sel.value || myKey();
  const prevChecked = pickersFor ? new Set([...document.querySelectorAll('#exp-split input:checked')].map(i => i.value)) : null;
  const known = new Set(pickersFor.split('|').map(s => s.split(':')[0]));
  sel.innerHTML = S.people.map(p => `<option value="${esc(p.key)}">${esc(p.name)}</option>`).join('');
  sel.value = S.people.some(p => p.key === prevPayer) ? prevPayer : (S.people[0] || {}).key || '';
  $('#exp-split').innerHTML = S.people.map(p => {
    const on = !prevChecked || prevChecked.has(p.key) || !known.has(p.key);   // nowe osoby domyślnie zaznaczone
    return `<label><input type="checkbox" value="${esc(p.key)}" ${on ? 'checked' : ''}>${avatar(p.name)}${esc(p.name)}</label>`;
  }).join('');
  pickersFor = sig;
  updateShare();
}
function updateShare() {
  const n = document.querySelectorAll('#exp-split input:checked').length;
  const s = $('#exp-amount').value.replace(/\s|zł/gi, '').replace(',', '.');
  const g = /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(+s * 100) : 0;
  $('#exp-share').textContent = !n ? 'Zaznacz co najmniej jedną osobę.'
    : g ? `${osoby(n)}, po ${zl(Math.floor(g / n))}${g % n ? ' (grosze reszty rozkładają się na pierwsze osoby)' : ''}.`
      : `Podzieli się po równo na ${osoby(n)}.`;
}

function renderExpenses() {
  syncExpensePickers();
  const k = myKey();
  const total = S.expenses.filter(x => !x.settle).reduce((s, x) => s + x.amount, 0);
  const bal = balances();
  const tr = transfers(bal);
  $('#exp-summary').textContent = S.expenses.length
    ? `Razem wydane: ${zl(total)}. Każdy wydatek dzieli się po równo między osoby, które się składają.`
    : 'Nikt jeszcze nic nie wpisał. Dodaj pierwszy wydatek: kto płaci, ile i kto się składa.';

  $('#exp-settle').innerHTML = !S.expenses.length ? '' : tr.length
    ? `<div class="settle"><h3>Kto komu oddaje</h3><ul>${tr.map(t => `<li class="${t.from === k || t.to === k ? 'mine' : ''}">
        ${avatar(nameOf(t.from))}<span><strong>${esc(nameOf(t.from))}</strong> → <strong>${esc(nameOf(t.to))}</strong></span>
        <span class="amt">${esc(zl(t.amount))}</span>
        <button type="button" class="mini" data-settle="${esc(t.from)}|${esc(t.to)}|${t.amount}">Oddane</button></li>`).join('')}</ul></div>`
    : '<div class="settle"><h3>Wszyscy są rozliczeni</h3></div>';

  $('#exp-balance').innerHTML = S.people.map(p => {
    const v = bal[p.key] || 0;
    return `<div class="bal ${v > 0 ? 'plus' : v < 0 ? 'minus' : ''}">${avatar(p.name)}<span>${esc(p.name)}${p.key === k ? ' (ty)' : ''}</span>
      <span class="amt">${v > 0 ? '+' : v < 0 ? '−' : ''}${esc(zl(Math.abs(v)))}</span></div>`;
  }).join('');

  const fmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  $('#exp-list').innerHTML = [...S.expenses].reverse().map(x => {
    const sh = sharesOf(x), n = x.split.length;
    const each = Math.min(...Object.values(sh));
    return `<article class="exp ${x.settle ? 'is-settle' : ''}">
      <div class="exp-head"><strong>${x.settle ? `Zwrot: ${esc(nameOf(x.payer))} → ${esc(nameOf(x.split[0]))}` : esc(x.title)}</strong>
        <span class="amt">${esc(zl(x.amount))}</span></div>
      <small>${x.settle ? '' : `płaci ${esc(nameOf(x.payer))} · ${osoby(n)} po ${esc(zl(each))} · `}${esc(fmt.format(x.at))}</small>
      <div class="exp-foot">${x.settle ? '' : `<span class="idea-who">${x.split.map(s => avatar(nameOf(s))).join('')}</span>`}
        ${x.byKey === k ? `<button type="button" class="mini" data-exp-del="${esc(x.id)}">Usuń</button>` : ''}</div>
    </article>`;
  }).join('') || '<p class="muted">Lista jest pusta.</p>';
}

$('#exp-amount').addEventListener('input', updateShare);
$('#exp-split').addEventListener('change', updateShare);
$('#exp-all').addEventListener('click', () => {
  const boxes = [...document.querySelectorAll('#exp-split input')];
  const all = boxes.every(b => b.checked);
  for (const b of boxes) b.checked = !all;
  updateShare();
});
$('#exp').addEventListener('submit', async e => {
  e.preventDefault();
  if (!me) return askName();
  const f = e.target;
  const split = [...document.querySelectorAll('#exp-split input:checked')].map(i => i.value);
  if (!split.length) return toast('Zaznacz, kto się składa.');
  const ok = await api('expense', { title: f.title.value, amount: f.amount.value, payer: f.payer.value, split });
  if (ok) { f.title.value = ''; f.amount.value = ''; updateShare(); f.title.focus(); toast('Wydatek dodany.'); }
});

// ---------- edycja pomysłu (okno poza obszarem odświeżania) ----------
let editing = null;
function openEdit(id) {
  const idea = S.ideas.find(i => i.id === id);
  if (!idea) return;
  editing = id;
  const f = $('#edit-form');
  f.title.value = idea.title;
  f.link.value = idea.link || '';
  const radio = f.querySelector(`input[value="${CSS.escape(idea.cat)}"]`) || f.querySelector('input[name=cat]');
  if (radio) radio.checked = true;
  $('#edit').showModal();
  f.title.focus();
}
$('#edit-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const ok = await api('ideaEdit', { id: editing, title: f.title.value, link: f.link.value, cat: f.cat.value });
  if (ok) { $('#edit').close(); toast('Zapisane.'); }
});
$('#edit-cancel').addEventListener('click', () => $('#edit').close());
$('#edit').addEventListener('close', () => { editing = null; });

$('#add').addEventListener('submit', async e => {
  e.preventDefault();
  if (!me) return askName();
  const f = e.target;
  const ok = await api('idea', { title: f.title.value, link: f.link.value, cat: f.cat.value });
  if (ok) { f.title.value = ''; f.link.value = ''; f.title.focus(); }
});

// ---------- przeciąganie (mysz i dotyk) ----------
document.addEventListener('pointerdown', e => {
  const tile = e.target.closest('#view-plan .tile');
  if (!tile || e.target.closest('button') || e.button > 0) return;
  drag = { id: tile.dataset.id, tile, pid: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false };
});
document.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  drag.x = e.clientX; drag.y = e.clientY;
  if (!drag.started) {
    if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < 6) return;
    startDrag();
  }
  moveDrag();
});
document.addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = drag;
  suppressClickUntil = performance.now() + 350;
  if (!d.started) {                         // zwykłe stuknięcie: zaznacz / odznacz
    drag = null;
    selected = selected === d.id ? null : d.id;
    return render();
  }
  const over = d.over, index = d.index;
  endDrag();
  if (over) place(d.id, over === 'pool' ? null : over, over === 'pool' ? undefined : index);
  else render();
});
document.addEventListener('pointercancel', e => {
  if (drag && e.pointerId === drag.pid) { if (drag.started) endDrag(); else drag = null; render(); }
});

function startDrag() {
  const r = drag.tile.getBoundingClientRect();
  drag.started = true;
  drag.dx = drag.x0 - r.left; drag.dy = drag.y0 - r.top;
  const g = drag.tile.cloneNode(true);
  g.classList.add('ghost'); g.removeAttribute('tabindex');
  g.style.width = r.width + 'px';
  document.body.appendChild(g);
  drag.ghost = g;
  drag.tile.classList.add('dragging');
  selected = null;
  drag.raf = requestAnimationFrame(autoScroll);
}
function moveDrag() {
  drag.ghost.style.left = (drag.x - drag.dx) + 'px';
  drag.ghost.style.top = (drag.y - drag.dy) + 'px';
  clearMarks();
  const el = document.elementFromPoint(drag.x, drag.y);
  const zone = el && el.closest('#view-plan [data-drop]');
  drag.over = null;
  if (!zone) return;
  zone.classList.add('over');
  drag.over = zone.dataset.drop;
  const tiles = [...zone.querySelectorAll('.tile:not(.dragging)')];
  let idx = tiles.length;
  for (let i = 0; i < tiles.length; i++) {
    const r = tiles[i].getBoundingClientRect();
    if (drag.y < r.top + r.height / 2) { idx = i; break; }
  }
  drag.index = idx;
  if (drag.over !== 'pool' && tiles[idx]) tiles[idx].classList.add('before');
}
function autoScroll() {
  if (!drag || !drag.started) return;
  const edge = 70;
  if (drag.y < edge) window.scrollBy(0, -14);
  else if (drag.y > innerHeight - edge) window.scrollBy(0, 14);
  drag.raf = requestAnimationFrame(autoScroll);
}
function clearMarks() {
  for (const el of document.querySelectorAll('.over')) el.classList.remove('over');
  for (const el of document.querySelectorAll('.tile.before')) el.classList.remove('before');
}
function endDrag() {
  cancelAnimationFrame(drag.raf);
  drag.ghost.remove();
  drag.tile.classList.remove('dragging');
  clearMarks();
  drag = null;
  if (pendingRender) { pendingRender = false; }
}

// ---------- imię ----------
function askName() {
  const dlg = $('#who');
  $('#who-list').innerHTML = (S ? S.people : []).map(p =>
    `<button type="button" data-who="${esc(p.name)}">${avatar(p.name)}${esc(p.name)}</button>`).join('');
  $('#who-name').value = me;
  if (!dlg.open) dlg.showModal();
}
async function setName(name) {
  name = name.replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!name) return $('#who-name').focus();
  me = name; store.set('pga-imie', me);
  $('#who').close();
  await api('join', {});
  render();
}
$('#who-form').addEventListener('submit', e => { e.preventDefault(); setName($('#who-name').value); });
$('#who-list').addEventListener('click', e => { const b = e.target.closest('[data-who]'); if (b) setName(b.dataset.who); });
$('#who').addEventListener('cancel', e => { if (!me) e.preventDefault(); });

// ---------- hasło ----------
function showLogin() {
  const dlg = $('#login');
  if ($('#who').open) $('#who').close();
  if (!dlg.open) { dlg.showModal(); $('#login-pass').focus(); }
}
$('#login').addEventListener('cancel', e => e.preventDefault());
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#login-error'); err.textContent = '';
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#login-pass').value }),
    });
    if (!r.ok) { err.textContent = (await r.json()).error || 'Nie udało się zalogować.'; return; }
    $('#login-pass').value = '';
    $('#login').close();
    boot();
  } catch { err.textContent = 'Brak połączenia z serwerem.'; }
});
$('#logout').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch { /* i tak przeładujemy */ }
  location.reload();
});

// ---------- start ----------
let catsReady = false;
async function boot() {
  await refresh(true);
  if (!S) { if (!$('#login').open) toast('Nie udało się połączyć z serwerem.'); return; }
  if (!catsReady) {
    catsReady = true;
    const catsHTML = name => S.config.cats.map((c, i) =>
      `<label class="cat-${esc(c)}"><input type="radio" name="${name}" value="${esc(c)}" ${i === 0 ? 'checked' : ''}>${shape(c)}${esc(CAT_NAMES[c] || c)}</label>`).join('');
    $('#cats').innerHTML = catsHTML('cat');
    $('#edit-cats').innerHTML = catsHTML('cat');
  }
  if (me) api('join', {}); else askName();
}
boot();
