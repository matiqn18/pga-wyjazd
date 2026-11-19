/**
 * Klucz Mikołajek: para ECDH P-256 tworzona w przeglądarce. Prywatna część nie opuszcza
 * urządzenia (poza linkiem zapasowym, który osoba zapisuje sama). Serwer zna tylko
 * klucz publiczny i skrót tokenu. Odpowiednik po stronie serwera: Santa.seal().
 */
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const text = new TextEncoder();

const toB64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export class SantaKey {
  /** Czy przeglądarka to umie (WebCrypto działa tylko na https albo localhost). */
  static get supported() {
    return Boolean(window.isSecureContext && crypto.subtle);
  }

  static async generate() {
    const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
    const { d, x, y } = await crypto.subtle.exportKey('jwk', pair.privateKey);
    return new SantaKey(d, x, y);
  }

  /** Klucz z kodu (96 bajtów: d, x, y); rzuca błąd, gdy kod jest zły. */
  static async fromCode(code) {
    const bytes = fromB64(String(code).trim());
    if (bytes.length !== 96) throw new Error('Zły kod klucza.');
    const key = new SantaKey(toB64(bytes.slice(0, 32)), toB64(bytes.slice(32, 64)), toB64(bytes.slice(64)));
    await key.privateKey(); // sprawdza, czy to prawdziwy klucz
    return key;
  }

  constructor(d, x, y) {
    Object.assign(this, { d, x, y });
  }

  get code() {
    return toB64(new Uint8Array([...fromB64(this.d), ...fromB64(this.x), ...fromB64(this.y)]));
  }

  get publicKey() {
    return { x: this.x, y: this.y };
  }

  /** Token do serwera: skrót prywatnej części, więc nie trzeba go przechowywać osobno. */
  async token() {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array([...fromB64(this.d), ...text.encode('pga-mikolaj-token')]));
    return toB64(new Uint8Array(digest));
  }

  privateKey() {
    return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: this.d, x: this.x, y: this.y, ext: true }, ECDH, false, ['deriveBits']);
  }

  /** Otwiera zaszyfrowany los z serwera: { epk, iv, ct } → dane wylosowanej osoby. */
  async open(box) {
    const ephemeral = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', ...box.epk, ext: true }, ECDH, false, []);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: ephemeral }, await this.privateKey(), 256);
    const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const aes = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: text.encode('pga-mikolaj') },
      hkdf, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, aes, fromB64(box.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }
}
