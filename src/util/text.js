'use strict';

/** Usuwa znaki sterujące, zbija białe znaki do jednej spacji i przycina do `max` znaków. */
function clean(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Klucz osoby: imię małymi literami (tak samo liczony w przeglądarce). */
function keyOf(name) {
  return clean(name, 24).toLowerCase();
}

/** Losowy, krótki identyfikator do adresów i danych. */
function newId(crypto) {
  return crypto.randomBytes(6).toString('base64url');
}

module.exports = { clean, keyOf, newId };
