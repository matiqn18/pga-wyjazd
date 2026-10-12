'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Cały stan w jednym pliku JSON: zapis atomowy (plik tymczasowy + rename)
 * i kopia zapasowa przy każdym starcie (zostaje `keepBackups` ostatnich).
 */
class JsonFileStore {
  constructor(dir, { name = 'pga', keepBackups = 5 } = {}) {
    this.dir = dir;
    this.name = name;
    this.keepBackups = keepBackups;
    this.file = path.join(dir, `${name}.json`);
    this.backupDir = path.join(dir, 'backup');
  }

  /** Zwraca zapisane dane albo `null`, gdy pliku jeszcze nie ma. Przy okazji robi kopię. */
  read() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.file)) return null;
    const raw = fs.readFileSync(this.file, 'utf8');
    this.backup(raw);
    return JSON.parse(raw);
  }

  write(data) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file);
  }

  /** Rzuca czytelny błąd, gdy katalog danych nie jest zapisywalny. */
  assertWritable() {
    fs.accessSync(this.dir, fs.constants.W_OK);
  }

  backup(raw) {
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(this.backupDir, `${this.name}-${stamp}.json`), raw);
      const pattern = new RegExp(`^${this.name}-.*\\.json$`);
      const old = fs.readdirSync(this.backupDir).filter(f => pattern.test(f)).sort().slice(0, -this.keepBackups);
      for (const f of old) fs.unlinkSync(path.join(this.backupDir, f));
    } catch (e) {
      console.error('Kopia zapasowa nieudana:', e.message);
    }
  }
}

module.exports = JsonFileStore;
