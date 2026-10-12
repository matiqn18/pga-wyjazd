/** Opis zdarzenia z historii („Ania dodaje pomysł „Zoo””) jako HTML, w formie neutralnej płciowo. */
import { esc } from '../core/dom.js';
import { osoby, slotLabel, zl } from '../core/format.js';

const quoted = s => `„${esc(s)}”`;
const slot = s => esc(slotLabel(s));

const INTEREST = {
  3: e => `bardzo chce: ${quoted(e.idea)}`,
  2: e => `chętnie idzie na ${quoted(e.idea)}`,
  1: e => `może iść na ${quoted(e.idea)}`,
  0: e => `cofa ocenę ${quoted(e.idea)}`,
};

const DESCRIBE = {
  join: () => 'dołącza do planowania',
  idea: e => `dodaje pomysł ${quoted(e.idea)}`,
  idea_del: e => `usuwa pomysł ${quoted(e.idea)}`,
  idea_edit: e => (e.from ? `zmienia nazwę pomysłu ${quoted(e.from)} na ${quoted(e.idea)}` : `edytuje pomysł ${quoted(e.idea)}`),
  interest: e => INTEREST[e.level](e),
  place: e => (e.from
    ? `przenosi ${quoted(e.idea)} z pola ${slot(e.from)} na pole ${slot(e.to)}`
    : `wstawia ${quoted(e.idea)} do planu: ${slot(e.to)}`),
  unplace: e => `zdejmuje ${quoted(e.idea)} z planu (${slot(e.from)})`,
  away: e => `zaznacza, że nie może: ${slot(e.to)}`,
  back: e => `jednak może: ${slot(e.to)}`,
  locate: e => `udostępnia lokalizację${e.note ? ` (${esc(e.note)})` : ''}`,
  locate_off: () => 'przestaje udostępniać lokalizację',
  expense: e => `dodaje wydatek ${quoted(e.idea)}: ${esc(zl(e.amount))}, płaci ${esc(e.payer)}, dzielone na ${esc(osoby(e.n))}`,
  expense_edit: e => `zmienia wydatek ${quoted(e.idea)} (teraz ${esc(zl(e.amount))})`,
  expense_del: e => `usuwa wydatek ${quoted(e.idea)} (${esc(zl(e.amount))})`,
  settle: e => `zapisuje zwrot: ${esc(e.payer)} oddaje ${esc(e.to)} ${esc(zl(e.amount))}`,
  person_rename: e => `zmienia imię ${quoted(e.from)} na ${quoted(e.to)}`,
  person_del: e => `usuwa osobę ${quoted(e.to)}`,
};

export function describeEvent(event) {
  const text = DESCRIBE[event.type] ? DESCRIBE[event.type](event) : esc(event.type);
  return text + (event.admin ? ' <span class="admin-tag">jako admin</span>' : '');
}
