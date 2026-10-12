import { $ } from '../core/dom.js';
import { Dialog } from './Dialog.js';

/** Hasło admina; po zalogowaniu to urządzenie ma tryb admina przez 30 dni. */
export class AdminDialog extends Dialog {
  constructor(app) {
    super(app, 'admin-login');
    this.password = $('#admin-pass');
    this.error = $('#admin-error');
  }

  open() {
    this.error.textContent = '';
    this.password.value = '';
    super.open();
  }

  async submit() {
    try {
      const state = await this.app.api.adminLogin(this.password.value);
      this.password.value = '';
      this.close();
      this.app.applyState(state);
      this.app.toast.show('Tryb admina włączony.');
    } catch (e) {
      this.error.textContent = e.message;
    }
  }
}
