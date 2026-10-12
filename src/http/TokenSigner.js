'use strict';
const crypto = require('crypto');

/**
 * Bezstanowe tokeny do ciasteczek: „losowe-id.czas.podpis-HMAC”.
 * Klucz pochodzi z hasła, więc zmiana hasła unieważnia wszystkie tokeny.
 */
class TokenSigner {
  constructor(purpose, password, maxAgeDays) {
    this.key = crypto.createHash('sha256').update(purpose + '\0' + password).digest();
    this.maxAgeMs = maxAgeDays * 864e5;
    this.maxAgeSeconds = maxAgeDays * 86400;
  }

  issue() {
    const id = crypto.randomBytes(16).toString('base64url') + '.' + Date.now().toString(36);
    return id + '.' + this.sign(id);
  }

  verify(token) {
    if (!token) return false;
    const dot = token.lastIndexOf('.');
    if (dot < 0) return false;
    const id = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(this.sign(id));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
    const issuedAt = parseInt(id.split('.')[1], 36);
    return Date.now() - issuedAt < this.maxAgeMs;
  }

  sign(id) {
    return crypto.createHmac('sha256', this.key).update(id).digest('base64url');
  }
}

module.exports = TokenSigner;
