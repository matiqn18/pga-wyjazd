import { $$ } from '../core/dom.js';

const START_DISTANCE = 6;     // px ruchu, zanim stuknięcie zamieni się w przeciąganie
const SCROLL_EDGE = 70;       // px od krawędzi ekranu, przy których strona sama się przewija
const SCROLL_STEP = 14;
const CLICK_GUARD_MS = 350;   // po puszczeniu kafelka ignorujemy „kliknięcie”, które wyśle przeglądarka

/**
 * Przeciąganie kafelków myszą i palcem (pointer events).
 * Kafelki to `tileSelector`, pola docelowe mają `data-drop` (id pola albo „pool”).
 * Zwykłe stuknięcie (bez ruchu) woła onTap – to alternatywa bez przeciągania.
 */
export class DragController {
  constructor({ tileSelector, zoneSelector, onTap, onStart, onDrop, onCancel }) {
    Object.assign(this, { tileSelector, zoneSelector, onTap, onStart, onDrop, onCancel });
    this.drag = null;
    this.ignoreClicksUntil = 0;

    document.addEventListener('pointerdown', e => this.pointerDown(e));
    document.addEventListener('pointermove', e => this.pointerMove(e));
    document.addEventListener('pointerup', e => this.pointerUp(e));
    document.addEventListener('pointercancel', e => this.pointerCancel(e));
  }

  /** Trwa przeciąganie (wtedy nie przerysowujemy strony). */
  get active() {
    return Boolean(this.drag && this.drag.started);
  }

  /** Wciśnięty kafelek (także zanim zacznie się ruch) – wtedy nie odpytujemy serwera. */
  get pressed() {
    return Boolean(this.drag);
  }

  /** Czy kliknięcie to tylko echo właśnie zakończonego przeciągania. */
  get justDropped() {
    return performance.now() < this.ignoreClicksUntil;
  }

  pointerDown(e) {
    const tile = e.target.closest(this.tileSelector);
    if (!tile || e.target.closest('button') || e.button > 0) return;
    this.drag = { id: tile.dataset.id, tile, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false };
  }

  pointerMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.started) {
      if (Math.hypot(d.x - d.x0, d.y - d.y0) < START_DISTANCE) return;
      this.start();
    }
    this.move();
  }

  pointerUp(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.ignoreClicksUntil = performance.now() + CLICK_GUARD_MS;
    if (!d.started) {
      this.drag = null;
      return this.onTap(d.id);
    }
    const { over, index } = d;
    this.finish();
    if (over) this.onDrop(d.id, over === 'pool' ? null : over, over === 'pool' ? undefined : index);
    else this.onCancel();
  }

  pointerCancel(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    if (d.started) this.finish();
    else this.drag = null;
    this.onCancel();
  }

  /** Ruch zaczął się naprawdę: „duch” kafelka pod palcem i automatyczne przewijanie. */
  start() {
    const d = this.drag;
    const rect = d.tile.getBoundingClientRect();
    d.started = true;
    d.dx = d.x0 - rect.left;
    d.dy = d.y0 - rect.top;
    d.ghost = d.tile.cloneNode(true);
    d.ghost.classList.add('ghost');
    d.ghost.removeAttribute('tabindex');
    d.ghost.style.width = rect.width + 'px';
    document.body.appendChild(d.ghost);
    d.tile.classList.add('dragging');
    d.raf = requestAnimationFrame(() => this.autoScroll());
    this.onStart(d.id);
  }

  /** Ustala pole pod palcem i miejsce wstawienia (przed którym kafelkiem). */
  move() {
    const d = this.drag;
    d.ghost.style.left = (d.x - d.dx) + 'px';
    d.ghost.style.top = (d.y - d.dy) + 'px';
    this.clearMarks();
    const under = document.elementFromPoint(d.x, d.y);
    const zone = under && under.closest(this.zoneSelector);
    d.over = zone ? zone.dataset.drop : null;
    if (!zone) return;
    zone.classList.add('over');
    const tiles = $$('.tile:not(.dragging)', zone);
    const before = tiles.findIndex(t => { const r = t.getBoundingClientRect(); return d.y < r.top + r.height / 2; });
    d.index = before < 0 ? tiles.length : before;
    if (d.over !== 'pool' && tiles[d.index]) tiles[d.index].classList.add('before');
  }

  autoScroll() {
    const d = this.drag;
    if (!d || !d.started) return;
    if (d.y < SCROLL_EDGE) window.scrollBy(0, -SCROLL_STEP);
    else if (d.y > innerHeight - SCROLL_EDGE) window.scrollBy(0, SCROLL_STEP);
    d.raf = requestAnimationFrame(() => this.autoScroll());
  }

  finish() {
    const d = this.drag;
    cancelAnimationFrame(d.raf);
    d.ghost.remove();
    d.tile.classList.remove('dragging');
    this.clearMarks();
    this.drag = null;
  }

  clearMarks() {
    for (const el of $$('.over')) el.classList.remove('over');
    for (const el of $$('.tile.before')) el.classList.remove('before');
  }
}
