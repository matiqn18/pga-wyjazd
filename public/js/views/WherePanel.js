import { $, esc } from '../core/dom.js';
import { agoText, distanceText, metres } from '../core/format.js';
import { avatar } from '../ui/components.js';

/** „Gdzie kto jest”: jednorazowe „Jestem tutaj”, lista osób z odległością i linkiem do mapy. */
export class WherePanel {
  constructor(app, root) {
    this.app = app;
    this.list = $('#where-list', root);
    this.form = $('#where-form', root);
    this.note = $('#where-note', root);
    this.button = $('[type=submit]', this.form);

    this.form.addEventListener('submit', e => { e.preventDefault(); this.shareMyLocation(); });
    this.list.addEventListener('click', e => { if (e.target.closest('[data-where-off]')) this.app.send('locateClear'); });
  }

  render(model) {
    const mine = model.locationOf();
    const entries = model.freshLocations();
    this.list.innerHTML = entries.length
      ? `<ul class="where-list">${entries.map(([key, loc]) => this.row(model, key, loc, mine)).join('')}</ul>`
      : '<p class="muted where-empty">Nikt teraz nie udostępnia lokalizacji.</p>';
  }

  row(model, key, loc, mine) {
    const isMe = key === model.me;
    const name = model.nameOf(key);
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
    const meta = [
      agoText(loc.t),
      !isMe && mine ? distanceText(metres(mine, loc)) : '',
      loc.acc > 50 ? `dokładność ±${loc.acc} m` : '',
    ].filter(Boolean).join(' · ');
    return `<li>${avatar(name, { big: true })}<div><strong>${esc(name)}${isMe ? ' (ty)' : ''}</strong>
      ${loc.note ? `<span class="where-note">${esc(loc.note)}</span>` : ''}<small>${esc(meta)}</small></div>
      <span class="where-act">${isMe ? '<button type="button" class="mini" data-where-off>Usuń</button>' : ''}
      <a class="mini go" href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">Mapa</a></span></li>`;
  }

  /** Telefon podaje pozycję tylko stronom z HTTPS (albo localhost). */
  shareMyLocation() {
    if (!this.app.requireName()) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      this.app.toast.show('Lokalizacja działa tylko na stronie z https.');
      return;
    }
    this.setBusy(true);
    navigator.geolocation.getCurrentPosition(
      pos => this.send(pos.coords),
      err => {
        this.setBusy(false);
        this.app.toast.show(err.code === 1
          ? 'Brak zgody na lokalizację. Włącz ją w ustawieniach przeglądarki dla tej strony.'
          : 'Nie udało się ustalić lokalizacji. Spróbuj jeszcze raz.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }

  async send(coords) {
    const saved = await this.app.send('locate', { lat: coords.latitude, lng: coords.longitude, acc: coords.accuracy, note: this.note.value });
    this.setBusy(false);
    if (saved) {
      this.note.value = '';
      this.app.toast.show('Lokalizacja wysłana. Zniknie sama po 2 godzinach.');
    }
  }

  setBusy(busy) {
    this.button.disabled = busy;
    this.button.textContent = busy ? 'Szukam…' : 'Jestem tutaj';
  }
}
