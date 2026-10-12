/** Formatowanie tekstów: odmiana liczebników, kwoty, czas, odległość. */

/** Odmiana: 1 osoba, 2 osoby, 5 osób. */
function plural(n, one, few, many) {
  const lastDigit = n % 10, lastTwo = n % 100;
  if (n === 1) return `1 ${one}`;
  if (lastDigit >= 2 && lastDigit <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export const osoby = n => plural(n, 'osoba', 'osoby', 'osób');
export const pomysly = n => plural(n, 'pomysł', 'pomysły', 'pomysłów');

const PLN = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
/** Kwota w groszach → „12,50 zł”. */
export const zl = grosze => PLN.format(grosze / 100);

/** „Sobota|wieczór” → „Sobota, wieczór”. */
export const slotLabel = id => (id ? id.replace('|', ', ') : '');

const SHORT_TIME = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
/** „sob., 14:02”. */
export const shortTime = t => SHORT_TIME.format(t);

export function agoText(t) {
  const min = Math.floor((Date.now() - t) / 60e3);
  if (min < 1) return 'przed chwilą';
  if (min < 60) return `${min} min temu`;
  return `${Math.floor(min / 60)} h ${min % 60} min temu`;
}

/** Odległość po kuli ziemskiej w metrach. */
export function metres(a, b) {
  const R = 6371e3, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function distanceText(m) {
  if (m < 1000) return `ok. ${Math.max(10, Math.round(m / 10) * 10)} m od ciebie`;
  return `${(m / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} km od ciebie`;
}
