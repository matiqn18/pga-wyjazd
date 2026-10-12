import { $, $$, esc } from './core/dom.js';
import { Api } from './core/Api.js';
import { Identity } from './core/Identity.js';
import { Prefs } from './core/Prefs.js';
import { Toast } from './core/Toast.js';
import { TripModel } from './model/TripModel.js';
import { avatar, categoryName, shape } from './ui/components.js';
import { AdminDialog } from './dialogs/AdminDialog.js';
import { ExpenseEditDialog } from './dialogs/ExpenseEditDialog.js';
import { IdeaEditDialog } from './dialogs/IdeaEditDialog.js';
import { LoginDialog } from './dialogs/LoginDialog.js';
import { WhoDialog } from './dialogs/WhoDialog.js';
import { ExpensesView } from './views/ExpensesView.js';
import { IdeasView } from './views/IdeasView.js';
import { MyPlanView } from './views/MyPlanView.js';
import { PeopleView } from './views/PeopleView.js';
import { PlanView } from './views/PlanView.js';

const POLL_MS = 2500;

/**
 * Całość strony: stan z serwera, odpytywanie co POLL_MS, zakładki, nagłówek, okna.
 * Widoki wysyłają zmiany przez send(); każda odpowiedź serwera to pełny nowy stan.
 */
export class App {
  constructor() {
    this.prefs = new Prefs();
    this.api = new Api();
    this.identity = new Identity(this.prefs);
    this.toast = new Toast($('#toast'));
    this.state = null;
    this.categoriesReady = false;

    this.views = {
      pomysly: new IdeasView(this),
      chetni: new PeopleView(this),
      plan: new PlanView(this),
      moj: new MyPlanView(this),
      wydatki: new ExpensesView(this),
    };
    this.dialogs = {
      login: new LoginDialog(this),
      who: new WhoDialog(this),
      admin: new AdminDialog(this),
      ideaEdit: new IdeaEditDialog(this),
      expenseEdit: new ExpenseEditDialog(this),
    };
    this.currentName = this.prefs.get('widok', 'pomysly', Object.keys(this.views));

    this.bindGlobalControls();
  }

  get currentView() {
    return this.views[this.currentName];
  }

  /** Model stanu dla widoków (nowy przy każdym odczycie – zawsze aktualny). */
  get model() {
    return new TripModel(this.state, this.identity.key);
  }

  // ---------- start i komunikacja ----------

  async start() {
    await this.refresh({ force: true });
    if (!this.state) {
      if (!this.dialogs.login.isOpen) this.toast.show('Nie udało się połączyć z serwerem.');
      return;
    }
    this.renderCategoryPickers();
    if (this.identity.known) this.send('join');
    else this.dialogs.who.open();
  }

  startPolling() {
    setInterval(() => {
      if (!document.hidden && !this.views.plan.dragger.pressed && !this.dialogs.login.isOpen) this.refresh();
    }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
  }

  /** Pobiera stan; bez `force` serwer odpowiada `{ unchanged }`, gdy nic się nie zmieniło. */
  async refresh({ force = false } = {}) {
    try {
      const next = await this.api.state(force || !this.state ? null : this.state.v);
      if (force && !next.unchanged) this.replaceState(next);
      else this.applyState(next);
    } catch (e) {
      if (e.status === 401) this.dialogs.login.open();
      // brak sieci: spróbujemy przy następnym odpytaniu
    }
  }

  /** Wysyła akcję w imieniu tej osoby. Zwraca true, gdy serwer ją przyjął. */
  async send(action, body = {}) {
    try {
      this.applyState(await this.api.action(action, { name: this.identity.name, ...body }));
      return true;
    } catch (e) {
      if (e.status === 401) this.dialogs.login.open();
      else if (e.status === 0) this.toast.show('Brak połączenia z serwerem. Zmiana nie została zapisana.');
      else {
        this.toast.show(e.message || 'Nie udało się zapisać.');
        this.refresh({ force: true });
      }
      return false;
    }
  }

  /** Przyjmuje nowszy stan (starszy – np. spóźniona odpowiedź – ignoruje). */
  applyState(next) {
    if (!next || next.unchanged) return;
    if (this.state && next.v < this.state.v) return;
    this.replaceState(next);
  }

  replaceState(next) {
    this.state = next;
    this.render();
  }

  /** Akcja wymaga imienia; bez niego otwiera okno wyboru osoby. */
  requireName() {
    if (this.identity.known) return true;
    this.dialogs.who.open();
    return false;
  }

  // ---------- rysowanie ----------

  render() {
    if (!this.state || !this.currentView.canRender()) return;
    this.identity.followAlias(this.state);
    this.renderHeader();
    for (const [name, view] of Object.entries(this.views)) view.setVisible(name === this.currentName);
    for (const tab of $$('.tabs button')) tab.setAttribute('aria-pressed', tab.dataset.view === this.currentName);
    this.currentView.render();
  }

  renderHeader() {
    const { config, admin, adminEnabled } = this.state;
    document.title = config.title;
    $('#title').textContent = config.title;
    const name = this.identity.name;
    $('#me-chip').innerHTML = name
      ? `${avatar(name)}<span>${esc(name)}</span>${admin ? '<span class="admin-tag">admin</span>' : ''}`
      : 'Podaj imię';
    const adminToggle = $('#admin-toggle');
    adminToggle.hidden = !adminEnabled && !admin;
    adminToggle.textContent = admin ? 'Wyjdź z trybu admina' : 'Tryb admina';
  }

  /** Rodzaje pomysłów w formularzu dodawania i w oknie edycji (raz, po pierwszym stanie). */
  renderCategoryPickers() {
    if (this.categoriesReady) return;
    this.categoriesReady = true;
    const html = this.state.config.cats.map((cat, i) =>
      `<label class="cat-${esc(cat)}"><input type="radio" name="cat" value="${esc(cat)}" ${i === 0 ? 'checked' : ''}>${shape(cat)}${esc(categoryName(cat))}</label>`).join('');
    $('#cats').innerHTML = html;
    $('#edit-cats').innerHTML = html;
  }

  show(viewName) {
    if (!this.views[viewName]) return;
    this.currentName = viewName;
    this.prefs.set('widok', viewName);
    for (const view of Object.values(this.views)) view.reset();
    this.render();
    window.scrollTo(0, 0);
  }

  // ---------- elementy wspólne dla całej strony ----------

  bindGlobalControls() {
    // Zakładki i przyciski przenoszące do zakładki (np. „Ułóż we wspólnym planie”).
    document.addEventListener('click', e => {
      const link = e.target.closest('[data-view]');
      if (link) this.show(link.dataset.view);
    });
    $('#me-chip').addEventListener('click', () => this.dialogs.who.open());
    $('#logout').addEventListener('click', () => this.logout());
    $('#admin-toggle').addEventListener('click', () => this.toggleAdmin());
  }

  async logout() {
    try { await this.api.logout(); } catch { /* i tak przeładujemy */ }
    location.reload();
  }

  async toggleAdmin() {
    if (!this.state || !this.state.admin) return this.dialogs.admin.open();
    try {
      this.applyState(await this.api.adminLogout());
      this.toast.show('Tryb admina wyłączony.');
    } catch {
      this.toast.show('Brak połączenia z serwerem.');
    }
  }
}
