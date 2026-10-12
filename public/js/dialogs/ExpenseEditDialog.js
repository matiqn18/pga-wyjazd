import { $, $$ } from '../core/dom.js';
import { personOptions, personPicker } from '../ui/components.js';
import { Dialog } from './Dialog.js';

/** Edycja wydatku (albo zwrotu: bez nazwy, jedna osoba odbierająca). Dla autora i admina. */
export class ExpenseEditDialog extends Dialog {
  constructor(app) {
    super(app, 'exp-edit');
    this.expenseId = null;
    this.titleRow = $('#exp-edit-title-wrap');
    this.split = $('#exp-edit-split');
  }

  openFor(expense) {
    const people = this.app.state.people;
    const f = this.form;
    this.expenseId = expense.id;
    this.titleRow.hidden = Boolean(expense.settle);
    f.title.value = expense.settle ? '' : expense.title;
    f.amount.value = (expense.amount / 100).toFixed(2).replace('.', ',');
    f.payer.innerHTML = personOptions(people);
    f.payer.value = expense.payer;
    this.split.innerHTML = personPicker(people, {
      type: expense.settle ? 'radio' : 'checkbox',
      name: 'split',
      checked: p => expense.split.includes(p.key),
    });
    this.open();
  }

  async submit() {
    const f = this.form;
    const split = $$('input:checked', this.split).map(i => i.value);
    if (!split.length) return this.app.toast.show('Zaznacz, kto się składa.');
    const saved = await this.app.send('expenseEdit', { id: this.expenseId, title: f.title.value, amount: f.amount.value, payer: f.payer.value, split });
    if (saved) {
      this.close();
      this.app.toast.show('Zapisane.');
    }
  }
}
