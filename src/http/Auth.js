'use strict';
const crypto = require('crypto');
const TokenSigner = require('./TokenSigner');
const RateLimiter = require('./RateLimiter');

const LOCAL_PEER = /^(::1|127\.|::ffff:127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::ffff:(10|172|192)\.)/;

/**
 * Dwa poziomy dostępu, oba przez ciasteczka HttpOnly:
 *   – „sesja”: wspólne hasło ekipy (bez hasła strona jest otwarta),
 *   – „admin”: osobne hasło admina (bez niego tryb admina jest wyłączony).
 */
class Auth {
  static TEAM_COOKIE = 'sesja';
  static ADMIN_COOKIE = 'admin';

  constructor({ password, adminPassword }) {
    this.password = password;
    this.adminPassword = adminPassword;
    this.team = new TokenSigner('pga-sesja', password, 90);
    this.admin = new TokenSigner('pga-admin', adminPassword, 30);
    this.limiter = new RateLimiter();
  }

  isTeamMember(req) {
    return !this.password || this.team.verify(Auth.cookies(req)[Auth.TEAM_COOKIE]);
  }

  isAdmin(req) {
    return Boolean(this.adminPassword) && this.admin.verify(Auth.cookies(req)[Auth.ADMIN_COOKIE]);
  }

  /**
   * Sprawdza hasło z limitem prób. Zwraca 'ok', 'wrong' albo 'blocked'.
   * Porównanie skrótów w stałym czasie.
   */
  checkPassword(req, given, expected) {
    const ip = Auth.clientIp(req);
    if (this.limiter.isBlocked(ip)) return 'blocked';
    const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    if (crypto.timingSafeEqual(a, b)) return 'ok';
    this.limiter.recordFailure(ip);
    return 'wrong';
  }

  static cookie(req, name, value, maxAgeSeconds) {
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
  }

  static cookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    }
    return out;
  }

  /** Za Caddy (adres lokalny/prywatny) prawdziwy adres jest ostatni w X-Forwarded-For. */
  static clientIp(req) {
    const peer = req.socket.remoteAddress || '';
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    return LOCAL_PEER.test(peer) && forwarded.length ? forwarded[forwarded.length - 1] : peer;
  }
}

module.exports = Auth;
