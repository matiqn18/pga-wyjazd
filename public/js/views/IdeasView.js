import { $, $$, esc } from '../core/dom.js';
import { pomysly, slotLabel } from '../core/format.js';
import { categoryName, fanGroups, rateButtons, shape } from '../ui/components.js';
import { View } from './View.js';

const SORTS = ['todo', 'hot', 'new'];

/** Zakładka „Pomysły”: dodawanie, ocena 1–3, filtr rodzaju, sortowanie, edycja i usuwanie. */
export class IdeasView extends View {
  constructor(app) {
    super(app, 'pomysly');
    this.sort = app.prefs.get('sort', 'todo', SORTS);
    this.filter = app.prefs.get('filter', '');   // '' = wszystko
    this.summary = $('#ideas-summary');
    this.filters = $('#filters');
    this.list = $('#ideas');
    this.addForm = $('#add');

    this.on('click', '[data-filter]', el => this.setFilter(el.dataset.filter));
    this.on('click', '[data-sort]', el => this.setSort(el.dataset.sort));
    this.on('click', '[data-rate]', el => this.rate(el.dataset.rate, Number(el.dataset.level)));
    this.on('click', '[data-edit]', el => this.edit(el.dataset.edit));
    this.on('click', '[data-del]', el => this.remove(el.dataset.del));
    this.onSubmit(this.addForm, form => this.add(form));
  }

  render() {
    const m = this.model;
    if (this.filter && !m.config.cats.includes(this.filter)) this.filter = '';
    this.renderSummary();
    this.renderFilters();
    for (const b of $$('[data-sort]', this.root)) b.setAttribute('aria-pressed', b.dataset.sort === this.sort);
    this.list.innerHTML = this.visibleIdeas().map(idea => this.card(idea)).join('') || this.emptyText();
  }

  renderSummary() {
    const m = this.model;
    const todo = m.unratedBy().length;
    this.summary.textContent = !m.ideas.length
      ? 'Nikt jeszcze nic nie zaproponował. Dodaj pierwszy pomysł.'
      : todo
        ? `Oceń, co cię interesuje. Do ocenienia: ${pomysly(todo)}. Stuknij jeszcze raz, żeby cofnąć ocenę.`
        : 'Wszystko ocenione. Możesz zmienić zdanie w każdej chwili.';
  }

  renderFilters() {
    const m = this.model;
    if (!m.ideas.length) { this.filters.innerHTML = ''; return; }
    const count = cat => m.ideas.filter(i => i.cat === cat).length;
    const options = [['', 'Wszystko', m.ideas.length], ...m.config.cats.map(c => [c, categoryName(c), count(c)])];
    this.filters.innerHTML = options.map(([cat, label, n]) =>
      `<button type="button" class="${cat ? 'cat-' + esc(cat) : 'all'}" data-filter="${esc(cat)}" aria-pressed="${this.filter === cat}">
        ${cat ? shape(cat) : ''}${esc(label)} <span class="n">${n}</span></button>`).join('');
  }

  /** Pomysły po filtrze, w wybranej kolejności. */
  visibleIdeas() {
    const m = this.model;
    const newest = [...m.ideas].reverse().filter(i => !this.filter || i.cat === this.filter);
    if (this.sort === 'hot') return newest.sort(m.byScore);
    if (this.sort === 'todo') {
      const rated = i => m.levelOf(i.id) > 0;
      return [...newest.filter(i => !rated(i)), ...newest.filter(rated)];
    }
    return newest;
  }

  card(idea) {
    const m = this.model;
    const slot = m.slotOf(idea.id);
    const host = linkHost(idea.link);
    return `<article class="idea cat-${esc(idea.cat)}">
      <div class="idea-head">${shape(idea.cat)}<div><h3>${esc(idea.title)}</h3><small>${esc(categoryName(idea.cat))}</small></div></div>
      <div class="idea-body">
        ${rateButtons(idea.id, m.levelOf(idea.id))}
        ${idea.note ? `<p>${esc(idea.note)}</p>` : ''}
        <div class="idea-who">${fanGroups(m.fansOf(idea.id))}</div>
        ${host ? `<p class="idea-link"><a href="${esc(idea.link)}" target="_blank" rel="noopener noreferrer">${esc(host)} ↗</a></p>` : ''}
        <div class="idea-actions">
          <span class="muted">${slot ? `W planie: <strong>${esc(slotLabel(slot))}</strong>` : `Dodaje: ${esc(idea.by)}`}</span>
          ${m.canEdit(idea) ? `<span class="own-actions">
            <button type="button" class="mini" data-edit="${esc(idea.id)}">Edytuj</button>
            <button type="button" class="mini" data-del="${esc(idea.id)}">Usuń</button></span>` : ''}
        </div>
      </div></article>`;
  }

  emptyText() {
    return this.filter ? `<p class="muted">Nie ma jeszcze pomysłów w kategorii „${esc(categoryName(this.filter))}”. Dodaj pierwszy.</p>` : '';
  }

  // ---------- akcje ----------

  setFilter(cat) {
    this.filter = cat;
    this.app.prefs.set('filter', cat);
    // Nowy pomysł od razu w oglądanej kategorii.
    const radio = cat && $(`#cats input[value="${CSS.escape(cat)}"]`);
    if (radio) radio.checked = true;
    this.app.render();
  }

  setSort(sort) {
    this.sort = sort;
    this.app.prefs.set('sort', sort);
    this.app.render();
  }

  /** Drugie stuknięcie tej samej oceny ją cofa. Zmiana widoczna od razu, serwer potwierdza. */
  rate(ideaId, level) {
    if (!this.app.requireName()) return;
    const next = this.model.levelOf(ideaId) === level ? 0 : level;
    this.model.rateLocally(ideaId, next);
    this.app.render();
    this.app.send('interest', { id: ideaId, level: next });
  }

  edit(ideaId) {
    const idea = this.model.ideaById(ideaId);
    if (idea) this.app.dialogs.ideaEdit.openFor(idea);
  }

  remove(ideaId) {
    const idea = this.model.ideaById(ideaId);
    if (idea && confirm(`Usunąć pomysł „${idea.title}”? Zniknie też z oceny i ze wspólnego planu.`)) {
      this.app.send('ideaDelete', { id: idea.id });
    }
  }

  async add(form) {
    if (!this.app.requireName()) return;
    const saved = await this.app.send('idea', { title: form.title.value, link: form.link.value, cat: form.cat.value });
    if (saved) {
      form.title.value = '';
      form.link.value = '';
      form.title.focus();
    }
  }
}

function linkHost(link) {
  try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return ''; }
}
