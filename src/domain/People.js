'use strict';
const Service = require('./Service');
const UserError = require('../util/UserError');
const { clean, keyOf } = require('../util/text');

/**
 * Osoby z ekipy. Bez kont: osoba to imię wysłane z przeglądarki.
 * `actor` w innych serwisach to `{ key, name }` zwrócone przez `resolve`.
 */
class People extends Service {
  /** Osoba wykonująca akcję; pierwsza akcja z nowym imieniem dopisuje osobę do ekipy. */
  resolve(rawName) {
    const name = clean(rawName, 24);
    if (!name) UserError.fail('Najpierw podaj imię.');
    const key = this.canonicalKey(keyOf(name));
    if (!this.data.people[key]) {
      this.data.people[key] = { name, joinedAt: Date.now() };
      this.trip.history.record(name, 'join');
    }
    return { key, name: this.data.people[key].name };
  }

  /** Stare imię po zmianie przez admina prowadzi do tej samej osoby. */
  canonicalKey(key) {
    const target = this.data.aliases[key];
    return target && this.data.people[target] ? target : key;
  }

  /** Klucz istniejącej osoby z danych od klienta; `role` trafia do komunikatu błędu. */
  require(key, role) {
    key = String(key ?? '');
    if (!Object.hasOwn(this.data.people, key)) UserError.fail(`Nie ma takiej osoby (${role}).`);
    return key;
  }

  nameOf(key) {
    return this.data.people[key].name;
  }

  rename(actor, ctx, key, rawName) {
    this.requireAdmin(ctx);
    key = this.require(key, 'zmiana imienia');
    const name = clean(rawName, 24);
    if (!name) UserError.fail('Wpisz nowe imię.');
    const old = this.nameOf(key);
    if (name === old) return;
    const newKey = keyOf(name);
    if (newKey !== key) {
      if (this.data.people[newKey]) UserError.fail(`Osoba „${this.nameOf(newKey)}” już jest.`);
      this.rekey(key, newKey);
    }
    this.data.people[newKey].name = name;
    for (const idea of this.data.ideas) if (idea.byKey === newKey) idea.by = name;
    this.record(actor, 'person_rename', { from: old, to: name, admin: true });
  }

  remove(actor, ctx, key) {
    this.requireAdmin(ctx);
    key = this.require(key, 'usuwanie');
    if (key === actor.key) UserError.fail('Nie możesz usunąć samego siebie.');
    if (this.data.expenses.some(x => x.payer === key || x.split.includes(key))) {
      UserError.fail('Ta osoba ma wydatki. Najpierw je usuń albo zmień, potem usuń osobę.');
    }
    const name = this.nameOf(key);
    const d = this.data;
    delete d.people[key];
    delete d.plans[key];
    delete d.locations[key];
    for (const [id, votes] of Object.entries(d.interest)) {
      delete votes[key];
      if (!Object.keys(votes).length) delete d.interest[id];
    }
    for (const [from, to] of Object.entries(d.aliases)) if (from === key || to === key) delete d.aliases[from];
    this.record(actor, 'person_del', { to: name, admin: true });
  }

  /** Przenosi osobę na nowy klucz we wszystkich miejscach i zapamiętuje alias starego. */
  rekey(from, to) {
    const d = this.data;
    const move = (map) => { if (from in map) { map[to] = map[from]; delete map[from]; } };
    move(d.people);
    move(d.plans);
    move(d.locations);
    for (const votes of Object.values(d.interest)) move(votes);
    for (const idea of d.ideas) if (idea.byKey === from) idea.byKey = to;
    for (const x of d.expenses) {
      if (x.payer === from) x.payer = to;
      if (x.byKey === from) x.byKey = to;
      x.split = x.split.map(k => (k === from ? to : k));
    }
    for (const [alias, target] of Object.entries(d.aliases)) if (target === from) d.aliases[alias] = to;
    delete d.aliases[to];
    d.aliases[from] = to;
  }
}

module.exports = People;
