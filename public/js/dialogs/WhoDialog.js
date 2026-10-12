import { $, esc } from '../core/dom.js';
import { avatar } from '../ui/components.js';
import { Dialog } from './Dialog.js';

/** „Jako kto się przedstawiasz?” – wybór z listy albo nowe imię. */
export class WhoDialog extends Dialog {
  constructor(app) {
    super(app, 'who');
    this.list = $('#who-list');
    this.input = $('#who-name');
    this.list.addEventListener('click', event => {
      const button = event.target.closest('[data-who]');
      if (button) this.choose(button.dataset.who);
    });
    // Bez imienia nie da się zamknąć okna.
    this.element.addEventListener('cancel', event => { if (!app.identity.known) event.preventDefault(); });
  }

  open() {
    const people = this.app.state ? this.app.state.people : [];
    this.list.innerHTML = people.map(p => `<button type="button" data-who="${esc(p.name)}">${avatar(p.name)}${esc(p.name)}</button>`).join('');
    this.input.value = this.app.identity.name;
    super.open();
  }

  submit() {
    this.choose(this.input.value);
  }

  async choose(name) {
    if (!name.trim()) return this.input.focus();
    this.app.identity.set(name);
    this.close();
    await this.app.send('join');
    this.app.render();
  }
}
