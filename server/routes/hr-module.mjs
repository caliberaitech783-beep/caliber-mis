import express from 'express';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const website = 'https://hrpulse.cmll.in';
const api = 'https://hr-api-cmll-783.azurewebsites.net';
const identity = 'https://pulse.cmll.in';
const staticMethods = new Set(['GET', 'HEAD']);
const apiMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const sessionActions = new Set(['authenticate', 'validate', 'logout']);
const publicFiles = /^(?:\/assets\/[\w.-]+|\/ocr\/(?:runtime\/)?[\w.-]+|\/(?:caliber-theme\.css|azure-connection\.js|attendance-module\.html|pulse-logo\.png|employee-letter[\w.-]+\.(?:png|jpg)|hpc-wage-rate-order\.jpg))$/;

// The legacy calculator uses inline scripts and handlers. Keep them in an
// opaque sandbox so it cannot access the Pulse-II or HR session storage.
const attendancePolicy = "sandbox allow-scripts allow-downloads; default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js; " +
  "style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  "img-src data: blob:; connect-src https://api.telegram.org; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

export function registerHrModule(app, {request = fetch, origin = 'https://pulse-ll.cmll.in'} = {}) {
  const router = express.Router();
  const sessionBody = express.json({limit: '8kb'});
  const apiBody = express.json({limit: '2mb'});

  async function forward(req, res, upstream, pathname, {privateResponse = false, body, authorize = false} = {}) {
    const target = new URL(upstream);
    target.pathname = pathname;
    if (!privateResponse || authorize) target.search = new URL(req.originalUrl, origin).search;
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authorize) headers.Authorization = req.headers.authorization;
    const clientClosed = new AbortController();
    const abort = () => clientClosed.abort();
    res.once('close', abort);
    try {
      const response = await request(target, {
        method: req.method, headers, body, redirect: 'error',
        signal: AbortSignal.any([clientClosed.signal, AbortSignal.timeout(60_000)]),
      });
      res.status(response.status);
      const type = response.headers.get('content-type');
      if (type) res.set('Content-Type', type);
      if (!privateResponse) {
        const cache = response.headers.get('cache-control');
        if (cache) res.set('Cache-Control', cache);
      }
      if (pathname === '/attendance-module.html') res.set('Content-Security-Policy', attendancePolicy);
      if (!response.body || req.method === 'HEAD') return res.end();
      await pipeline(Readable.fromWeb(response.body), res);
    } catch {
      if (!res.headersSent && !res.destroyed) res.status(502).json({error: 'HR is temporarily unavailable. Please try again.'});
    } finally {
      res.off('close', abort);
    }
  }

  function requireLocalOrigin(req, res, next) {
    res.set('Cache-Control', 'no-store');
    if (req.headers.origin && req.headers.origin !== origin) return res.status(403).json({error: 'Origin not allowed.'});
    next();
  }

  router.use('/session', requireLocalOrigin, sessionBody, (req, res) => {
    const action = req.path.slice(1);
    if (req.method !== 'POST' || !sessionActions.has(action)) return res.status(404).json({error: 'HR sign-in route not found.'});
    if (!req.is('application/json') || !req.body || Array.isArray(req.body)) return res.status(400).json({error: 'JSON request required.'});
    return forward(req, res, identity, '/api/integrations/hr/' + action, {privateResponse: true, body: JSON.stringify(req.body)});
  });

  router.use('/api', requireLocalOrigin, apiBody, (req, res) => {
    if (!apiMethods.has(req.method) || req.path === '/' ||
        /(?:\.{2}|%2e|%2f|%5c|\\)/i.test(req.path) ||
        /^\/(?:telegram\/[^/]*webhook|attendance\/bridge)(?:\/|$)/i.test(req.path)) {
      return res.status(404).json({error: 'HR API route not found.'});
    }
    if (!/^Bearer [\w-]{43}$/.test(req.headers.authorization || '')) {
      return res.status(401).json({error: 'HR sign-in required.'});
    }
    return forward(req, res, api, '/api' + req.path, {
      privateResponse: true, authorize: true,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
    });
  });

  router.use((req, res) => {
    if (!staticMethods.has(req.method)) return res.status(405).set('Allow', 'GET, HEAD').end();
    if (req.path === '/') return forward(req, res, website, '/');
    if (!publicFiles.test(req.path) || req.path.includes('..')) return res.status(404).type('text').send('HR file not found.');
    return forward(req, res, website, req.path);
  });

  app.use('/hr', (req, res, next) => {
    if (staticMethods.has(req.method) && req.originalUrl.split('?')[0] === '/hr') return res.redirect(308, '/hr/');
    next();
  }, router);
}
