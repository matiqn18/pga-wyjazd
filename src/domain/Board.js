'use strict';
const Service = require('./Service');
const UserError = require('../util/UserError');

/** Wspólny plan (dni × pory) i „nie mogę” poszczególnych osób. */
class Board extends Service {
  get slots() {
    return this.data.board.slots;
  }

  slotOf(ideaId) {
    for (const [slot, ids] of Object.entries(this.slots)) if (ids.includes(ideaId)) return slot;
    return null;
  }

  unplace(ideaId) {
    for (const slot of Object.keys(this.slots)) {
      this.slots[slot] = this.slots[slot].filter(x => x !== ideaId);
      if (!this.slots[slot].length) delete this.slots[slot];
    }
  }

  requireSlot(slot) {
    if (!this.config.schedule.has(slot)) UserError.fail('Nie ma takiego pola.');
    return slot;
  }

  /** Wstawia pomysł w pole na pozycję `index` (albo zdejmuje, gdy `slot` = null). Może każdy. */
  place(actor, idea, slot, index) {
    const to = slot == null ? null : this.requireSlot(String(slot));
    const from = this.slotOf(idea.id);
    this.unplace(idea.id);
    if (to) {
      const list = this.slots[to] || (this.slots[to] = []);
      const at = Number.isInteger(index) && index >= 0 ? Math.min(index, list.length) : list.length;
      list.splice(at, 0, idea.id);
    }
    if (from === to) return; // sama zmiana kolejności w polu nie trafia do historii
    if (to) this.record(actor, 'place', { idea: idea.title, ...(from ? { from } : {}), to });
    else this.record(actor, 'unplace', { idea: idea.title, from });
  }

  setAway(actor, rawSlot, away) {
    const slot = this.requireSlot(String(rawSlot ?? ''));
    const plan = this.data.plans[actor.key] || (this.data.plans[actor.key] = { away: [], updatedAt: 0 });
    plan.updatedAt = Date.now();
    if (Boolean(away) === plan.away.includes(slot)) return;
    plan.away = away ? [...plan.away, slot] : plan.away.filter(s => s !== slot);
    this.record(actor, away ? 'away' : 'back', { to: slot });
  }
}

module.exports = Board;
