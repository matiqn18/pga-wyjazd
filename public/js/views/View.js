import { $ } from '../core/dom.js';

/**
 * Zakładka aplikacji (<section id="view-…">).
 * Podklasy rysują się w render() i obsługują zdarzenia w swoim obszarze przez on().
 */
export class View {
  constructor(app, name) {
    this.app = app;
    this.name = name;
    this.root = $(`#view-${name}`);
  }

  /** Aktualny model stanu (TripModel). */
  get model() {
    return this.app.model;
  }

  /** Delegacja zdarzeń: handler(element pasujący do selektora, zdarzenie). */
  on(type, selector, handler) {
    this.root.addEventListener(type, event => {
      const target = event.target.closest(selector);
      if (target && this.root.contains(target)) handler(target, event);
    });
  }

  /** Formularz w tej zakładce: zawsze bez przeładowania strony. */
  onSubmit(form, handler) {
    form.addEventListener('submit', event => {
      event.preventDefault();
      handler(form, event);
    });
  }

  setVisible(visible) {
    this.root.hidden = !visible;
  }

  /** Czy można teraz przerysować (np. nie w trakcie przeciągania). */
  canRender() {
    return true;
  }

  /** Wołane przy przejściu na inną zakładkę. */
  reset() {}

  render() {}
}
