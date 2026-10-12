'use strict';
const http = require('http');
const Auth = require('./Auth');
const StaticFiles = require('./StaticFiles');
const UserError = require('../util/UserError');

const MAX_BODY = 16 * 1024;

/** Odpowiedź tekstowa albo JSON, zawsze bez cache. */
function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isText ? body : JSON.stringify(body));
}

/** Ciało żądania jako obiekt JSON (pusty obiekt, gdy brak). */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new UserError('Za dużo danych.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(body && typeof body === 'object' && !Array.isArray(body) ? body : {});
      } catch {
        reject(new UserError('Niepoprawne dane.'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Trasy:
 *   GET  /healthz                 – dla Dockera
 *   GET  /…                       – pliki z public/
 *   POST /api/login, /api/logout  – hasło ekipy
 *   POST /api/adminLogin, /api/adminLogout
 *   GET  /api/state?v=N           – stan (albo {unchanged}), GET /api/export – cały plik danych
 *   POST /api/<akcja>             – zmiany przez Actions
 */
class HttpServer {
  constructor({ config, trip, store, actions }) {
    this.config = config;
    this.trip = trip;
    this.store = store;
    this.actions = actions;
    this.auth = new Auth(config);
    this.files = new StaticFiles(config.publicDir);

    this.publicRoutes = {
      'POST /api/login': (req, res) => this.login(req, res),
      'POST /api/logout': (req, res) => this.logout(req, res),
    };
    this.teamRoutes = {
      'POST /api/adminLogin': (req, res) => this.adminLogin(req, res),
      'POST /api/adminLogout': (req, res) => this.adminLogout(req, res),
      'GET /api/state': (req, res, url) => this.state(req, res, url),
      'GET /api/export': (req, res) => this.export(req, res),
    };
  }

  listen() {
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch(e => {
        if (e instanceof UserError) return send(res, 400, { error: e.message });
        console.error(e);
        if (!res.headersSent) send(res, 500, { error: 'Błąd serwera.' });
      });
    });
    server.listen(this.config.port, () => {
      const lock = this.config.password ? 'z hasłem' : 'BEZ HASŁA';
      console.log(`PGA: http://localhost:${this.config.port}  (${lock}, ${this.config.schedule.slots.size} pól, dane: ${this.store.file})`);
    });
    return server;
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const route = `${req.method} ${url.pathname}`;

    if (url.pathname === '/healthz') return send(res, 200, 'ok');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Tylko GET.');
      return this.files.serve(req, res, url.pathname, send);
    }
    if (this.publicRoutes[route]) return this.publicRoutes[route](req, res, url);
    if (!this.auth.isTeamMember(req)) return send(res, 401, { error: 'Podaj hasło ekipy.' });
    if (this.teamRoutes[route]) return this.teamRoutes[route](req, res, url);

    const action = url.pathname.slice('/api/'.length);
    if (req.method === 'POST' && this.actions.has(action)) return this.runAction(req, res, action);
    return send(res, 404, { error: 'Nie ma takiej akcji.' });
  }

  /** Stan dla przeglądarki razem z informacją o trybie admina. */
  stateFor(admin) {
    return { ...this.trip.toPublic(), admin, adminEnabled: this.config.adminEnabled };
  }

  // ---------- trasy ----------

  async login(req, res) {
    const { password } = await readJson(req);
    const result = this.config.password ? this.auth.checkPassword(req, password, this.config.password) : 'ok';
    if (result === 'blocked') return send(res, 429, { error: 'Za dużo prób. Spróbuj za kilka minut.' });
    if (result === 'wrong') return send(res, 401, { error: 'Złe hasło.' });
    res.setHeader('Set-Cookie', Auth.cookie(req, Auth.TEAM_COOKIE, this.auth.team.issue(), this.auth.team.maxAgeSeconds));
    return send(res, 200, { ok: true });
  }

  logout(req, res) {
    res.setHeader('Set-Cookie', [Auth.cookie(req, Auth.TEAM_COOKIE, '', 0), Auth.cookie(req, Auth.ADMIN_COOKIE, '', 0)]);
    return send(res, 200, { ok: true });
  }

  async adminLogin(req, res) {
    if (!this.config.adminEnabled) return send(res, 400, { error: 'Tryb admina jest wyłączony (brak ADMIN_PASSWORD).' });
    const { password } = await readJson(req);
    const result = this.auth.checkPassword(req, password, this.config.adminPassword);
    if (result === 'blocked') return send(res, 429, { error: 'Za dużo prób. Spróbuj za kilka minut.' });
    if (result === 'wrong') return send(res, 401, { error: 'Złe hasło admina.' });
    res.setHeader('Set-Cookie', Auth.cookie(req, Auth.ADMIN_COOKIE, this.auth.admin.issue(), this.auth.admin.maxAgeSeconds));
    return send(res, 200, this.stateFor(true));
  }

  adminLogout(req, res) {
    res.setHeader('Set-Cookie', Auth.cookie(req, Auth.ADMIN_COOKIE, '', 0));
    return send(res, 200, this.stateFor(false));
  }

  state(req, res, url) {
    if (url.searchParams.get('v') === String(this.trip.version)) return send(res, 200, { unchanged: true, v: this.trip.version });
    return send(res, 200, this.stateFor(this.auth.isAdmin(req)));
  }

  export(req, res) {
    const day = new Date().toISOString().slice(0, 10);
    return send(res, 200, this.trip.data, { 'Content-Disposition': `attachment; filename="pga-${day}.json"` });
  }

  async runAction(req, res, action) {
    const body = await readJson(req);
    const ctx = { admin: this.auth.isAdmin(req) };
    if (this.actions.run(action, body, ctx)) this.store.write(this.trip.data);
    return send(res, 200, this.stateFor(ctx.admin));
  }
}

module.exports = HttpServer;
