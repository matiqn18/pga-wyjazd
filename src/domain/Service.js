'use strict';
const UserError = require('../util/UserError');

/**
 * Baza serwisów domenowych. Dane czyta zawsze przez `this.data`
 * (po wycofaniu transakcji Trip podmienia cały obiekt danych).
 */
class Service {
  constructor(trip) {
    this.trip = trip;
  }

  get data() {
    return this.trip.data;
  }

  get config() {
    return this.trip.config;
  }

  record(actor, type, extra) {
    this.trip.history.record(actor.name, type, extra);
  }

  /**
   * Zmiana cudzej rzeczy wymaga trybu admina.
   * Zwraca dopisek do zdarzenia: `{ admin: true }`, gdy działa admin, inaczej `{}`.
   */
  authorize(ownerKey, actor, ctx, message) {
    if (ownerKey === actor.key) return {};
    if (ctx.admin) return { admin: true };
    return UserError.fail(message);
  }

  requireAdmin(ctx) {
    if (!ctx.admin) UserError.fail('To może zrobić tylko admin.');
  }
}

module.exports = Service;
