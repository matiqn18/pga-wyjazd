/** Krótki komunikat na dole ekranu, znika po kilku sekundach. */
export class Toast {
  constructor(element, durationMs = 4000) {
    this.element = element;
    this.durationMs = durationMs;
    this.timer = null;
  }

  show(message) {
    this.element.textContent = message;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.element.textContent = ''; }, this.durationMs);
  }
}
