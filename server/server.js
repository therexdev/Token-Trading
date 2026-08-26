#!/usr/bin/env node
/* ============================================================
   Trade Koinos — static host + Google sign-in bridge.

   The trading UI is a static Vite bundle and works with Kondor alone, with
   no server at all (that is how trade.koinoskit.site is deployed over FTP).
   This process exists for one extra capability: Google sign-in, which needs
   a server-side hop because the browser cannot make the call itself —
   aurvania.com rejects unfamiliar User-Agents, and browsers cannot set
   one.

   So the frontend feature-detects: it asks /api/config, and only shows the
   Google button when this server answers that Google is configured. Served
   as flat files instead, the app silently stays Kondor-only.

   Run it:  npm install && npm run build && npm start
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createAuth } = require('./auth');

const ROOT = path.join(__dirname, '..');
const DIST = process.env.STATIC_DIR
  ? path.resolve(process.env.STATIC_DIR)
  : path.join(ROOT, 'frontend', 'dist');

const CFG = {
  port: Number(process.env.PORT || 3000),
  /* Aurvania's Google client id. Leave unset to inherit it at boot — the ID
     token must carry Aurvania's `aud` or it is rejected downstream. */
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  aurvaniaApi: (process.env.AURVANIA_API || 'https://aurvania.com').replace(/\/+$/, ''),
  /* Hostinger terminates TLS in front of the app, so the client IP arrives
     in X-Forwarded-For. Count the hops you actually trust; 0 disables the
     header entirely so nobody can spoof their way past the rate limiter. */
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS || 0),
};

const auth = createAuth({
  googleClientId: CFG.googleClientId,
  aurvaniaApi: CFG.aurvaniaApi,
});

/* ---------------- rate limiting ---------------- */

const hits = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || rec.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  rec.n += 1;
  return rec.n > limit;
}
/* The map only grows on new keys, so sweep it rather than leak one entry per
   IP for the life of the process. */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}, 10 * 60000).unref();

function clientIp(req) {
  if (CFG.trustProxyHops > 0) {
    const chain = String(req.headers['x-forwarded-for'] || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    /* Take the hop our own proxy appended, counting from the right. Reading
       the leftmost entry would trust whatever the client sent. */
    const ip = chain[chain.length - CFG.trustProxyHops];
    if (ip) return ip;
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

/* ---------------- responses ---------------- */

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/* A key travels through this server on its way to the browser, so the
   headers that keep injected script out of the page are load-bearing, not
   boilerplate. The bundle has no inline <script>, which is what lets
   script-src stay strict; inline style attributes (React's style={{…}}) do
   need 'unsafe-inline'. connect-src stays broad because the RPC endpoint is
   chosen at build time and may be any host. */
function securityHeaders(res) {
  const google = auth.googleEnabled()
    ? " https://accounts.google.com https://accounts.google.com/gsi/"
    : '';
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self'${google}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      `frame-src${google || " 'none'"}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
}

/* ---------------- api ---------------- */

const api = {};

/* What the browser needs to decide whether to draw the Google button, and
   which client id to mint the ID token for. */
api.config = () => ({
  auth: {
    google: auth.googleEnabled(),
    googleClientId: auth.googleEnabled() ? auth.googleClientId() : null,
  },
});

api.health = () => ({ ok: true, google: auth.googleEnabled() });

api.auth = async (body, ip) => {
  const action = String(body.action || '');
  if (rateLimited('auth:' + ip, 30, 3600000)) {
    const e = new Error('too many sign-in attempts — wait a few minutes');
    e.status = 429; throw e;
  }
  if (action === 'google') {
    const r = await auth.google(body.idToken);
    return { ok: true, wif: r.wif, address: r.address, created: r.created, label: r.label };
  }
  const e = new Error('unknown action');
  e.status = 400; throw e;
};

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const e = new Error('request too large');
      e.status = 413; throw e;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (_) { const e = new Error('invalid JSON body'); e.status = 400; throw e; }
}

/* ---------------- static ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function serveFile(res, file, { spa = false } = {}) {
  let data;
  try { data = fs.readFileSync(file); }
  catch (_) { return false; }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': data.length,
    /* Vite fingerprints everything under /assets, so those may be cached
       hard. index.html must not be, or a deploy never reaches the browser. */
    'Cache-Control': spa || ext === '.html'
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  });
  res.end(data);
  return true;
}

/* Resolve a URL path inside DIST, refusing anything that escapes it. */
function safeJoin(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const file = path.join(DIST, decoded);
  const rel = path.relative(DIST, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = String(req.url || '/');
  const pathname = url.split('?')[0];

  try {
    if (pathname === '/api/config') return sendJson(res, 200, api.config());
    if (pathname === '/api/health') return sendJson(res, 200, api.health());

    if (pathname === '/api/auth') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      const body = await readBody(req);
      return sendJson(res, 200, await api.auth(body, clientIp(req)));
    }

    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    const file = safeJoin(pathname === '/' ? '/index.html' : pathname);
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
      if (serveFile(res, file)) return;
    }

    /* Unknown path → the SPA shell. The app routes on the hash, so this only
       catches typed URLs and refreshes, never a missing asset. */
    if (!pathname.startsWith('/assets/')) {
      if (serveFile(res, path.join(DIST, 'index.html'), { spa: true })) return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  } catch (error) {
    const status = error && error.status ? error.status : 500;
    if (status >= 500) console.error('[error]', error && error.message);
    sendJson(res, status, { error: (error && error.message) || 'server error' });
  }
});

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`\n[fatal] no built frontend at ${DIST}`);
    console.error('        run "npm run build" first (it builds frontend/dist).\n');
    process.exit(1);
  }

  await auth.warmup();

  server.listen(CFG.port, () => {
    console.log(`Trade Koinos listening on :${CFG.port}`);
    console.log(`static:   ${DIST}`);
    if (auth.googleEnabled()) {
      console.log(`auth:     Google sign-in ENABLED (bridged to ${auth.aurvania()} — shared wallet with Aurvania / OURO)`);
      if (!CFG.googleClientId) console.log('          client id inherited from Aurvania at boot');
    } else {
      console.log(`auth:     Google sign-in OFF — could not resolve a client id from ${auth.aurvania()}`);
      console.log('          set GOOGLE_CLIENT_ID to Aurvania\'s client id, or restart once it is reachable');
    }
    if (!CFG.trustProxyHops) {
      console.log('note:     TRUST_PROXY_HOPS is 0 — behind Hostinger set it to 1 so rate limits see the real client IP');
    }
  });
})();
