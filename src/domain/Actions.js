'use strict';
const Trip = require('./Trip');
const People = require('./People');
const Board = require('./Board');
const Ideas = require('./Ideas');
const Locations = require('./Locations');
const Expenses = require('./Expenses');
const Guests = require('./Guests');
const Santa = require('./Santa');

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
    this.santa = new Santa(trip);

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

      santaJoin: (me, b) => this.santa.join(me, b),
      santaLeave: (me, b) => this.santa.leave(me, b),
      santaDraw: (me, b, ctx) => this.santa.draw(me, ctx),
      santaUndraw: (me, b, ctx) => this.santa.undraw(me, ctx),
      santaRemove: (me, b, ctx) => this.santa.remove(me, ctx, b.key),

      personRename: (me, b, ctx) => this.people.rename(me, ctx, b.key, b.newName),
      personDelete: (me, b, ctx) => this.people.remove(me, ctx, b.key),
    };

    // Goście (POST /api/guest/<nazwa>): tylko własna lista lokalizacji.
    this.guests = new Guests(trip);
    this.guestLocations = new Locations(trip, Trip.LOCATION_TTL, { field: 'guestLocations', log: false });
    this.guestHandlers = {
      join: () => {},
      locate: (me, b) => this.guestLocations.share(me, b),
      locateClear: (me) => this.guestLocations.clear(me),
    };
  }

  has(name) {
    return Object.hasOwn(this.handlers, name);
  }

  hasGuest(name) {
    return Object.hasOwn(this.guestHandlers, name);
  }

  /** Akcja gościa; zwraca true, jeśli stan się zmienił. */
  runGuest(name, body) {
    return this.trip.transaction(() => {
      const actor = this.guests.resolve(body.name);
      this.guestHandlers[name](actor, body);
    });
  }

  /** Osoba z imienia poza akcjami stanu (np. przy zdjęciach); `changed` = nowa osoba w ekipie. */
  actor(name) {
    let actor;
    const changed = this.trip.transaction(() => { actor = this.people.resolve(name); });
    return { actor, changed };
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
