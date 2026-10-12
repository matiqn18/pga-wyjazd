import { Dialog } from './Dialog.js';

/** Edycja pomysłu: nazwa, link, rodzaj. Dla autora i admina. */
export class IdeaEditDialog extends Dialog {
  constructor(app) {
    super(app, 'edit');
    this.ideaId = null;
  }

  openFor(idea) {
    this.ideaId = idea.id;
    const f = this.form;
    f.title.value = idea.title;
    f.link.value = idea.link || '';
    const radio = f.querySelector(`input[value="${CSS.escape(idea.cat)}"]`) || f.querySelector('input[name=cat]');
    if (radio) radio.checked = true;
    this.open();
    f.title.focus();
  }

  async submit() {
    const f = this.form;
    const saved = await this.app.send('ideaEdit', { id: this.ideaId, title: f.title.value, link: f.link.value, cat: f.cat.value });
    if (saved) {
      this.close();
      this.app.toast.show('Zapisane.');
    }
  }
}
