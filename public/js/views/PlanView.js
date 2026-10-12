import { $, esc } from '../core/dom.js';
import { board, ideaTile } from '../ui/components.js';
import { DragController } from './DragController.js';
import { View } from './View.js';

/**
 * Zakładka „Wspólny plan”: pula pomysłów (najbardziej chciane na górze) i plansza.
 * Kafelki przeciąga każdy; alternatywa bez przeciągania: stuknij kafelek → „Wstaw tutaj”.
 */
export class PlanView extends View {
  constructor(app) {
    super(app, 'plan');
    this.pool = $('#pool');
    this.board = $('#board');
    this.summary = $('#plan-summary');
    this.selected = null; // id kafelka wybranego stuknięciem

    this.dragger = new DragController({
      tileSelector: '#view-plan .tile',
      zoneSelector: '#view-plan [data-drop]',
      onTap: id => this.toggleSelected(id),
      onStart: () => { this.selected = null; },
      onDrop: (id, slot, index) => this.place(id, slot, index),
      onCancel: () => this.app.render(),
    });

    this.on('click', '[data-place]', el => this.selected && this.place(this.selected, el.dataset.place));
    this.on('click', '[data-drop]', (zone, event) => this.clickZone(zone, event));
    this.on('keydown', '.tile', (tile, event) => this.tileKey(tile, event));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.selected) this.toggleSelected(this.selected); });
  }

  canRender() {
    return !this.dragger.active;
  }

  reset() {
    this.selected = null;
  }

  render() {
    const m = this.model;
    if (this.selected && !m.ideaById(this.selected)) this.selected = null;
    this.summary.textContent = 'Ten plan jest wspólny: każdy może przestawiać kafelki, a historia zapisuje, kto co zmienia. '
      + 'Pod kafelkiem widać chętnych; ostrzeżenie oznacza, że ktoś chętny w tym czasie nie może.';
    this.renderPool();
    this.board.innerHTML = board(m, part => ({ html: this.cell(part) }), { droppable: true });
  }

  renderPool() {
    const m = this.model;
    const free = m.unplacedIdeas().sort(m.byScore);
    const empty = m.ideas.length ? 'Wszystkie pomysły są już w planie.' : 'Nie ma jeszcze pomysłów. Dodaj pierwszy w zakładce Pomysły.';
    this.pool.innerHTML = free.length
      ? free.map(i => ideaTile(m, i, { selected: this.selected === i.id })).join('')
      : `<p class="pool-empty">${empty}</p>`;
  }

  /** Pole planu: kafelki, kto nie może (jeśli nie ma już ostrzeżenia na kafelku), „Wstaw tutaj”. */
  cell(part) {
    const m = this.model;
    const ideas = m.ideasIn(part.id);
    const warned = new Set(ideas.flatMap(i => m.fansOf(i.id).map(f => f.key)));
    const away = m.awayIn(part.id).filter(k => !warned.has(k)).map(k => m.nameOf(k));
    return `${ideas.map(i => ideaTile(m, i, { slot: part.id, selected: this.selected === i.id })).join('')}
      <div class="slot-foot">
        ${away.length ? `<span class="away-line">Nie może: ${esc(away.join(', '))}</span>` : ''}
        ${this.selected ? `<button type="button" class="mini place" data-place="${esc(part.id)}">Wstaw tutaj</button>` : ''}
      </div>`;
  }

  // ---------- akcje ----------

  toggleSelected(id) {
    this.selected = this.selected === id ? null : id;
    this.app.render();
  }

  /** Stuknięcie w puste miejsce pola, gdy kafelek jest wybrany. */
  clickZone(zone, event) {
    if (this.dragger.justDropped || !this.selected) return;
    if (event.target.closest('.tile, [data-place]')) return;
    this.place(this.selected, zone.dataset.drop === 'pool' ? null : zone.dataset.drop);
  }

  /** Enter / spacja na kafelku = stuknięcie. */
  tileKey(tile, event) {
    if (event.target !== tile || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    const id = tile.dataset.id;
    this.toggleSelected(id);
    const again = $(`#view-plan .tile[data-id="${CSS.escape(id)}"]`);
    if (again) again.focus();
  }

  /** Zmiana widoczna od razu, serwer potwierdza. `slot` null = z powrotem do puli. */
  place(ideaId, slot, index) {
    if (!this.app.requireName()) return;
    this.model.placeLocally(ideaId, slot, index);
    this.selected = null;
    this.app.render();
    this.app.send('place', { id: ideaId, slot: slot || null, index: index == null ? undefined : index });
  }
}
