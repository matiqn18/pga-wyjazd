'use strict';
const Service = require('./Service');
const UserError = require('../util/UserError');

/** Ustawienia całej strony zmieniane przez admina: które zakładki widzi ekipa. */
class Settings extends Service {
  hideTabs(actor, ctx, hidden) {
    this.requireAdmin(ctx);
    const tabs = this.config.tabs;
    const next = Object.keys(tabs).filter(name => Array.isArray(hidden) && hidden.includes(name));
    if (next.length === Object.keys(tabs).length) UserError.fail('Przynajmniej jedna zakładka musi zostać widoczna.');
    const before = this.data.hiddenTabs;
    const nowHidden = next.filter(name => !before.includes(name));
    const nowShown = before.filter(name => !next.includes(name));
    if (!nowHidden.length && !nowShown.length) return;
    this.data.hiddenTabs = next;
    this.record(actor, 'tabs', { hide: nowHidden.map(n => tabs[n]), show: nowShown.map(n => tabs[n]), admin: true });
  }
}

module.exports = Settings;
