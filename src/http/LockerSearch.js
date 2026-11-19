'use strict';

const API = 'https://api-pl-points.easypack24.net/v1/points';
const FIELDS = 'name,address,location,location_description,status,type';
const LIMIT = 12;

/** „bielsko-biała” → „Bielsko-Biała” (API InPost rozróżnia wielkość liter w nazwie miasta). */
const titleCase = s => s.toLocaleLowerCase('pl').replace(/(^|[\s-])(\p{L})/gu, (m, sep, ch) => sep + ch.toLocaleUpperCase('pl'));

/**
 * Wyszukiwanie paczkomatów InPost przez ich publiczne API (bez klucza).
 * Serwer pośredniczy, żeby strona rozmawiała tylko z własnym serwerem.
 *
 *   ?q=KRA01M        kod paczkomatu
 *   ?q=30-415        kod pocztowy
 *   ?q=Kraków        miasto
 *   ?lat=…&lng=…     najbliższe w promieniu 3 km
 */
class LockerSearch {
  async find(params) {
    const q = String(params.get('q') || '').trim().slice(0, 40);
    const lat = Number(params.get('lat')), lng = Number(params.get('lng'));
    const query = new URLSearchParams({ fields: FIELDS, type: 'parcel_locker', status: 'Operating', per_page: String(LIMIT) });

    if (params.has('lat') && Number.isFinite(lat) && Number.isFinite(lng)) {
      query.set('relative_point', `${lat.toFixed(5)},${lng.toFixed(5)}`);
      query.set('max_distance', '3000');
    } else if (/^\d{2}-?\d{3}$/.test(q)) {
      query.set('post_code', q.replace(/^(\d{2})-?(\d{3})$/, '$1-$2'));
    } else if (/^[A-Za-z]{3}\d{2,}[A-Za-z]*$|^POP-[A-Za-z0-9]+$/i.test(q)) {
      query.set('name', q.toUpperCase());
      query.delete('status');
    } else if (q.length >= 2) {
      query.set('city', titleCase(q));
    } else {
      return [];
    }

    const response = await fetch(`${API}?${query}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`InPost: HTTP ${response.status}`);
    const data = await response.json();
    return (data.items || []).map(p => ({
      code: p.name,
      address: [p.address?.line1, p.address?.line2].filter(Boolean).join(', '),
      desc: p.location_description || '',
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      operating: p.status === 'Operating',
    }));
  }
}

module.exports = LockerSearch;
