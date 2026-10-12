import { $, $$, esc } from '../core/dom.js';
import { osoby, shortTime, zl } from '../core/format.js';
import { avatar, personOptions, personPicker } from '../ui/components.js';
import { View } from './View.js';

/**
 * Zakładka „Wydatki”: dodawanie (kto płaci, ile, kto się składa), kto komu oddaje,
 * bilans i lista. Kwoty w groszach, podział po równo.
 */
export class ExpensesView extends View {
  constructor(app) {
    super(app, 'wydatki');
    this.form = $('#exp');
    this.payer = $('#exp-payer');
    this.split = $('#exp-split');
    this.amount = $('#exp-amount');
    this.sharePreview = $('#exp-share');
    this.summary = $('#exp-summary');
    this.settle = $('#exp-settle');
    this.balance = $('#exp-balance');
    this.list = $('#exp-list');
    this.peopleSignature = ''; // lista osób, dla której zbudowano pola wyboru

    this.on('click', '[data-settle]', el => this.markSettled(el.dataset.settle));
    this.on('click', '[data-exp-edit]', el => this.edit(el.dataset.expEdit));
    this.on('click', '[data-exp-del]', el => this.remove(el.dataset.expDel));
    this.on('click', '#exp-all', () => this.toggleAll());
    this.amount.addEventListener('input', () => this.updateSharePreview());
    this.split.addEventListener('change', () => this.updateSharePreview());
    this.onSubmit(this.form, form => this.add(form));
  }

  render() {
    const m = this.model;
    this.syncPickers();
    this.summary.textContent = m.expenses.length
      ? `Razem wydane: ${zl(m.totalSpent())}. Każdy wydatek dzieli się po równo między osoby, które się składają.`
      : 'Nikt jeszcze nic nie wpisał. Dodaj pierwszy wydatek: kto płaci, ile i kto się składa.';
    const balances = m.balances();
    this.settle.innerHTML = m.expenses.length ? this.settleBox(m.transfers(balances)) : '';
    this.balance.innerHTML = m.people.map(p => this.balanceRow(p, balances[p.key] || 0)).join('');
    this.list.innerHTML = [...m.expenses].reverse().map(x => this.expenseCard(x)).join('') || '<p class="muted">Lista jest pusta.</p>';
  }

  settleBox(transfers) {
    if (!transfers.length) return '<div class="settle"><h3>Wszyscy są rozliczeni</h3></div>';
    const m = this.model;
    const rows = transfers.map(t => `<li class="${t.from === m.me || t.to === m.me ? 'mine' : ''}">
      ${avatar(m.nameOf(t.from))}<span><strong>${esc(m.nameOf(t.from))}</strong> → <strong>${esc(m.nameOf(t.to))}</strong></span>
      <span class="amt">${esc(zl(t.amount))}</span>
      <button type="button" class="mini" data-settle="${esc(t.from)}|${esc(t.to)}|${t.amount}">Oddane</button></li>`);
    return `<div class="settle"><h3>Kto komu oddaje</h3><ul>${rows.join('')}</ul></div>`;
  }

  balanceRow(person, value) {
    const cls = value > 0 ? 'plus' : value < 0 ? 'minus' : '';
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `<div class="bal ${cls}">${avatar(person.name)}<span>${esc(person.name)}${person.key === this.model.me ? ' (ty)' : ''}</span>
      <span class="amt">${sign}${esc(zl(Math.abs(value)))}</span></div>`;
  }

  expenseCard(x) {
    const m = this.model;
    const each = Math.min(...Object.values(m.sharesOf(x)));
    const title = x.settle ? `Zwrot: ${esc(m.nameOf(x.payer))} → ${esc(m.nameOf(x.split[0]))}` : esc(x.title);
    const details = x.settle ? '' : `płaci ${esc(m.nameOf(x.payer))} · ${osoby(x.split.length)} po ${esc(zl(each))} · `;
    const who = x.settle ? '' : `<span class="idea-who">${x.split.map(k => avatar(m.nameOf(k))).join('')}</span>`;
    const actions = m.canEdit(x) ? `<span class="own-actions">
      <button type="button" class="mini" data-exp-edit="${esc(x.id)}">Edytuj</button>
      <button type="button" class="mini" data-exp-del="${esc(x.id)}">Usuń</button></span>` : '';
    return `<article class="exp ${x.settle ? 'is-settle' : ''}">
      <div class="exp-head"><strong>${title}</strong><span class="amt">${esc(zl(x.amount))}</span></div>
      <small>${details}${esc(shortTime(x.at))}</small>
      <div class="exp-foot">${who}${actions}</div>
    </article>`;
  }

