import { $, $$, esc } from '../core/dom.js';

/**
 * Panel admina „Widoczne zakładki” nad treścią strony. Odznaczona zakładka znika
 * u całej ekipy; admin dalej ją widzi (z przerywaną ramką), żeby móc do niej zajrzeć.
 */
export class TabsPanel {
  constructor(app) {
    this.app = app;
    this.root = $('#tabs-admin');
    this.list = $('#tabs-admin-list');
    this.signature = '';
    this.list.addEventListener('change', () => this.save());
  }

  render() {
    const { admin, config, hiddenTabs } = this.app.state;
    this.root.hidden = !admin;
    if (!admin) return;
    // Przebudowa tylko przy zmianie, żeby odpytywanie nie zabierało fokusu z pól.
    const signature = JSON.stringify([config.tabs, hiddenTabs]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.list.innerHTML = Object.entries(config.tabs).map(([name, label]) =>
      `<label><input type="checkbox" value="${esc(name)}" ${hiddenTabs.includes(name) ? '' : 'checked'}>${esc(label)}</label>`).join('');
  }

  async save() {
    const hidden = $$('input', this.list).filter(i => !i.checked).map(i => i.value);
    if (hidden.length === Object.keys(this.app.state.config.tabs).length) {
      this.signature = '';
      this.render();
      return this.app.toast.show('Przynajmniej jedna zakładka musi zostać widoczna.');
    }
    if (await this.app.send('tabsHide', { hidden })) this.app.toast.show('Zapisano. Ekipa widzi teraz tylko zaznaczone zakładki.');
  }
}
