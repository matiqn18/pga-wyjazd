'use strict';

/** Aktualna wersja modelu danych. Przy zmianie modelu: podbić i dopisać krok niżej. */
const SCHEMA = 3;

/** Kolejne kroki migracji; każdy dostaje dane w wersji `from` i zostawia je w wersji `from + 1`. */
const STEPS = {
  // 1 → 2: osobiste plansze zamieniają się w oceny „chętnie” i wspólny plan
  // (pomysł trafia w pole, które wybrało najwięcej osób).
  1(data, { schedule }) {
    data.interest = data.interest || {};
    data.board = data.board || { slots: {} };
    const votes = {};
    for (const [key, plan] of Object.entries(data.plans || {})) {
      for (const [slot, ids] of Object.entries(plan.slots || {})) {
        for (const id of ids) {
          (data.interest[id] = data.interest[id] || {})[key] = 2;
          const bySlot = (votes[id] = votes[id] || {});
          bySlot[slot] = (bySlot[slot] || 0) + 1;
        }
      }
      delete plan.slots;
      plan.away = plan.away || [];
    }
    for (const [id, bySlot] of Object.entries(votes)) {
      const [slot] = Object.entries(bySlot).sort((a, b) => b[1] - a[1])[0];
      if (schedule.has(slot)) (data.board.slots[slot] = data.board.slots[slot] || []).push(id);
    }
  },

  // 2 → 3: kategorie konwentowe zamieniają się na kategorie całego wyjazdu.
  2(data, { categories }) {
    const map = { program: 'pga', gry: 'pga', cosplay: 'pga', zakupy: 'atrakcje' };
    for (const idea of data.ideas || []) {
      idea.cat = map[idea.cat] || (categories.includes(idea.cat) ? idea.cat : 'inne');
    }
  },
};

/** Doprowadza dane do wersji SCHEMA. Zwraca true, jeśli coś zmieniła. */
function migrate(data, context) {
  const start = data.schema || 1;
  for (let v = start; v < SCHEMA; v++) {
    STEPS[v](data, context);
    data.schema = v + 1;
  }
  data.schema = SCHEMA;
  return start < SCHEMA;
}

module.exports = { SCHEMA, migrate };
