import { $ } from '../core/dom.js';
import { Dialog } from './Dialog.js';

/** Wspólne hasło ekipy. Nie da się go zamknąć bez zalogowania. */
export class LoginDialog extends Dialog {
  constructor(app) {
    super(app, 'login');
    this.password = $('#login-pass');
    this.error = $('#login-error');
    this.element.addEventListener('cancel', event => event.preventDefault());
  }

  open() {
    super.open();
    this.password.focus();
  }

  async submit() {
    this.error.textContent = '';
    try {
      await this.app.api.login(this.password.value);
      this.password.value = '';
      this.close();
      this.app.start();
    } catch (e) {
      this.error.textContent = e.status === 0 ? 'Brak połączenia z serwerem.' : e.message;
    }
  }
}
