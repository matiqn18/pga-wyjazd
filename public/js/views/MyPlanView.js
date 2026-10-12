import { $, esc } from '../core/dom.js';
import { avatarsOf, board, pips, shape } from '../ui/components.js';
import { View } from './View.js';
import { WherePanel } from './WherePanel.js';

/**
 * Zakładka „Mój plan”: niczego tu nie układasz – to wspólny plan zawężony do tego,
 * co cię interesuje, z kim idziesz i „Nie mogę”. Na górze „Gdzie kto jest”.
 */
export class MyPlanView extends View {
  constructor(app) {
    super(app, 'moj');
    this.where = new WherePanel(app, this.root);
    this.summary = $('#mine-summary');
    this.wants = $('#mine-wants');
    this.board = $('#mine-board');

    this.on('click', '[data-away]', el => this.toggleAway(el));
    // „5 min temu” ma się zmieniać, nawet gdy stan na serwerze stoi.
    setInterval(() => { if (app.currentView === this && !document.hidden) app.render(); }, 30e3);
  }

  render() {
    const m = this.model;
    this.where.render(m);
    const wanted = m.ideas.filter(i => m.levelOf(i.id));
    const inPlan = wanted.filter(i => m.slotOf(i.id));
    const notYet = wanted.filter(i => !m.slotOf(i.id)).sort((a, b) => m.levelOf(b.id) - m.levelOf(a.id));

    this.summary.textContent = wanted.length
      ? `Punkty we wspólnym planie, które cię interesują: ${inPlan.length}. Zaznacz „Nie mogę” tam, gdzie cię nie będzie.`
      : 'Najpierw oceń pomysły w zakładce Pomysły. Tu zobaczysz, które z nich są we wspólnym planie i kiedy.';
    this.wants.innerHTML = notYet.length ? this.wantsBox(notYet) : '';
    this.board.innerHTML = board(m, part => this.cell(part));
  }

  wantsBox(ideas) {
    const m = this.model;
    return `<div class="wants"><h3>Chcesz, a nie ma tego jeszcze w planie</h3>
      <ul>${ideas.map(i => `<li class="cat-${esc(i.cat)}">${pips(m.levelOf(i.id))}${esc(i.title)}</li>`).join('')}</ul>
      <button type="button" class="btn-line" data-view="plan">Ułóż we wspólnym planie</button></div>`;
  }

  /** Pole: moje punkty (z kim idę), reszta ekipy jednym zdaniem, przycisk „Nie mogę”. */
  cell(part) {
    const m = this.model;
    const away = m.awayOf().includes(part.id);
    const ideas = m.ideasIn(part.id);
    const mine = ideas.filter(i => m.levelOf(i.id));
    const others = ideas.filter(i => !m.levelOf(i.id));
    const picks = mine.map(i => {
      const companions = m.fansOf(i.id).filter(f => f.key !== m.me);
      return `<div class="pick win cat-${esc(i.cat)}">${shape(i.cat)}<span class="pick-title">${esc(i.title)}</span>
        ${pips(m.levelOf(i.id))}
        <span class="pick-who">${companions.length ? `<span class="muted">z:</span> ${avatarsOf(companions)}` : '<span class="muted">tylko ty</span>'}</span></div>`;
    }).join('');
    const empty = !mine.length && !others.length ? '<p class="slot-none">Tu jeszcze pusto.</p>' : '';
    return {
      cls: away ? 'is-away' : '',
      html: `${picks}${empty}
        ${others.length ? `<p class="away-line">Reszta ekipy: ${esc(others.map(i => i.title).join(', '))}</p>` : ''}
        <div class="slot-foot">
          <button type="button" class="mini" data-away="${esc(part.id)}" aria-pressed="${away}">${away ? 'Nie ma mnie' : 'Nie mogę'}</button>
        </div>`,
    };
  }

  toggleAway(button) {
    if (!this.app.requireName()) return;
    this.app.send('away', { slot: button.dataset.away, away: button.getAttribute('aria-pressed') !== 'true' });
  }
}
