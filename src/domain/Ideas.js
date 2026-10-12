'use strict';
const crypto = require('crypto');
const Service = require('./Service');
const UserError = require('../util/UserError');
const { clean, newId } = require('../util/text');

const LEVELS = [0, 1, 2, 3]; // 0 = brak oceny

/** Pomysły i ich oceny (bardzo chcę / chętnie / mogę). */
class Ideas extends Service {
  constructor(trip, board) {
    super(trip);
    this.board = board;
  }

  find(id) {
    return this.data.ideas.find(i => i.id === id) || UserError.fail('Tego pomysłu już nie ma.');
  }

  /** Waliduje pola z formularza: nazwa, link (tylko http/https), rodzaj. */
  fields(input) {
    const title = clean(input.title, 60);
    if (!title) UserError.fail('Wpisz, co robimy.');
    let link = clean(input.link, 300);
    if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
    if (link) {
      try { new URL(link); } catch { UserError.fail('Ten link wygląda na niepoprawny.'); }
    }
    const cat = this.config.categories.includes(input.cat) ? input.cat : 'inne';
    return { title, link, cat };
  }

  add(actor, input) {
    const fields = this.fields(input);
    this.data.ideas.push({ id: newId(crypto), ...fields, note: '', by: actor.name, byKey: actor.key, at: Date.now() });
    this.record(actor, 'idea', { idea: fields.title });
  }

  edit(actor, ctx, id, input) {
    const idea = this.find(id);
    const asAdmin = this.authorize(idea.byKey, actor, ctx, 'Pomysł może edytować tylko osoba, która go dodaje.');
    const next = this.fields(input);
    if (next.title === idea.title && next.link === idea.link && next.cat === idea.cat) return;
    const oldTitle = idea.title;
    Object.assign(idea, next);
    this.record(actor, 'idea_edit', { idea: idea.title, ...(oldTitle !== idea.title ? { from: oldTitle } : {}), ...asAdmin });
  }

  remove(actor, ctx, id) {
    const idea = this.find(id);
    const asAdmin = this.authorize(idea.byKey, actor, ctx, 'Pomysł może usunąć tylko osoba, która go dodaje.');
    this.data.ideas = this.data.ideas.filter(i => i !== idea);
    delete this.data.interest[idea.id];
    this.board.unplace(idea.id);
    this.record(actor, 'idea_del', { idea: idea.title, ...asAdmin });
  }

  rate(actor, id, rawLevel) {
    const idea = this.find(id);
    const level = Number(rawLevel);
    if (!LEVELS.includes(level)) UserError.fail('Niepoprawna ocena.');
    const votes = this.data.interest[idea.id] || (this.data.interest[idea.id] = {});
    if ((votes[actor.key] || 0) === level) return;
    if (level) votes[actor.key] = level;
    else delete votes[actor.key];
    if (!Object.keys(votes).length) delete this.data.interest[idea.id];
    this.record(actor, 'interest', { id: idea.id, idea: idea.title, level });
  }
}

module.exports = Ideas;
