import { $, esc } from './core/dom.js';
import { Api } from './core/Api.js';
import { Identity } from './core/Identity.js';
import { Prefs } from './core/Prefs.js';
import { Toast } from './core/Toast.js';
import { TripModel } from './model/TripModel.js';
import { avatar } from './ui/components.js';
import { LoginDialog } from './dialogs/LoginDialog.js';
import { WhoDialog } from './dialogs/WhoDialog.js';
import { WherePanel } from './views/WherePanel.js';

const POLL_MS = 5000;

/**
 * Podstrona gości /gdzie: tylko „Gdzie kto jest”, osobne hasło i osobna lista osób.
 * Ten sam interfejs co App (api, identity, toast, send, requireName), więc działają
 * te same okna i WherePanel.
 */
export class GuestApp {
  constructor() {
    this.prefs = new Prefs('pga-gosc-');   // imię gościa niezależne od imienia w ekipie
    this.api = new Api('guest/');
    this.identity = new Identity(this.prefs);
    this.toast = new Toast($('#toast'));
    this.state = null;

    this.where = new WherePanel(this, $('main'));
    this.dialogs = {
      login: new LoginDialog(this),
      who: new WhoDialog(this),
    };
    $('#me-chip').addEventListener('click', () => this.dialogs.who.open());
    $('#logout').addEventListener('click', () => this.logout());
  }

  get model() {
    return new TripModel(this.state, this.identity.key);
  }

  async start() {
    await this.refresh({ force: true });
    if (!this.state) {
      if (!this.dialogs.login.isOpen) this.toast.show('Nie udało się połączyć z serwerem.');
      return;
    }
    if (this.identity.known) this.send('join');
    else this.dialogs.who.open();
  }

  startPolling() {
    setInterval(() => { if (!document.hidden && !this.dialogs.login.isOpen) this.refresh(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
  }

  async refresh({ force = false } = {}) {
    try {
      this.applyState(await this.api.state(force || !this.state ? null : this.state.v), force);
    } catch (e) {
      if (e.status === 401) this.dialogs.login.open();
      else if (e.status === 404) this.toast.show(e.message);
    }
  }

  async send(action, body = {}) {
    try {
      this.applyState(await this.api.action(action, { name: this.identity.name, ...body }));
      return true;
    } catch (e) {
      if (e.status === 401) this.dialogs.login.open();
      else this.toast.show(e.message || 'Nie udało się zapisać.');
      return false;
    }
  }

  applyState(next, force = false) {
    if (!next || next.unchanged) return;
    if (!force && this.state && next.v < this.state.v) return;
    this.state = next;
    this.render();
  }

  requireName() {
    if (this.identity.known) return true;
    this.dialogs.who.open();
    return false;
  }

  render() {
    if (!this.state) return;
    document.title = `Gdzie kto jest · ${this.state.config.title}`;
    const name = this.identity.name;
    $('#me-chip').innerHTML = name ? `${avatar(name)}<span>${esc(name)}</span>` : 'Podaj imię';
    this.where.render(this.model);
  }

  async logout() {
    try { await this.api.logout(); } catch { /* i tak przeładujemy */ }
    location.reload();
  }
}
