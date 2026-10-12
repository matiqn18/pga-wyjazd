'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/** <script src="app.js"> i <link href="style.css"> w HTML. */
const HTML_REF = /(href|src)="([\w./-]+\.(?:js|css))"/g;
/** import … from './x.js', import './x.js', import('./x.js') w modułach JS. */
const JS_IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[\w./-]+\.js)\2/g;

/**
 * Pliki z katalogu public/. Odwołania do .js i .css dostają w adresie skrót treści
 * („app.js?v=3f9a…”), liczony razem z zależnościami. Po każdej zmianie przeglądarka
 * pobiera nowe pliki zamiast mieszać stare z nowymi.
 */
class StaticFiles {
  constructor(rootDir) {
    this.root = rootDir;
  }

  serve(req, res, pathname, send) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.join(this.root, rel);
    if (!this.contains(file)) return send(res, 404, 'Nie ma.');

    let body;
    try {
      body = this.read(file, new Map());
    } catch {
      return send(res, 404, 'Nie ma.');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': CSP,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  contains(file) {
    return file.startsWith(this.root + path.sep);
  }

  /** Treść pliku; w HTML i JS z wersjonowanymi odwołaniami. `memo` chroni przed cyklami importów. */
  read(file, memo) {
    if (memo.has(file)) return memo.get(file);
    const raw = fs.readFileSync(file);
    memo.set(file, raw);
    const ext = path.extname(file);
    let body = raw;
    if (ext === '.html') body = this.rewriteHtml(raw.toString('utf8'), file, memo);
    if (ext === '.js') body = this.rewriteJs(raw.toString('utf8'), file, memo);
    memo.set(file, body);
    return body;
  }

  rewriteHtml(text, file, memo) {
    return text.replace(HTML_REF, (match, attr, spec) => `${attr}="${this.versioned(spec, file, memo)}"`);
  }

  rewriteJs(text, file, memo) {
    return text.replace(JS_IMPORT, (match, prefix, quote, spec) => `${prefix}${quote}${this.versioned(spec, file, memo)}${quote}`);
  }

  /** „./x.js” → „./x.js?v=<skrót>”; gdy pliku nie ma, zostawia adres bez zmian. */
  versioned(spec, fromFile, memo) {
    const target = path.resolve(path.dirname(fromFile), spec);
    if (!this.contains(target)) return spec;
    try {
      const hash = crypto.createHash('sha1').update(this.read(target, memo)).digest('hex').slice(0, 10);
      return `${spec}?v=${hash}`;
    } catch {
      return spec;
    }
  }
}

module.exports = StaticFiles;
