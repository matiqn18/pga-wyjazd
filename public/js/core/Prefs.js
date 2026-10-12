/**
 * Ustawienia tego urządzenia w localStorage (imię, zakładka, sortowanie, filtr).
 * localStorage bywa niedostępny (tryb prywatny) – wtedy po prostu nic nie zapamiętujemy.
 */
export class Prefs {
  constructor(prefix = 'pga-') {
    this.prefix = prefix;
  }

  /** Wartość albo `fallback`; z `allowed` przyjmuje tylko wartości z listy. */
  get(name, fallback = '', allowed = null) {
    let value = null;
    try { value = localStorage.getItem(this.prefix + name); } catch { /* brak dostępu */ }
    if (value == null) return fallback;
    return allowed && !allowed.includes(value) ? fallback : value;
  }

  set(name, value) {
    try { localStorage.setItem(this.prefix + name, value); } catch { /* brak dostępu */ }
  }
}
