import { keyOf } from './dom.js';

/** Kim jest osoba przy tym urządzeniu. Bez kont: samo imię, zapamiętane w localStorage. */
export class Identity {
  constructor(prefs) {
    this.prefs = prefs;
    this.name = prefs.get('imie');
  }

  get key() {
    return keyOf(this.name);
  }

  get known() {
    return Boolean(this.name);
  }

  set(name) {
    this.name = name.replace(/\s+/g, ' ').trim().slice(0, 24);
    this.prefs.set('imie', this.name);
  }

  /** Admin zmienił tej osobie imię – urządzenie przechodzi na nowe. */
  followAlias(state) {
    const target = this.known && (state.aliases || {})[this.key];
    const person = target && state.people.find(p => p.key === target);
    if (person) this.set(person.name);
  }
}
