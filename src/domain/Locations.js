'use strict';
const Service = require('./Service');
const UserError = require('../util/UserError');
const { clean } = require('../util/text');

const round5 = x => Math.round(x * 1e5) / 1e5;

/**
 * „Jestem tutaj”: jednorazowo udostępniona pozycja, ważna Trip.LOCATION_TTL.
 * `field` = mapa w danych (ekipa: `locations`, goście: `guestLocations`);
 * `log: false` = bez wpisów w historii ekipy.
 */
class Locations extends Service {
  constructor(trip, ttl, { field = 'locations', log = true } = {}) {
    super(trip);
    this.ttl = ttl;
    this.field = field;
    this.log = log;
  }

  get map() {
    return this.data[this.field];
  }

  share(actor, { lat, lng, acc, note }) {
    lat = Number(lat);
    lng = Number(lng);
    acc = Number(acc);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      UserError.fail('Niepoprawna lokalizacja.');
    }
    const entry = {
      lat: round5(lat),
      lng: round5(lng),
      acc: Number.isFinite(acc) && acc > 0 ? Math.min(Math.round(acc), 100000) : 0,
      note: clean(note, 60),
      t: Date.now(),
    };
    this.map[actor.key] = entry;
    this.dropExpired();
    // Współrzędne nie trafiają do historii, tylko sam fakt udostępnienia.
    if (this.log) this.record(actor, 'locate', entry.note ? { note: entry.note } : {});
  }

  clear(actor) {
    if (!this.map[actor.key]) return;
    delete this.map[actor.key];
    if (this.log) this.record(actor, 'locate_off');
  }

  dropExpired() {
    const now = Date.now();
    for (const [key, l] of Object.entries(this.map)) if (now - l.t >= this.ttl) delete this.map[key];
  }
}

module.exports = Locations;
