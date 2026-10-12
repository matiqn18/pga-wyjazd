/**
 * Stan wyjazdu z serwera plus pytania, które zadają mu widoki.
 * Tworzony na nowo przy każdym rysowaniu (tani: tylko opakowuje obiekt stanu).
 * `me` = klucz osoby przy tym urządzeniu.
 */
export class TripModel {
  constructor(state, me) {
    this.state = state;
    this.me = me;
  }

  get config() { return this.state.config; }
  get people() { return this.state.people; }
  get ideas() { return this.state.ideas; }
  get expenses() { return this.state.expenses; }
  get events() { return this.state.events; }
  get isAdmin() { return Boolean(this.state.admin); }

  nameOf(key) {
    return (this.people.find(p => p.key === key) || {}).name || key;
  }

  ideaById(id) {
    return this.ideas.find(i => i.id === id);
  }

  /** Autor albo admin (serwer i tak sprawdza to samo). */
  canEdit(item) {
    return item.byKey === this.me || this.isAdmin;
  }

  // ---------- zainteresowanie ----------

  /** Ocena pomysłu przez osobę: 0 (brak), 1 mogę, 2 chętnie, 3 bardzo chcę. */
  levelOf(ideaId, key = this.me) {
    return (this.state.interest[ideaId] || {})[key] || 0;
  }

  /** Chętni do pomysłu, od najbardziej zainteresowanych. */
  fansOf(ideaId) {
    return Object.entries(this.state.interest[ideaId] || {})
      .map(([key, level]) => ({ key, level, name: this.nameOf(key) }))
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name, 'pl'));
  }

  /** Suma ocen. */
  scoreOf(ideaId) {
    return this.fansOf(ideaId).reduce((sum, f) => sum + f.level, 0);
  }

  /** Porównanie do sortowania: najwyższa suma ocen, potem najwięcej chętnych, potem najnowsze. */
  get byScore() {
    return (a, b) => this.scoreOf(b.id) - this.scoreOf(a.id)
      || this.fansOf(b.id).length - this.fansOf(a.id).length
      || b.at - a.at;
  }

  /** Pomysły, których osoba jeszcze nie oceniła. */
  unratedBy(key = this.me) {
    return this.ideas.filter(i => !this.levelOf(i.id, key));
  }

  // ---------- wspólny plan ----------

  slotOf(ideaId) {
    for (const [slot, ids] of Object.entries(this.state.board.slots)) if (ids.includes(ideaId)) return slot;
    return null;
  }

  ideasIn(slot) {
    return (this.state.board.slots[slot] || []).map(id => this.ideaById(id)).filter(Boolean);
  }

  unplacedIdeas() {
    const placed = new Set(Object.values(this.state.board.slots).flat());
    return this.ideas.filter(i => !placed.has(i.id));
  }

  /** Klucze osób, które zaznaczyły „nie mogę” w danym polu. */
  awayIn(slot) {
    return Object.entries(this.state.plans).filter(([, p]) => (p.away || []).includes(slot)).map(([k]) => k);
  }

  awayOf(key = this.me) {
    return (this.state.plans[key] || {}).away || [];
  }

  /** Pory dnia w kolejności doby (rano → noc), potem w kolejności z konfiguracji. */
  partRows() {
    const ORDER = ['rano', 'południe', 'popołudnie', 'wieczór', 'noc'];
    const rank = name => { const i = ORDER.indexOf(name.toLowerCase()); return i < 0 ? 99 : i; };
    const seen = [];
    for (const day of this.config.days) for (const part of day.parts) if (!seen.includes(part.name)) seen.push(part.name);
    return seen.map((name, i) => [name, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([name]) => name);
  }

  // ---------- lokalizacje ----------

  /** Aktualne lokalizacje (najnowsze pierwsze) jako [klucz, lokalizacja]. */
  freshLocations(ttlMs = 2 * 3600e3) {
    return Object.entries(this.state.locations || {})
      .filter(([, l]) => Date.now() - l.t < ttlMs)
      .sort((a, b) => b[1].t - a[1].t);
  }

  locationOf(key = this.me) {
    return (this.state.locations || {})[key];
  }

  // ---------- wydatki ----------

  /** Podział po równo co do grosza; brakujące grosze dopłacają pierwsze osoby z listy. */
  sharesOf(expense) {
    const n = expense.split.length;
    const base = Math.floor(expense.amount / n);
    const rest = expense.amount - base * n;
    return Object.fromEntries(expense.split.map((key, i) => [key, base + (i < rest ? 1 : 0)]));
  }

  /** Bilans w groszach: + należy się tej osobie, − ta osoba jest winna. */
  balances() {
    const balance = Object.fromEntries(this.people.map(p => [p.key, 0]));
    for (const x of this.expenses) {
      balance[x.payer] = (balance[x.payer] || 0) + x.amount;
      for (const [key, share] of Object.entries(this.sharesOf(x))) balance[key] = (balance[key] || 0) - share;
    }
    return balance;
  }

  /** Najmniej przelewów: największy dłużnik oddaje największemu wierzycielowi. */
  transfers(balance = this.balances()) {
    const debtors = Object.entries(balance).filter(([, v]) => v < 0).map(([k, v]) => [k, -v]).sort((a, b) => b[1] - a[1]);
    const creditors = Object.entries(balance).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const out = [];
    for (let i = 0, j = 0; i < debtors.length && j < creditors.length;) {
      const amount = Math.min(debtors[i][1], creditors[j][1]);
      out.push({ from: debtors[i][0], to: creditors[j][0], amount });
      debtors[i][1] -= amount;
      creditors[j][1] -= amount;
      if (!debtors[i][1]) i++;
      if (!creditors[j][1]) j++;
    }
    return out;
  }

  /** Suma wydatków bez zwrotów. */
  totalSpent() {
    return this.expenses.filter(x => !x.settle).reduce((sum, x) => sum + x.amount, 0);
  }

  // ---------- zmiany lokalne (zanim serwer potwierdzi) ----------

  placeLocally(ideaId, slot, index) {
    const slots = this.state.board.slots;
    for (const s of Object.keys(slots)) slots[s] = slots[s].filter(x => x !== ideaId);
    if (!slot) return;
    const list = slots[slot] || (slots[slot] = []);
    list.splice(index == null ? list.length : Math.min(index, list.length), 0, ideaId);
  }

  rateLocally(ideaId, level) {
    const votes = this.state.interest[ideaId] || (this.state.interest[ideaId] = {});
    if (level) votes[this.me] = level;
    else delete votes[this.me];
  }
}
