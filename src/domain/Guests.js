'use strict';
const Service = require('./Service');
const UserError = require('../util/UserError');
const { clean, keyOf } = require('../util/text');

/**
 * Goście z podstrony /gdzie (osobne hasło). Osobna grupa: ekipa ich nie widzi,
 * a oni widzą tylko siebie nawzajem. Nie trafiają do historii ekipy.
 */
class Guests extends Service {
  /** Gość wykonujący akcję; pierwsza akcja z nowym imieniem dopisuje go do listy. */
  resolve(rawName) {
    const name = clean(rawName, 24);
    if (!name) UserError.fail('Najpierw podaj imię.');
    const key = keyOf(name);
    if (!this.data.guests[key]) this.data.guests[key] = { name, joinedAt: Date.now() };
    return { key, name: this.data.guests[key].name };
  }
}

module.exports = Guests;
