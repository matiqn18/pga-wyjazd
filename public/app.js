// PGA: centrum wyjazdu – punkt wejścia strony. Kod w js/: App → widoki (views/), okna (dialogs/), model (model/).
import { App } from './js/App.js';

const app = new App();
app.startPolling();
app.start();
