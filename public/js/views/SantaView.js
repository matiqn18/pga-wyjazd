import { $, esc, keyOf } from '../core/dom.js';
import { distanceText, metres, osoby, shortTime } from '../core/format.js';
import { SantaKey } from '../core/SantaKey.js';
import { avatar } from '../ui/components.js';
import { View } from './View.js';

const LINK = /#?mikolaj=(.+)\.([A-Za-z0-9_-]{128})$/;
const CONTACT_FIELDS = ['phone', 'fullName', 'email', 'locker', 'lockerAddress', 'wish'];
const BUDGET = 'Limit na prezent: 15 zł (bez kosztów wysyłki i bez dodatków zrobionych ręcznie).';

/**
 * Zakładka „Mikołajki”: zapis z danymi do paczki (telefon, paczkomat), losowanie
 * i podgląd własnego losu. Los otwiera tylko klucz zapisany w tej przeglądarce
 * (szczegóły w core/SantaKey.js i src/domain/Santa.js).
 *
 * Formularze są w HTML na stałe (przerysowanie nie kasuje wpisanego tekstu);
 * render() tylko je pokazuje, chowa i wypełnia.
 */
export class SantaView extends View {
  constructor(app) {
    super(app, 'mikolaj');
    this.summary = $('#santa-summary');
    this.status = $('#santa-status');
    this.form = $('#santa-form');
    this.restore = $('#santa-restore');
    this.people = $('#santa-people');
    this.count = $('#santa-count');
    this.chosen = $('#santa-locker-chosen');
    this.results = $('#santa-locker-results');
    this.lockerQuery = $('#santa-locker-q');

    this.mine = null;        // odpowiedź /api/santa/mine dla `mineFor`
    this.mineFor = '';
    this.formOwner = '';     // czyj formularz jest na ekranie (zmiana osoby = czysty formularz)
    this.filledFor = '';     // dla kogo formularz jest już wypełniony danymi z serwera
    this.revealed = null;    // odszyfrowany los (tylko w pamięci, do „Ukryj”)
    this.keyOpen = false;    // rozwinięty blok z linkiem do klucza

    this.importFromLink();
    // Link wklejony w kartę, w której strona już jest otwarta: zmienia się tylko #.
    window.addEventListener('hashchange', () => { if (this.importFromLink()) this.app.show('mikolaj'); });
    this.onSubmit(this.form, () => this.save());
    this.onSubmit(this.restore, () => this.useCode($('#santa-code').value));
    this.on('click', '#santa-locker-search', () => this.searchLockers({ q: this.lockerQuery.value }));
    this.on('click', '#santa-locker-near', () => this.searchNear());
    this.on('click', '[data-locker]', el => this.chooseLocker(el.dataset.locker, el.dataset.address));
    this.on('click', '[data-santa-leave]', () => this.leave());
    this.on('click', '[data-santa-draw]', () => this.draw());
    this.on('click', '[data-santa-undraw]', () => this.undraw());
    this.on('click', '[data-santa-remove]', el => this.remove(el.dataset.santaRemove));
    this.on('click', '[data-santa-reveal]', () => this.reveal());
    this.on('click', '[data-santa-hide]', () => { this.revealed = null; this.render(); });
    this.on('click', '[data-copy]', el => this.copy(el.dataset.copy, el.dataset.copyLabel));
    this.lockerQuery.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.searchLockers({ q: this.lockerQuery.value });
    });
    // „toggle” nie wypływa w górę, więc łapiemy go w fazie przechwytywania.
    this.root.addEventListener('toggle', e => { if (e.target.matches('.santa-key')) this.keyOpen = e.target.open; }, true);
  }

  get santa() {
    return this.app.state.santa;
  }

  // ---------- klucz na tym urządzeniu ----------

  storedCode(key = this.model.me) {
    if (!key) return '';
    const own = this.app.prefs.get('mikolaj-' + key);
    if (own) return own;
    // Po zmianie imienia przez admina klucz leży pod starym kluczem osoby.
    const old = Object.entries(this.app.state?.aliases || {}).find(([from, to]) => to === key && this.app.prefs.get('mikolaj-' + from));
    return old ? this.app.prefs.get('mikolaj-' + old[0]) : '';
  }

  storeCode(code, key = this.model.me) {
    this.app.prefs.set('mikolaj-' + key, code);
  }

  async myKey() {
    const code = this.storedCode();
    return code ? SantaKey.fromCode(code) : null;
  }

  linkFor(code) {
    return `${location.origin}/#mikolaj=${encodeURIComponent(this.app.identity.name)}.${code}`;
  }

  /**
   * Link z kluczem (#mikolaj=Imię.kod): zapisuje klucz i otwiera tę zakładkę. Fragment nie trafia na serwer.
   * Zwraca true, gdy w adresie był klucz.
   */
  importFromLink() {
    const m = location.hash.match(LINK);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    const name = decodeURIComponent(m[1]);
    if (!this.app.identity.known) this.app.identity.set(name);
    this.storeCode(m[2], keyOf(name));
    this.app.prefs.set('widok', 'mikolaj');
    this.app.toast.show(`Klucz Mikołajek (${name}) zapisany na tym urządzeniu.`);
    return true;
  }

  // ---------- rysowanie ----------

  render() {
    if (!SantaKey.supported) {
      this.summary.textContent = 'Mikołajki działają tylko na stronie z https (szyfrowanie w przeglądarce).';
      this.form.hidden = this.restore.hidden = true;
      return;
    }
    const m = this.model;
    const s = this.santa;
    const drawn = Boolean(s.drawnAt);
    const joined = s.people.some(p => p.key === m.me);
    const code = this.storedCode();
    this.syncMine(joined, drawn, code);
    const keyWrong = this.mine?.joined && this.mine.keyOk === false;
    const hasKey = Boolean(code) && !keyWrong;

    this.summary.textContent = (drawn
      ? `Losowanie: ${shortTime(s.drawnAt)}, ${osoby(s.people.length)}. Każda osoba widzi tylko swój los.`
      : 'Zapisz się z danymi do paczki. Po losowaniu każda osoba zobaczy, komu robi prezent i gdzie go wysłać. Wynik jest zaszyfrowany kluczem z twojej przeglądarki: nie widzi go nikt inny, także admin.')
      + ` ${BUDGET}`;

    this.form.hidden = drawn || (joined && !hasKey);
    this.restore.hidden = !joined || hasKey;
    $('#santa-form-title').textContent = joined ? 'Twoje dane do paczki' : 'Zapisz się';
    $('#santa-submit').textContent = joined ? 'Zapisz zmiany' : 'Zapisz się do losowania';
    this.fillForm();

    this.setHtml(this.status, [
      this.myStatus(joined, drawn, hasKey),
      joined && hasKey ? this.keyBox() : '',
      this.organizerBox(drawn),
    ].join(''));
    this.count.textContent = s.people.length ? `(${s.people.length})` : '';
    this.setHtml(this.people, s.people.map(p => this.personRow(p, drawn)).join('') || '<p class="muted">Nikt się jeszcze nie zapisał.</p>');
    this.renderChosen();
  }

  /** Podmienia HTML tylko przy zmianie, żeby nie zwijać otwartych bloków przy odpytywaniu. */
  setHtml(element, html) {
    if (element.dataset.html !== html) {
      element.innerHTML = html;
      element.dataset.html = html;
    }
  }

  myStatus(joined, drawn, hasKey) {
    if (!joined) {
      return drawn ? '<div class="santa-box"><strong>Losowanie już było.</strong> Nie ma cię na liście.</div>' : '';
    }
    if (!hasKey) return '';
    if (!drawn) {
      return `<div class="santa-box santa-ok"><span><strong>Jesteś na liście.</strong> Do losowania możesz zmieniać swoje dane.</span>
        <button type="button" class="mini" data-santa-leave>Wypisz się</button></div>`;
    }
    return this.revealed ? this.card(this.revealed) : `<div class="santa-box santa-ok">
      <span><strong>Los czeka.</strong> Otwórz go, gdy nikt nie patrzy ci przez ramię.</span>
      <button type="button" class="btn" data-santa-reveal>Pokaż, komu robisz prezent</button></div>`;
  }

  card(r) {
    const copy = (value, label) => `<button type="button" class="mini" data-copy="${esc(value)}" data-copy-label="${esc(label)}">Kopiuj</button>`;
    const row = (label, value, extra = '') => (value ? `<dt>${label}</dt><dd><span>${value}</span>${extra}</dd>` : '');
    const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Paczkomat ${r.locker} ${r.lockerAddress || ''}`)}`;
    return `<div class="santa-card">
      <p class="where-hint">Robisz prezent dla</p>
      <h3>${avatar(r.name, { big: true })} ${esc(r.name)}</h3>
      <dl>
        ${row('Na paczkę', esc(r.fullName))}
        ${row('Telefon', `<a href="tel:${esc(r.phone.replace(/\s/g, ''))}">${esc(r.phone)}</a>`, copy(r.phone.replace(/\s/g, ''), 'Telefon'))}
        ${row('E-mail', esc(r.email), copy(r.email, 'E-mail'))}
        ${row('Paczkomat', `<strong>${esc(r.locker)}</strong>${r.lockerAddress ? `<small>${esc(r.lockerAddress)} · <a href="${esc(map)}" target="_blank" rel="noopener">mapa</a></small>` : ''}`, copy(r.locker, 'Kod paczkomatu'))}
        ${row('Wskazówka', esc(r.wish))}
      </dl>
      <button type="button" class="mini" data-santa-hide>Ukryj</button>
    </div>`;
  }

  keyBox() {
    const link = this.linkFor(this.storedCode());
    return `<details class="history santa-key" ${this.keyOpen ? 'open' : ''}>
      <summary>Klucz do twojego losu</summary>
      <p class="where-hint">Los otworzysz tylko tym kluczem. Jest zapisany w tej przeglądarce. Zachowaj link z kluczem (np. wyślij go sobie w prywatnej wiadomości): na innym telefonie albo po wyczyszczeniu przeglądarki otworzysz nim swój los. Nikomu go nie pokazuj.</p>
      <button type="button" class="btn-line" data-copy="${esc(link)}" data-copy-label="Link z kluczem">Skopiuj link z kluczem</button>
    </details>`;
  }

  /** Bez ADMIN_PASSWORD losuje każdy; z nim – tylko admin. */
  organizerBox(drawn) {
    const { admin, adminEnabled } = this.app.state;
    if (adminEnabled && !admin) return '';
    const n = this.santa.people.length;
    if (drawn) {
      return `<div class="santa-box santa-admin"><span>Ktoś zgubił klucz? Cofnij losowanie, usuń tę osobę, niech zapisze się jeszcze raz, i losuj od nowa.</span>
        <button type="button" class="mini" data-santa-undraw>Cofnij losowanie</button></div>`;
    }
    const ready = n >= 3;
    return `<div class="santa-box santa-admin"><span>${ready ? `Gdy wszyscy się zapiszą: losowanie dla ${osoby(n)}.` : 'Do losowania potrzeba co najmniej 3 osób.'}</span>
      <button type="button" class="btn" data-santa-draw ${ready ? '' : 'disabled'}>Losuj</button></div>`;
  }

  personRow(p, drawn) {
    const name = this.model.nameOf(p.key);
    const { admin, adminEnabled } = this.app.state;
    const removable = !drawn && (admin || !adminEnabled);
    return `<div class="santa-person">${avatar(name)}<span>${esc(name)}${p.key === this.model.me ? ' (ty)' : ''}</span>
      ${removable ? `<button type="button" class="mini" data-santa-remove="${esc(p.key)}">Usuń</button>` : ''}</div>`;
  }

  /** Pobiera własne dane i los, gdy zmieni się osoba, zapis, losowanie albo klucz. */
  async syncMine(joined, drawn, code) {
    const signature = [this.model.me, joined, this.santa.drawnAt, code].join('|');
    if (signature === this.mineFor) return;
    this.mineFor = signature;
    this.revealed = null;
    if (!joined) {
      this.mine = { joined: false };
      return;
    }
    this.mine = null;
    try {
      const key = await this.myKey();
      const mine = await this.app.api.santaMine(this.app.identity.name, key ? await key.token() : '');
      if (signature !== this.mineFor) return;
      this.mine = mine;
      this.render();
    } catch (e) {
      if (signature === this.mineFor) this.mineFor = ''; // spróbujemy przy następnym rysowaniu
    }
  }

  /** Wypełnia formularz zapisanymi danymi (raz na osobę, żeby nie nadpisywać tego, co ktoś wpisuje). */
  fillForm() {
    const me = this.model.me;
    const contact = this.mine?.contact;
    if (this.formOwner !== me) {
      this.formOwner = me;
      this.filledFor = '';
      this.setContact({});
    }
    if (!contact || this.filledFor === me) return;
    this.filledFor = me;
    this.setContact(contact);
  }

  setContact(contact) {
    for (const name of CONTACT_FIELDS) this.form.elements[name].value = contact[name] || '';
  }

  renderChosen() {
    const f = this.form.elements;
    this.chosen.innerHTML = f.locker.value
      ? `<strong>${esc(f.locker.value)}</strong> ${esc(f.lockerAddress.value)}`
      : '<span class="muted">Nie wybrano. Wyszukaj poniżej i stuknij paczkomat.</span>';
  }

  // ---------- paczkomaty ----------

  async searchLockers(params, from = null) {
    if (!params.lat && String(params.q || '').trim().length < 2) {
      this.results.innerHTML = '<p class="muted">Wpisz kod paczkomatu, kod pocztowy albo miasto.</p>';
      return;
    }
    this.results.innerHTML = '<p class="muted">Szukam…</p>';
    try {
      const { items } = await this.app.api.lockers(params);
      this.results.innerHTML = items.map(p => this.lockerRow(p, from)).join('') || '<p class="muted">Nic nie znaleziono.</p>';
    } catch (e) {
      // Bez wyszukiwarki da się wybrać paczkomat po samym kodzie.
      const code = String(params.q || '').trim().toUpperCase();
      const manual = /^[A-Z0-9-]{4,16}$/.test(code)
        ? `<button type="button" class="santa-locker" data-locker="${esc(code)}" data-address=""><strong>${esc(code)}</strong><span>Użyj tego kodu bez sprawdzania</span></button>`
        : '';
      this.results.innerHTML = `<p class="error">${esc(e.message)}</p>${manual}`;
    }
  }

  lockerRow(p, from) {
    const where = [p.address, p.desc].filter(Boolean).join(' · ');
    const distance = from && p.lat ? `<small>${esc(distanceText(metres(from, { lat: p.lat, lng: p.lng })))}</small>` : '';
    return `<button type="button" class="santa-locker" data-locker="${esc(p.code)}" data-address="${esc(p.address)}">
      <strong>${esc(p.code)}</strong><span>${esc(where)}${p.operating ? '' : ' · nie działa'}</span>${distance}</button>`;
  }

  searchNear() {
    if (!navigator.geolocation) return this.app.toast.show('Ta przeglądarka nie podaje lokalizacji.');
    this.results.innerHTML = '<p class="muted">Ustalam, gdzie jesteś…</p>';
    navigator.geolocation.getCurrentPosition(
      pos => {
        const from = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        this.searchLockers(from, from);
      },
      err => {
        this.results.innerHTML = `<p class="error">${err.code === 1 ? 'Brak zgody na lokalizację.' : 'Nie udało się ustalić lokalizacji.'} Wpisz miasto albo kod pocztowy.</p>`;
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  }

  chooseLocker(code, address) {
    this.form.elements.locker.value = code;
    this.form.elements.lockerAddress.value = address || '';
    this.results.innerHTML = '';
    this.lockerQuery.value = '';
    this.renderChosen();
  }

  // ---------- akcje ----------

  async save() {
    if (!this.app.requireName()) return;
    const f = this.form.elements;
    if (!f.locker.value) return this.app.toast.show('Wybierz paczkomat.');
    const contact = Object.fromEntries(CONTACT_FIELDS.map(n => [n, f[n].value]));
    const joined = this.santa.people.some(p => p.key === this.model.me);
    let key;
    try {
      key = (await this.myKey()) || (await SantaKey.generate());
    } catch {
      return this.app.toast.show('Nie udało się utworzyć klucza w tej przeglądarce.');
    }
    const saved = await this.app.send('santaJoin', { pub: key.publicKey, token: await key.token(), contact });
    if (!saved) return;
    this.storeCode(key.code);
    this.filledFor = this.model.me;
    this.mineFor = '';
    if (!joined) this.keyOpen = true;
    this.render();
    this.app.toast.show(joined ? 'Zapisano zmiany.' : 'Jesteś na liście. Zachowaj link z kluczem.');
  }

  async leave() {
    if (!confirm('Wypisać się z Mikołajek?')) return;
    const key = await this.myKey();
    if (key) this.app.send('santaLeave', { token: await key.token() });
  }

  async useCode(input) {
    const m = String(input).trim().match(LINK);
    const code = m ? m[2] : String(input).trim();
    let key;
    try {
      key = await SantaKey.fromCode(code);
    } catch {
      return this.app.toast.show('To nie wygląda na klucz. Wklej cały link.');
    }
    const check = await this.app.api.santaMine(this.app.identity.name, await key.token()).catch(() => null);
    if (check && check.keyOk === false) return this.app.toast.show(`To nie jest klucz osoby ${this.app.identity.name}.`);
    this.storeCode(key.code);
    $('#santa-code').value = '';
    this.render();
    this.app.toast.show('Klucz zapisany na tym urządzeniu.');
  }

  async reveal() {
    if (!this.mine?.box) {
      this.mineFor = '';
      this.render();
      return this.app.toast.show('Wczytuję los, spróbuj za chwilę.');
    }
    try {
      this.revealed = await (await this.myKey()).open(this.mine.box);
      this.render();
    } catch {
      this.app.toast.show('Ten klucz nie otwiera losu. Poproś o cofnięcie losowania i zapisz się jeszcze raz.');
    }
  }

  draw() {
    const n = this.santa.people.length;
    if (confirm(`Losować teraz dla ${osoby(n)}? Potem nie da się już zmieniać danych ani listy, chyba że cofniesz losowanie.`)) this.app.send('santaDraw');
  }

  undraw() {
    if (confirm('Cofnąć losowanie? Wszystkie losy przepadną, a po ponownym losowaniu każdy dostanie nowy.')) this.app.send('santaUndraw');
  }

  remove(key) {
    if (confirm(`Usunąć z Mikołajek: ${this.model.nameOf(key)}?`)) this.app.send('santaRemove', { key });
  }

  async copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      this.app.toast.show(`${label}: skopiowano.`);
    } catch {
      prompt('Skopiuj:', value);
    }
  }
}
