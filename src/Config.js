'use strict';
const path = require('path');
const { clean } = require('./util/text');

const DEFAULT_DAYS = 'Piątek:rano,popołudnie,wieczór;Sobota:rano,popołudnie,wieczór;Niedziela:rano,popołudnie';

/**
 * Dni wyjazdu i pory dnia, np. „Piątek:rano,wieczór;Sobota:rano”.
 * Pole planu ma identyfikator „Dzień|pora”.
 */
class Schedule {
  constructor(spec) {
    this.days = Schedule.parse(spec);
    this.slots = new Set(this.days.flatMap(d => d.parts.map(p => p.id)));
    if (!this.slots.size) throw new Error('DAYS nie zawiera żadnego dnia z porami.');
  }

  static parse(spec) {
    return spec.split(';')
      .map(chunk => {
        const [day, parts = ''] = chunk.split(':');
        const name = clean(day, 20);
        const partNames = parts.split(',').map(p => clean(p, 20)).filter(Boolean);
        return { name, parts: partNames.map(p => ({ name: p, id: `${name}|${p}` })) };
      })
      .filter(d => d.name && d.parts.length);
  }

  has(slotId) {
    return this.slots.has(slotId);
  }
}

/** Ustawienia aplikacji, czytane raz przy starcie ze zmiennych środowiskowych. */
class Config {
  static CATEGORIES = ['atrakcje', 'jedzenie', 'pga', 'inne'];

  static fromEnv(env, rootDir) {
    const dataDir = env.DATA_DIR || path.join(rootDir, 'data');
    return new Config({
      port: Number(env.PORT) || 3050,
      dataDir,
      publicDir: path.join(rootDir, 'public'),
      password: env.PASSWORD || '',
      adminPassword: env.ADMIN_PASSWORD || '',
      title: env.TITLE || 'PGA: centrum wyjazdu',
      schedule: new Schedule(env.DAYS || DEFAULT_DAYS),
    });
  }

  constructor({ port, dataDir, publicDir, password, adminPassword, title, schedule }) {
    Object.assign(this, { port, dataDir, publicDir, password, adminPassword, title, schedule });
    this.categories = Config.CATEGORIES;
  }

  get adminEnabled() {
    return Boolean(this.adminPassword);
  }
}

module.exports = { Config, Schedule };
