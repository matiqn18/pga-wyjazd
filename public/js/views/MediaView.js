import { $, esc } from '../core/dom.js';
import { bytes, pliki } from '../core/format.js';
import { Uploader } from '../core/Uploader.js';
import { avatar } from '../ui/components.js';
import { View } from './View.js';

/**
 * Zakładka „Zdjęcia”: wrzucanie zdjęć i filmów (bez galerii) i pobieranie
 * wszystkiego albo plików jednej osoby jako ZIP. Spis plików jest osobno od stanu
 * wyjazdu: pobierany przy wejściu na zakładkę i po każdym wysłanym pliku.
 */
export class MediaView extends View {
  constructor(app) {
    super(app, 'zdjecia');
    this.items = null;
    this.input = $('#media-input');
    this.summary = $('#media-summary');
    this.zipLink = $('#media-zip');
    this.progress = $('#media-progress');
    this.people = $('#media-people');
    this.list = $('#media-list');
    this.count = $('#media-count');
    this.wakeLock = null;
    this.wakeLockPending = false;
    this.uploader = new Uploader(app.api, {
      onChange: () => this.renderProgress(),
      onFileDone: () => this.load(),
    });

    this.on('click', '#media-pick', () => { if (this.app.requireName()) this.input.click(); });
    this.on('click', '#media-clear', () => { this.uploader.clearFinished(); this.renderProgress(); });
    this.on('click', '[data-media-del]', el => this.remove(el.dataset.mediaDel));
    this.input.addEventListener('change', () => this.pick());
    window.addEventListener('beforeunload', e => { if (this.uploader.busy) e.preventDefault(); });
  }

  setVisible(visible) {
    if (visible && this.root.hidden) this.load();
    super.setVisible(visible);
  }

  async load() {
    try {
      this.items = (await this.app.api.media()).items;
      this.render();
    } catch (e) {
      if (e.status === 401) this.app.dialogs.login.open();
    }
  }

  render() {
    if (!this.items) {
      this.summary.textContent = 'Wczytuję…';
      return;
    }
    const total = this.items.reduce((sum, x) => sum + x.size, 0);
    const byPerson = this.groupByPerson();
    this.summary.textContent = this.items.length
      ? `${pliki(this.items.length)} · ${bytes(total)}. Pobierasz oryginały, w ZIP-ie jest folder na każdą osobę.`
      : 'Nikt jeszcze nic nie wrzucił. Wybierz zdjęcia i filmy z telefonu, wyślą się w tle.';
    this.zipLink.hidden = !this.items.length;
    this.zipLink.textContent = `Pobierz wszystko (ZIP, ${bytes(total)})`;
    this.people.innerHTML = byPerson.map(p => this.personRow(p)).join('') || '<p class="muted">Pusto.</p>';
    this.count.textContent = this.items.length ? `(${this.items.length})` : '';
    this.list.innerHTML = [...this.items].reverse().map(x => this.fileRow(x)).join('') || '<p class="muted">Lista jest pusta.</p>';
    this.renderProgress();
  }

  groupByPerson() {
    const groups = new Map();
    for (const x of this.items) {
      const g = groups.get(x.byKey) || { key: x.byKey, name: x.by, count: 0, size: 0 };
      g.count++;
      g.size += x.size;
      groups.set(x.byKey, g);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  }

  personRow(p) {
    const me = p.key === this.model.me ? ' (ty)' : '';
    return `<div class="media-row">${avatar(p.name)}<span><strong>${esc(p.name)}</strong>${me}<small>${pliki(p.count)} · ${bytes(p.size)}</small></span>
      <a class="mini" href="/api/media/zip?by=${encodeURIComponent(p.key)}" download>Pobierz</a></div>`;
  }

  fileRow(x) {
    const del = this.model.canEdit(x) ? `<button type="button" class="mini" data-media-del="${esc(x.id)}">Usuń</button>` : '';
    return `<div class="media-file"><span>${esc(x.name)}<small>${esc(x.by)} · ${bytes(x.size)}</small></span>${del}</div>`;
  }

  renderProgress() {
    const jobs = this.uploader.jobs;
    this.keepAwake(this.uploader.busy);
    if (!jobs.length) {
      this.progress.innerHTML = '';
      return;
    }
    const total = jobs.reduce((sum, j) => sum + j.file.size, 0);
    const sent = jobs.reduce((sum, j) => sum + j.sent, 0);
    const finished = jobs.filter(j => j.status !== 'czeka' && j.status !== 'wysyłam');
    const failed = jobs.filter(j => j.status === 'błąd');
    const duplicates = jobs.filter(j => j.status === 'było').length;

    let head;
    if (this.uploader.busy) {
      head = `<div><strong>Wysyłam ${Math.min(finished.length + 1, jobs.length)} z ${jobs.length}</strong> · ${bytes(sent)} z ${bytes(total)}</div>
        <p class="where-hint">Nie zamykaj tej strony do końca wysyłania.</p>`;
    } else {
      const fresh = jobs.length - failed.length - duplicates;
      head = `<div class="media-progress-head"><span><strong>Wysłane: ${pliki(fresh)}</strong>${duplicates ? ` · pominięte, bo już były: ${duplicates}` : ''}</span>
        <button type="button" id="media-clear" class="mini">OK</button></div>`;
    }
    const errors = failed.map(j => `<li>${esc(j.file.name)}: ${esc(j.error)}</li>`).join('');
    this.progress.innerHTML = `<div class="media-progress">${head}
      <progress max="${total}" value="${sent}"></progress>
      ${errors ? `<ul class="error">${errors}</ul>` : ''}</div>`;
  }

  /** Telefon z wygaszonym ekranem przerywa wysyłanie – w trakcie trzymamy ekran włączony. */
  async keepAwake(on) {
    if (!navigator.wakeLock || this.wakeLockPending) return;
    try {
      if (on && !this.wakeLock) {
        this.wakeLockPending = true;
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
      } else if (!on && this.wakeLock) {
        await this.wakeLock.release();
      }
    } catch {
      // bez blokady ekranu też działa, tylko trzeba pilnować telefonu
    } finally {
      this.wakeLockPending = false;
    }
  }

  // ---------- akcje ----------

  pick() {
    const files = [...this.input.files];
    this.input.value = '';
    if (files.length) this.uploader.add(files, this.app.identity.name);
  }

  async remove(id) {
    const x = this.items.find(i => i.id === id);
    if (!x || !confirm(`Usunąć „${x.name}” (${bytes(x.size)})?`)) return;
    try {
      this.items = (await this.app.api.mediaDelete({ name: this.app.identity.name, id })).items;
      this.render();
    } catch (e) {
      this.app.toast.show(e.message || 'Nie udało się usunąć.');
    }
  }
}
