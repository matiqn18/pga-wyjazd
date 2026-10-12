/**
 * Kawałki HTML wspólne dla widoków. Każda funkcja zwraca tekst HTML;
 * dane od użytkownika zawsze przez esc().
 */
import { esc, keyOf, join } from '../core/dom.js';
import { osoby } from '../core/format.js';

export const CATEGORY_NAMES = { atrakcje: 'Atrakcje', jedzenie: 'Jedzenie', pga: 'Na PGA', inne: 'Inne' };
export const categoryName = cat => CATEGORY_NAMES[cat] || cat;

export const LEVEL_NAMES = { 3: 'Bardzo chcę', 2: 'Chętnie', 1: 'Mogę' };
const LEVEL_GROUP_NAMES = { 3: 'Bardzo chcą', 2: 'Chętnie', 1: 'Mogą' };
export const LEVELS_DESC = [3, 2, 1];

/** Kształt = rodzaj pomysłu (gwiazdka, koło, półkole, kwadrat). */
const SHAPES = {
  atrakcje: '<polygon points="12,2 15,9 22,9.5 16.5,14.5 18.5,22 12,17.8 5.5,22 7.5,14.5 2,9.5 9,9"/>',
  pga: '<circle cx="12" cy="12" r="9"/>',
  jedzenie: '<path d="M3 16a9 9 0 0 1 18 0z"/>',
  inne: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
};
export const shape = cat => `<svg viewBox="0 0 24 24" aria-hidden="true">${SHAPES[cat] || SHAPES.inne}</svg>`;

/** Kropki poziomu oceny: ●●● / ●● / ●. */
export const pips = n => `<span class="pips" aria-hidden="true">${'<i></i>'.repeat(n)}</span>`;

const AVATAR_COLORS = ['#ff9a4d', '#2cc5b3', '#ff7aa2', '#b3a3ff', '#6cbcff', '#ffd24d'];

/** Kółko z inicjałami; kolor stały dla danego imienia. `level` 1 („mogę”) jest przygaszone. */
export function avatar(name, { big = false, level = 0 } = {}) {
  let hash = 0;
  for (const ch of keyOf(name)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const initials = name.trim().split(/\s+/).map(w => [...w][0]).slice(0, 2).join('').toUpperCase();
  const cls = join(['av', big && ' big', level && ` l${level}`]);
  return `<span class="${cls}" style="--avc:${AVATAR_COLORS[hash % AVATAR_COLORS.length]}" title="${esc(name)}">${esc(initials)}</span>`;
}

export const avatarsOf = fans => fans.map(f => avatar(f.name, { level: f.level })).join('');

/** Przyciski oceny pomysłu: bardzo chcę / chętnie / mogę. */
export function rateButtons(ideaId, myLevel) {
  const buttons = LEVELS_DESC.map(level =>
    `<button type="button" data-rate="${esc(ideaId)}" data-level="${level}" aria-pressed="${myLevel === level}">${pips(level)}${LEVEL_NAMES[level]}</button>`);
  return `<div class="rate" role="group" aria-label="Ile chcesz?">${buttons.join('')}</div>`;
}

/** Chętni pogrupowani wg poziomu: ●●● (A)(B)  ●● (C). */
export function fanGroups(fans) {
  if (!fans.length) return '<span class="muted">Nikt jeszcze nie ocenia.</span>';
  return LEVELS_DESC.map(level => {
    const group = fans.filter(f => f.level === level);
    if (!group.length) return '';
    return `<span class="grp">${pips(level)}<span class="sr">${LEVEL_GROUP_NAMES[level]}:</span>${group.map(f => avatar(f.name)).join('')}</span>`;
  }).join('');
}

/** Wybór osób (chipy z awatarami) jako checkboxy albo radio. */
export function personPicker(people, { checked = () => true, type = 'checkbox', name = '' } = {}) {
  return people.map(p =>
    `<label><input type="${type}" ${name ? `name="${name}"` : ''} value="${esc(p.key)}" ${checked(p) ? 'checked' : ''}>${avatar(p.name)}${esc(p.name)}</label>`).join('');
}

export const personOptions = people => people.map(p => `<option value="${esc(p.key)}">${esc(p.name)}</option>`).join('');

/** Kafelek pomysłu na wspólnym planie: chętni i ostrzeżenie, gdy ktoś chętny nie może w tym polu. */
export function ideaTile(model, idea, { slot = null, selected = false } = {}) {
  const fans = model.fansOf(idea.id);
  const awayKeys = slot ? model.awayIn(slot) : [];
  const away = fans.filter(f => awayKeys.includes(f.key)).map(f => f.name);
  return `<div class="tile cat-${esc(idea.cat)}" data-id="${esc(idea.id)}" role="button" tabindex="0"
    aria-pressed="${selected}" aria-label="${esc(idea.title)}, ${esc(categoryName(idea.cat))}, ${osoby(fans.length)} chętnych">
    ${shape(idea.cat)}<span class="tile-title">${esc(idea.title)}</span>
    ${idea.note ? `<span class="tile-meta">${esc(idea.note)}</span>` : ''}
    <span class="tile-who">${fans.length ? avatarsOf(fans) : '<span class="tile-meta">nikt jeszcze nie chce</span>'}</span>
    ${away.length ? `<span class="tile-warn">Nie może: ${esc(away.join(', '))}</span>` : ''}
  </div>`;
}

/** Tło pola zależne od pory dnia. */
function tintOf(partName) {
  const p = partName.toLowerCase();
  if (p.includes('ran') || p.includes('śniad')) return 't-rano';
  if (p.includes('połud') || p.includes('dzień')) return 't-dzien';
  if (p.includes('wiecz')) return 't-wieczor';
  if (p.includes('noc')) return 't-noc';
  return '';
}

/**
 * Plansza dni × pory dnia. `cell(part, day)` zwraca `{ html, cls }` dla pola.
 * `droppable` dodaje data-drop (przeciąganie na wspólnym planie).
 */
export function board(model, cell, { droppable = false } = {}) {
  const days = model.config.days;
  const rows = model.partRows();
  const out = [`<div class="board" style="--days:${days.length}">`];
  rows.forEach((row, ri) => out.push(`<div class="part-h" style="grid-column:1;grid-row:${ri + 2}">${esc(row)}</div>`));
  days.forEach((day, di) => {
    out.push(`<h3 class="day-h" style="grid-column:${di + 2};grid-row:1">${esc(day.name)}</h3>`);
    for (const part of day.parts) {
      const { html, cls = '' } = cell(part, day);
      out.push(`<div class="slot ${tintOf(part.name)} ${cls}" ${droppable ? `data-drop="${esc(part.id)}"` : ''}
        style="grid-column:${di + 2};grid-row:${rows.indexOf(part.name) + 2}">
        <div class="slot-label">${esc(part.name)}</div>${html}</div>`);
    }
  });
  out.push('</div>');
  return out.join('');
}
