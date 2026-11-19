'use strict';
const History = require('./History');
const { SCHEMA, migrate } = require('./migrations');

const LOCATION_TTL = 2 * 3600e3;

const fresh = (locations, now) => Object.fromEntries(Object.entries(locations).filter(([, l]) => now - l.t < LOCATION_TTL));

/**
 * Stan całego wyjazdu (to, co ląduje w pliku JSON) i operacje na nim jako całości:
 * wczytanie z migracją, transakcja z wycofaniem zmian, widok publiczny.
 *
 * Model danych:
 *   people     { [klucz]: { name, joinedAt } }                  klucz = imię małymi literami
 *   ideas      [ { id, title, note, link, cat, by, byKey, at } ]
 *   interest   { [ideaId]: { [klucz]: 1|2|3 } }                 3 = bardzo chcę, 2 = chętnie, 1 = mogę
 *   board      { slots: { [slotId]: [ideaId] } }                jeden wspólny plan
 *   plans      { [klucz]: { away: [slotId], updatedAt } }        „nie mogę”
 *   locations  { [klucz]: { lat, lng, acc, note, t } }           ważne LOCATION_TTL
 *   expenses   [ { id, title, amount, payer, split, settle?, byKey, at } ]   kwoty w groszach
 *   aliases    { [stary klucz]: nowy klucz }                     po zmianie imienia przez admina
 *   events     [ { t, who, type, … } ]
 *   guests          { [klucz]: { name, joinedAt } }        goście z /gdzie, osobno od ekipy
 *   guestLocations  { [klucz]: { lat, lng, acc, note, t } }
 *   santa      { people, boxes, drawnAt }                         Mikołajki – szczegóły w Santa.js
 *   v          numer wersji, rośnie przy każdej zmianie
 */
class Trip {
  static LOCATION_TTL = LOCATION_TTL;

  static emptyData() {
    return {
      schema: SCHEMA, v: 1, people: {}, ideas: [], interest: {}, board: { slots: {} },
      plans: {}, locations: {}, expenses: [], aliases: {}, events: [],
      guests: {}, guestLocations: {},
      santa: { people: {}, boxes: {}, drawnAt: null },
    };
  }

  /** Wczytuje stan z magazynu, migruje i od razu zapisuje, jeśli migracja coś zmieniła. */
  static load(store, config) {
    const saved = store.read();
    const data = { ...Trip.emptyData(), ...(saved || {}) };
    const trip = new Trip(data, config);
    if (saved && migrate(data, { schedule: config.schedule, categories: config.categories })) store.write(data);
    return trip;
  }

  constructor(data, config) {
    this.data = data;
    this.config = config;
    this.history = new History(this);
  }

  get version() {
    return this.data.v;
  }

  /**
   * Wykonuje zmianę w całości albo wcale: przy błędzie przywraca stan sprzed zmiany.
   * Zwraca true, jeśli stan się zmienił (wtedy podbija wersję).
   */
  transaction(change) {
    const before = JSON.stringify(this.data);
    try {
      change();
    } catch (e) {
      this.data = JSON.parse(before);
      throw e;
    }
    if (JSON.stringify(this.data) === before) return false;
    this.data.v++;
    return true;
  }

  /** To, co widzi przeglądarka: bez wygasłych lokalizacji, osoby jako lista. */
  toPublic() {
    const d = this.data;
    const now = Date.now();
    return {
      v: d.v,
      config: { title: this.config.title, days: this.config.schedule.days, cats: this.config.categories },
      people: Object.entries(d.people)
        .map(([key, p]) => ({ key, name: p.name, joinedAt: p.joinedAt }))
        .sort((a, b) => a.joinedAt - b.joinedAt),
      ideas: d.ideas,
      interest: d.interest,
      board: d.board,
      plans: d.plans,
      locations: fresh(d.locations, now),
      expenses: d.expenses,
      aliases: d.aliases,
      events: d.events,
      // Mikołajki: tylko kto jest na liście; dane do paczki i losy są poza widokiem publicznym.
      santa: {
        drawnAt: d.santa.drawnAt,
        people: Object.entries(d.santa.people).map(([key, p]) => ({ key, at: p.at })).sort((a, b) => a.at - b.at),
      },
    };
  }

  /** To, co widzi gość na /gdzie: tylko goście i ich lokalizacje. */
  toGuestPublic() {
    const d = this.data;
    return {
      v: d.v,
      config: { title: this.config.title },
      people: Object.entries(d.guests)
        .map(([key, p]) => ({ key, name: p.name, joinedAt: p.joinedAt }))
        .sort((a, b) => a.joinedAt - b.joinedAt),
      locations: fresh(d.guestLocations, Date.now()),
    };
  }
}

module.exports = Trip;
