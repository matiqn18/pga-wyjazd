import { $ } from '../core/dom.js';

/**
 * Okno <dialog> z formularzem. Leży poza obszarem przerysowywanym przy odpytywaniu
 * serwera, więc cudza zmiana nie kasuje wpisywanego tekstu.
 */
export class Dialog {
  constructor(app, id) {
    this.app = app;
    this.element = $(`#${id}`);
    this.form = this.element.querySelector('form');
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      this.submit();
    });
    // Przyciski „Anuluj” z atrybutem data-close.
    this.element.addEventListener('click', event => {
      if (event.target.closest('[data-close]')) this.close();
    });
  }

  get isOpen() {
    return this.element.open;
  }

  open() {
    if (!this.element.open) this.element.showModal();
  }

  close() {
    if (this.element.open) this.element.close();
  }

  /** Zatwierdzenie formularza – w podklasach. */
  submit() {}
}
