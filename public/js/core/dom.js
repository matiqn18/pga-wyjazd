/** Drobne pomocniki DOM i bezpiecznego HTML. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Wszystko, co pochodzi od użytkownika, przechodzi przez esc() przed wstawieniem do innerHTML. */
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ENTITIES[c]);

/** Klucz osoby: imię małymi literami (tak samo jak na serwerze). */
export const keyOf = name => String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Łączy kawałki HTML, pomijając puste (false, null, ''). */
export const join = parts => parts.filter(Boolean).join('');
