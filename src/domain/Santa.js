'use strict';
const crypto = require('crypto');
const Service = require('./Service');
const UserError = require('../util/UserError');
const { clean } = require('../util/text');

const MIN_PEOPLE = 3;
const BOX_SIZE = 2048; // każdy los ma tę samą długość, żeby rozmiar nie zdradzał adresata
const B64_32 = /^[A-Za-z0-9_-]{43}$/; // 32 bajty w base64url

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

/**
 * Mikołajki: zapisy (dane do paczki) i losowanie, którego wyniku nie zna nikt poza losującym.
 *
 * Przy zapisie przeglądarka tworzy parę kluczy ECDH P-256: prywatny zostaje u niej,
 * serwer dostaje publiczny i skrót tokenu (token = dowód, że to ta sama przeglądarka).
 * Losowanie: jeden cykl (nikt nie losuje siebie ani osoby, która losuje jego), a dane
 * wylosowanej osoby trafiają do „pudełka” zaszyfrowanego kluczem publicznym losującego
 * (ECIES: ECDH + HKDF + AES-256-GCM). Par „kto kogo” nie ma nigdzie w danych.
 *
 * Model (`data.santa`):
 *   people   { [klucz]: { pub: { x, y }, auth, contact, at } }   auth = sha256(token)
 *   boxes    { [klucz losującego]: { epk: { x, y }, iv, ct } }
 *   drawnAt  czas losowania albo null
 */
class Santa extends Service {
  get santa() {
    return this.data.santa;
  }

  get drawn() {
    return Boolean(this.santa.drawnAt);
  }

  /** Zapis albo zmiana własnych danych (tylko przed losowaniem, tylko tym samym tokenem). */
  join(actor, { pub, token, contact }) {
    if (this.drawn) UserError.fail('Losowanie już było. Zmiany są możliwe dopiero po cofnięciu losowania.');
    const auth = sha256(Santa.requireToken(token));
    const existing = this.santa.people[actor.key];
    if (existing && !Santa.sameHash(existing.auth, auth)) {
      UserError.fail('Ta osoba jest już zapisana na innym urządzeniu. Otwórz link z kluczem albo poproś admina o usunięcie z listy.');
    }
    const entry = { pub: Santa.requirePublicKey(pub), auth, contact: Santa.cleanContact(contact), at: existing ? existing.at : Date.now() };
    this.santa.people[actor.key] = entry;
    if (!existing) this.record(actor, 'santa_join');
  }

  leave(actor, { token }) {
    if (this.drawn) UserError.fail('Losowanie już było.');
    this.requireOwn(actor, token);
    delete this.santa.people[actor.key];
    this.record(actor, 'santa_leave');
  }

  /** Dane dla właściciela tokenu: własny kontakt i zaszyfrowany los. */
  mine(key, token) {
    const entry = this.santa.people[key];
    if (!entry) return { joined: false };
    if (!B64_32.test(String(token ?? '')) || !Santa.sameHash(entry.auth, sha256(token))) return { joined: true, keyOk: false };
    return { joined: true, keyOk: true, contact: entry.contact, box: this.santa.boxes[key] || null };
  }

