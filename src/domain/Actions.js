'use strict';
const Trip = require('./Trip');
const People = require('./People');
const Board = require('./Board');
const Ideas = require('./Ideas');
const Locations = require('./Locations');
const Expenses = require('./Expenses');

/**
 * Wszystkie zmiany stanu dostępne przez API: POST /api/<nazwa>.
 * Każda akcja: ustala osobę (body.name), woła serwis domenowy, a całość
 * wykonuje się w transakcji – błąd walidacji nie zostawia połowicznych zmian.
 */
class Actions {
  constructor(trip) {
    this.trip = trip;
    this.people = new People(trip);
    this.board = new Board(trip);
    this.ideas = new Ideas(trip, this.board);
    this.locations = new Locations(trip, Trip.LOCATION_TTL);
    this.expenses = new Expenses(trip, this.people);

    /** nazwa akcji → (actor, body, ctx) => void */
    this.handlers = {
      join: () => {},

      idea: (me, b) => this.ideas.add(me, b),
      ideaEdit: (me, b, ctx) => this.ideas.edit(me, ctx, b.id, b),
      ideaDelete: (me, b, ctx) => this.ideas.remove(me, ctx, b.id),
      interest: (me, b) => this.ideas.rate(me, b.id, b.level),

      place: (me, b) => this.board.place(me, this.ideas.find(b.id), b.slot, b.index),
      away: (me, b) => this.board.setAway(me, b.slot, b.away),

      locate: (me, b) => this.locations.share(me, b),
      locateClear: (me) => this.locations.clear(me),

      expense: (me, b) => this.expenses.add(me, b),
      expenseEdit: (me, b, ctx) => this.expenses.edit(me, ctx, b.id, b),
      expenseDelete: (me, b, ctx) => this.expenses.remove(me, ctx, b.id),

      personRename: (me, b, ctx) => this.people.rename(me, ctx, b.key, b.newName),
      personDelete: (me, b, ctx) => this.people.remove(me, ctx, b.key),
    };
  }

  has(name) {
    return Object.hasOwn(this.handlers, name);
  }

  /** Wykonuje akcję; zwraca true, jeśli stan się zmienił. `ctx.admin` = tryb admina. */
  run(name, body, ctx) {
    return this.trip.transaction(() => {
      const actor = this.people.resolve(body.name);
      this.handlers[name](actor, body, ctx);
    });
  }
}

module.exports = Actions;
