import { ApiError } from './Api.js';

const CHUNK = 8 * 1024 * 1024;
const PARALLEL = 2;
const RETRIES = 8;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Kolejka wysyłania plików w kawałkach po CHUNK, po PARALLEL plików naraz.
 * Zerwane połączenie: ponawia ten sam kawałek (coraz rzadziej), a gdy serwer ma już
 * część danych, wysyła dalej od jego offsetu.
 *
 * `onChange()` po każdej zmianie postępu; `onFileDone(result)` po każdym pliku.
 */
export class Uploader {
  constructor(api, { onChange, onFileDone }) {
    this.api = api;
    this.onChange = onChange;
    this.onFileDone = onFileDone;
    this.queue = [];
    this.active = 0;
  }

  /** Pliki w kolejce: { file, sent, status: 'czeka'|'wysyłam'|'gotowe'|'było'|'błąd', error } */
  get jobs() {
    return this.queue;
  }

  get busy() {
    return this.queue.some(j => j.status === 'czeka' || j.status === 'wysyłam');
  }

  add(files, personName) {
    for (const file of files) this.queue.push({ file, personName, sent: 0, status: 'czeka' });
    this.onChange();
    this.pump();
  }

  /** Czyści listę po skończonej wysyłce. */
  clearFinished() {
    if (!this.busy) this.queue = [];
  }

  pump() {
    while (this.active < PARALLEL) {
      const job = this.queue.find(j => j.status === 'czeka');
      if (!job) return;
      this.active++;
      job.status = 'wysyłam';
      this.run(job).finally(() => {
        this.active--;
        this.onChange();
        this.pump();
      });
    }
  }

  async run(job) {
    try {
      const result = await this.send(job);
      job.status = result.duplicate ? 'było' : 'gotowe';
      job.sent = job.file.size;
      this.onFileDone(result);
    } catch (e) {
      job.status = 'błąd';
      job.error = e.message || 'Nie udało się.';
    }
  }

  async send(job) {
    const { file } = job;
    const start = await this.api.mediaStart({ name: job.personName, file: file.name, size: file.size });
    if (start.duplicate) return start;
    let offset = start.offset;
    let failures = 0;
    for (;;) {
      try {
        const result = await this.putChunk(start.id, offset, file.slice(offset, offset + CHUNK));
        failures = 0;
        if (result.done || result.duplicate) return result;
        offset = result.offset;
      } catch (e) {
        if (e.status === 409 && Number.isInteger(e.offset)) {
          // serwer ma już inny kawałek albo jeszcze kończy zapis przerwanego
          offset = e.offset;
          await wait(1000);
          continue;
        }
        if (e.status >= 400 && e.status < 500) throw e;
        if (++failures > RETRIES) throw new ApiError('Nie udało się wysłać (brak połączenia).', 0);
        await wait(Math.min(30e3, 1000 * 2 ** failures));
      }
      job.sent = offset;
      this.onChange();
    }
  }

  async putChunk(id, offset, blob) {
    let response;
    try {
      response = await fetch(`/api/media/upload/${encodeURIComponent(id)}?offset=${offset}`, { method: 'PUT', body: blob });
    } catch {
      throw new ApiError('Brak połączenia z serwerem.', 0);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new ApiError(data.error || 'Nie udało się.', response.status), { offset: data.offset });
    return data;
  }
}
