'use strict';

/** Limit nieudanych prób (np. hasła): `limit` na adres IP w oknie `windowMs`. */
class RateLimiter {
  constructor({ limit = 8, windowMs = 10 * 60e3 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.failures = new Map();
    setInterval(() => this.prune(), windowMs).unref();
  }

  isBlocked(ip) {
    return this.recent(ip).length >= this.limit;
  }

  recordFailure(ip) {
    this.failures.set(ip, [...this.recent(ip), Date.now()]);
  }

  recent(ip) {
    const now = Date.now();
    return (this.failures.get(ip) || []).filter(t => now - t < this.windowMs);
  }

  prune() {
    for (const ip of this.failures.keys()) if (!this.recent(ip).length) this.failures.delete(ip);
  }
}

module.exports = RateLimiter;