  draw(actor, ctx) {
    this.requireOrganizer(ctx);
    if (this.drawn) UserError.fail('Losowanie już było.');
    const keys = Object.keys(this.santa.people);
    if (keys.length < MIN_PEOPLE) UserError.fail(`Do losowania potrzeba co najmniej ${MIN_PEOPLE} osób.`);
    // Fisher–Yates z kryptograficznym losowaniem, potem każdy daje następnemu w kolejce.
    for (let i = keys.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    const boxes = {};
    keys.forEach((giver, i) => {
      const receiver = keys[(i + 1) % keys.length];
      boxes[giver] = Santa.seal(this.santa.people[giver].pub, { name: this.data.people[receiver]?.name || receiver, ...this.santa.people[receiver].contact });
    });
    // Kolejność wpisów jak na liście zapisów, nie jak w losowaniu.
    this.santa.boxes = Object.fromEntries(Object.keys(this.santa.people).map(k => [k, boxes[k]]));
    this.santa.drawnAt = Date.now();
    this.record(actor, 'santa_draw', { n: keys.length, ...(ctx.admin ? { admin: true } : {}) });
  }

  undraw(actor, ctx) {
    this.requireOrganizer(ctx);
    if (!this.drawn) return;
    this.santa.boxes = {};
    this.santa.drawnAt = null;
    this.record(actor, 'santa_undraw', ctx.admin ? { admin: true } : {});
  }

  /** Usunięcie kogoś z listy (np. zgubiony klucz) – tylko przed losowaniem. */
  remove(actor, ctx, key) {
    this.requireOrganizer(ctx);
    if (this.drawn) UserError.fail('Najpierw cofnij losowanie.');
    key = String(key ?? '');
    if (!this.santa.people[key]) UserError.fail('Tej osoby nie ma na liście.');
    delete this.santa.people[key];
    this.record(actor, 'santa_remove', { to: this.data.people[key]?.name || key, ...(ctx.admin ? { admin: true } : {}) });
  }

  /** Bez ADMIN_PASSWORD losować i porządkować listę może każdy, z nim – tylko admin. */
  requireOrganizer(ctx) {
    if (this.config.adminEnabled) this.requireAdmin(ctx);
  }

  requireOwn(actor, token) {
    const entry = this.santa.people[actor.key];
    if (!entry) UserError.fail('Nie ma cię na liście.');
    if (!Santa.sameHash(entry.auth, sha256(Santa.requireToken(token)))) UserError.fail('Na tym urządzeniu nie ma twojego klucza.');
  }

  // ---------- walidacja i szyfrowanie ----------

  static requireToken(token) {
    if (!B64_32.test(String(token ?? ''))) UserError.fail('Brak klucza z tego urządzenia.');
    return token;
  }

  static requirePublicKey(pub) {
    const x = String(pub?.x ?? ''), y = String(pub?.y ?? '');
    if (!B64_32.test(x) || !B64_32.test(y)) UserError.fail('Niepoprawny klucz.');
    try {
      crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x, y }, format: 'jwk' });
    } catch {
      UserError.fail('Niepoprawny klucz.');
    }
    return { x, y };
  }

  static cleanContact(c = {}) {
    const digits = String(c.phone ?? '').replace(/[\s()-]/g, '').replace(/^(\+48|0048)/, '');
    if (!/^\d{9}$/.test(digits)) UserError.fail('Podaj numer telefonu (9 cyfr).');
    const email = clean(c.email, 80);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) UserError.fail('Niepoprawny e-mail.');
    const locker = clean(c.locker, 16).toUpperCase();
    if (!/^[A-Z0-9-]{4,16}$/.test(locker)) UserError.fail('Wybierz paczkomat (np. KRA01M).');
    return {
      fullName: clean(c.fullName, 60),
      phone: digits.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3'),
      email,
      locker,
      lockerAddress: clean(c.lockerAddress, 140),
      wish: clean(c.wish, 300),
    };
  }

  static sameHash(a, b) {
    return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  /** ECIES dla klucza publicznego P-256; odpowiednik w przeglądarce: public/js/core/SantaKey.js. */
  static seal(pub, payload) {
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    if (json.length > BOX_SIZE) UserError.fail('Za dużo danych w zapisie.');
    const plain = Buffer.concat([json, Buffer.alloc(BOX_SIZE - json.length, 0x20)]);
    const eph = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const recipient = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', ...pub }, format: 'jwk' });
    const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
    const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), 'pga-mikolaj', 32));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    const { x, y } = eph.publicKey.export({ format: 'jwk' });
    return { epk: { x, y }, iv: iv.toString('base64url'), ct: ct.toString('base64url') };
  }
}

module.exports = Santa;
