'use strict';

/** Okna, w których kolejne zdarzenia tej samej osoby łączą się w jedno. */
const MERGE_WINDOWS = {
  interest: { ms: 60e3, sameIdea: true },   // kilka szybkich zmian oceny tego samego pomysłu
  locate: { ms: 10 * 60e3, sameIdea: false }, // kolejne „Jestem tutaj”
};

/** Historia zdarzeń: kto, co i kiedy. Nic z niej nie znika. */
class History {
  constructor(trip) {
    this.trip = trip;
  }

  get events() {
    return this.trip.data.events;
  }

  record(who, type, extra = {}) {
    const event = { t: Date.now(), who, type, ...extra };
    if (this.mergesWithLast(event)) this.events[this.events.length - 1] = event;
    else this.events.push(event);
  }

  mergesWithLast(event) {
    const last = this.events[this.events.length - 1];
    const rule = MERGE_WINDOWS[event.type];
    if (!rule || !last || last.type !== event.type || last.who !== event.who) return false;
    if (rule.sameIdea && last.id !== event.id) return false;
    return event.t - last.t < rule.ms;
  }
}

module.exports = History;
