import { $, esc } from '../core/dom.js';
import { osoby, pomysly, shortTime, slotLabel } from '../core/format.js';
import { LEVELS_DESC, LEVEL_NAMES, avatar, fanGroups, pips, shape } from '../ui/components.js';
import { describeEvent } from '../ui/eventText.js';
import { View } from './View.js';

/** Zakładka „Kto co chce”: kto jeszcze nie ocenił, ranking pomysłów, karty osób, historia. */
export class PeopleView extends View {
  constructor(app) {
    super(app, 'chetni');
    this.summary = $('#rank-summary');
    this.ranking = $('#rank');
    this.cards = $('#people');
    this.eventsCount = $('#events-count');
    this.events = $('#events');

    // Tylko admin widzi te przyciski (serwer i tak sprawdza uprawnienia).
    this.on('click', '[data-p-rename]', el => this.rename(el.dataset.pRename));
    this.on('click', '[data-p-del]', el => this.remove(el.dataset.pDel));
  }

  render() {
    this.renderSummary();
    this.renderRanking();
    this.renderPeople();
    this.renderHistory();
  }

  /** Kto ile pomysłów ma jeszcze do ocenienia – od największych zaległości. */
  renderSummary() {
    const m = this.model;
    if (!m.ideas.length) {
      this.summary.innerHTML = '<p class="hint">Nie ma jeszcze pomysłów do oceniania.</p>';
      return;
    }
    const behind = m.people
      .map(p => ({ name: p.name, left: m.unratedBy(p.key).length }))
      .filter(p => p.left)
      .sort((a, b) => b.left - a.left || a.name.localeCompare(b.name, 'pl'));
    this.summary.innerHTML = behind.length
      ? `<p class="hint">Jeszcze do ocenienia (liczba pomysłów):</p>
        <ul class="todo-people">${behind.map(p => `<li>${avatar(p.name)}<span>${esc(p.name)}</span>
          <span class="n" aria-label="${pomysly(p.left)}">${p.left}</span></li>`).join('')}</ul>`
      : '<p class="hint">Wszyscy ocenili wszystkie pomysły.</p>';
  }

  renderRanking() {
    const m = this.model;
    this.ranking.innerHTML = [...m.ideas].sort(m.byScore).map((idea, i) => {
      const fans = m.fansOf(idea.id);
      const slot = m.slotOf(idea.id);
      return `<article class="rank-row cat-${esc(idea.cat)}">
        <span class="rank-n">${i + 1}</span>${shape(idea.cat)}
        <div class="rank-main"><strong>${esc(idea.title)}</strong>
          <small>${fans.length ? osoby(fans.length) : 'nikt'}${slot ? ' · w planie: ' + esc(slotLabel(slot)) : ' · jeszcze nie w planie'}</small>
          <div class="idea-who">${fanGroups(fans)}</div></div>
        <span class="rank-score" title="Suma ocen">${m.scoreOf(idea.id)}</span>
      </article>`;
    }).join('');
  }

  renderPeople() {
    const m = this.model;
    this.cards.innerHTML = m.people.map(p => this.personCard(p)).join('') || '<p class="muted">Nikt jeszcze nie dołączył.</p>';
  }

  personCard(person) {
    const m = this.model;
    const total = m.ideas.length;
    const rated = total - m.unratedBy(person.key).length;
    const away = m.awayOf(person.key);
    const groups = LEVELS_DESC.map(level => {
      const ideas = m.ideas.filter(i => m.levelOf(i.id, person.key) === level);
      if (!ideas.length) return '';
      return `<h4>${pips(level)}${LEVEL_NAMES[level]}</h4>
        <ul>${ideas.map(i => `<li class="cat-${esc(i.cat)}"><span class="dot"></span>${esc(i.title)}</li>`).join('')}</ul>`;
    }).join('');
    return `<article class="person">
      <div class="person-head">${avatar(person.name, { big: true })}<div><strong>${esc(person.name)}</strong>
        <small>${total ? `oceniono: ${rated} z ${total}` : ''}</small></div></div>
      ${m.isAdmin ? this.adminButtons(person) : ''}
      ${groups || '<p class="muted">Jeszcze nic nie wybiera.</p>'}
      ${away.length ? `<h4>Nie może</h4><p>${esc(away.map(slotLabel).join('; '))}</p>` : ''}
    </article>`;
  }

  adminButtons(person) {
    const isMe = person.key === this.model.me;
    return `<div class="admin-row">
      <button type="button" class="mini" data-p-rename="${esc(person.key)}">Zmień imię</button>
      ${isMe ? '' : `<button type="button" class="mini" data-p-del="${esc(person.key)}">Usuń osobę</button>`}
    </div>`;
  }

  renderHistory() {
    const events = this.model.events;
    this.eventsCount.textContent = events.length ? `(${events.length})` : '';
    this.events.innerHTML = [...events].reverse().map(e =>
      `<li><time datetime="${new Date(e.t).toISOString()}">${esc(shortTime(e.t))}</time><span><strong>${esc(e.who)}</strong> ${describeEvent(e)}</span></li>`
    ).join('') || '<li class="muted">Jeszcze nic się nie wydarzyło.</li>';
  }

  // ---------- akcje admina ----------

  rename(key) {
    const old = this.model.nameOf(key);
    const name = prompt(`Nowe imię dla „${old}”:`, old);
    if (name && name.trim() && name.trim() !== old) this.app.send('personRename', { key, newName: name });
  }

  remove(key) {
    const name = this.model.nameOf(key);
    if (confirm(`Usunąć osobę „${name}”? Znikną jej oceny, „nie mogę” i lokalizacja. Pomysły zostają.`)) {
      this.app.send('personDelete', { key });
    }
  }
}