  // ---------- formularz ----------

  /**
   * Pola „kto płaci” i „kto się składa” przebudowują się tylko, gdy zmienia się lista osób,
   * i zachowują zaznaczenia. Nowe osoby są od razu zaznaczone.
   */
  syncPickers() {
    const people = this.model.people;
    const signature = people.map(p => p.key + ':' + p.name).join('|');
    if (signature === this.peopleSignature) return;
    const firstBuild = !this.peopleSignature;
    const previousPayer = this.payer.value || this.model.me;
    const checked = new Set(this.checkedKeys());
    const known = new Set(this.peopleSignature.split('|').map(s => s.split(':')[0]));

    this.payer.innerHTML = personOptions(people);
    this.payer.value = people.some(p => p.key === previousPayer) ? previousPayer : (people[0] || {}).key || '';
    this.split.innerHTML = personPicker(people, { checked: p => firstBuild || checked.has(p.key) || !known.has(p.key) });
    this.peopleSignature = signature;
    this.updateSharePreview();
  }

  checkedKeys() {
    return $$('input:checked', this.split).map(i => i.value);
  }

  toggleAll() {
    const boxes = $$('input', this.split);
    const allChecked = boxes.every(b => b.checked);
    for (const b of boxes) b.checked = !allChecked;
    this.updateSharePreview();
  }

  /** „3 osoby, po 40,00 zł” pod formularzem, liczone na bieżąco. */
  updateSharePreview() {
    const n = this.checkedKeys().length;
    const text = this.amount.value.replace(/\s|zł/gi, '').replace(',', '.');
    const grosze = /^\d+(\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : 0;
    if (!n) this.sharePreview.textContent = 'Zaznacz co najmniej jedną osobę.';
    else if (!grosze) this.sharePreview.textContent = `Podzieli się po równo na ${osoby(n)}.`;
    else {
      const rest = grosze % n ? ' (grosze reszty rozkładają się na pierwsze osoby)' : '';
      this.sharePreview.textContent = `${osoby(n)}, po ${zl(Math.floor(grosze / n))}${rest}.`;
    }
  }

  // ---------- akcje ----------

  async add(form) {
    if (!this.app.requireName()) return;
    const split = this.checkedKeys();
    if (!split.length) return this.app.toast.show('Zaznacz, kto się składa.');
    const saved = await this.app.send('expense', { title: form.title.value, amount: form.amount.value, payer: form.payer.value, split });
    if (saved) {
      form.title.value = '';
      form.amount.value = '';
      this.updateSharePreview();
      form.title.focus();
      this.app.toast.show('Wydatek dodany.');
    }
  }

  /** „Oddane” zapisuje zwrot: dłużnik płaci wierzycielowi dokładnie tę kwotę. */
  markSettled(spec) {
    const m = this.model;
    const [from, to, amount] = spec.split('|');
    if (confirm(`Zapisać, że ${m.nameOf(from)} oddaje ${m.nameOf(to)} ${zl(Number(amount))}?`)) {
      this.app.send('expense', { payer: from, split: [to], amount: (Number(amount) / 100).toFixed(2), settle: true });
    }
  }

  edit(id) {
    const expense = this.model.expenses.find(x => x.id === id);
    if (expense) this.app.dialogs.expenseEdit.openFor(expense);
  }

  remove(id) {
    const x = this.model.expenses.find(e => e.id === id);
    if (x && confirm(`Usunąć wydatek „${x.title}” (${zl(x.amount)})?`)) this.app.send('expenseDelete', { id: x.id });
  }
}
