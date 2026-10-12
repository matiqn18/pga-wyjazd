'use strict';
const crypto = require('crypto');
const Service = require('./Service');
const UserError = require('../util/UserError');
const { clean, newId } = require('../util/text');

/** „12,50”, „12.5”, „12 zł” → 1250 groszy. */
function parseGrosze(value) {
  const s = String(value ?? '').replace(/\s|zł|pln/gi, '').replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) UserError.fail('Podaj kwotę, np. 120 albo 45,50.');
  const grosze = Math.round(Number(s) * 100);
  if (grosze <= 0) UserError.fail('Kwota musi być większa od zera.');
  return grosze;
}

/**
 * Wspólne wydatki dzielone po równo między osoby z `split`.
 * Zwrot (`settle`) to wydatek bez nazwy: `payer` oddaje pieniądze jedynej osobie w `split`.
 */
class Expenses extends Service {
  constructor(trip, people) {
    super(trip);
    this.people = people;
  }

  find(id) {
    return this.data.expenses.find(x => x.id === id) || UserError.fail('Tego wydatku już nie ma.');
  }

  fields(input, settle) {
    const amount = parseGrosze(input.amount);
    const payer = this.people.require(input.payer, 'kto płaci');
    if (!Array.isArray(input.split) || !input.split.length) UserError.fail('Zaznacz, kto się składa.');
    const split = [...new Set(input.split.map(k => this.people.require(k, 'kto się składa')))];
    if (settle && (split.length !== 1 || split[0] === payer)) UserError.fail('Zwrot musi iść od jednej osoby do innej.');
    const title = settle ? 'Zwrot' : clean(input.title, 60);
    if (!title) UserError.fail('Wpisz, za co.');
    return { title, amount, payer, split };
  }

  add(actor, input) {
    const settle = Boolean(input.settle);
    const f = this.fields(input, settle);
    this.data.expenses.push({ id: newId(crypto), ...f, byKey: actor.key, at: Date.now(), ...(settle ? { settle } : {}) });
    const payer = this.people.nameOf(f.payer);
    if (settle) this.record(actor, 'settle', { amount: f.amount, payer, to: this.people.nameOf(f.split[0]) });
    else this.record(actor, 'expense', { idea: f.title, amount: f.amount, payer, n: f.split.length });
  }

  edit(actor, ctx, id, input) {
    const x = this.find(id);
    const asAdmin = this.authorize(x.byKey, actor, ctx, 'Wydatek może edytować tylko osoba, która go dodaje.');
    const f = this.fields(input, Boolean(x.settle));
    const unchanged = f.title === x.title && f.amount === x.amount && f.payer === x.payer && f.split.join() === x.split.join();
    if (unchanged) return;
    Object.assign(x, f);
    this.record(actor, 'expense_edit', { idea: x.settle ? 'Zwrot' : x.title, amount: x.amount, ...asAdmin });
  }

  remove(actor, ctx, id) {
    const x = this.find(id);
    const asAdmin = this.authorize(x.byKey, actor, ctx, 'Wydatek może usunąć tylko osoba, która go dodaje.');
    this.data.expenses = this.data.expenses.filter(e => e !== x);
    this.record(actor, 'expense_del', { idea: x.title, amount: x.amount, ...asAdmin });
  }
}

module.exports = Expenses;
