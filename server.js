#!/usr/bin/env node
/**
 * Kolichka Web — Development Server
 *
 * Serves static files from ./web and proxies /api/* to a backend.
 * Configuration is loaded from .env (or .env.example fallback).
 *
 * Usage:
 *   npm install          # installs http-proxy-middleware + dotenv
 *   cp .env.example .env  # edit your values
 *   node server.js        # starts on port 3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
require('dotenv').config();

// ── Configuration ───────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const API_PROXY_URL = process.env.API_PROXY_URL || 'http://localhost:3001';

// FoodBase (foodbase.dev) nutrition integration. The API key is server-side
// only — never sent to the browser. The frontend only sees FOODBASE_ENABLED.
const FOODBASE_API_KEY = process.env.FOODBASE_API_KEY || '';
const FOODBASE_API_BASE = process.env.FOODBASE_API_BASE || 'https://foodbase.dev/v1';
const FOODBASE_WEB_BASE = 'https://foodbase.dev/products';

// Build the config object that the frontend reads from config.js
const KOLICHKA_CONFIG = {
  API_BASE_URL: '/',                          // relative — proxied by this server
  APP_NAME: process.env.APP_NAME || 'Kolichka',
  APP_URL: process.env.APP_URL || '',
  DISCORD_URL: process.env.DISCORD_URL || '',
  DATA_SOURCE_URL: process.env.DATA_SOURCE_URL || '',
  FEEDBACK_EMAIL: process.env.FEEDBACK_EMAIL || '',
  PRIVACY_EMAIL: process.env.PRIVACY_EMAIL || '',
  ANALYTICS_SCRIPT: process.env.ANALYTICS_SCRIPT || '',
  ANALYTICS_WEBSITE_ID: process.env.ANALYTICS_WEBSITE_ID || '',
  // Frontend gates the nutrition UI on this; the key itself stays server-side.
  FOODBASE_ENABLED: !!FOODBASE_API_KEY,
};

// ── MIME types ──────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const WEB_DIR = path.join(__dirname, 'web');

// ── Generate config.js on the fly ───────────────────────────────
function configJS() {
  return `window.__KOLICHKA_CONFIG__ = ${JSON.stringify(KOLICHKA_CONFIG)};`;
}

// ── Version endpoint (for frontend health check) ────────────────
const VERSION_JSON = JSON.stringify({ version: '2.0.0', build: new Date().toISOString() });

// ── FoodBase backend function ───────────────────────────────────
// GET /api/foodbase/search?q=<name>&lang=bg&limit=5
// Proxies foodbase.dev with the server-side key, normalises the response, and
// returns the public article link. A small in-memory TTL cache conserves the
// (currently 100/day) API quota across repeated lookups of the same product.
const FB_CACHE = new Map();               // key -> { at, payload }
const FB_TTL_MS = 10 * 60 * 1000;         // 10 min
const FB_CACHE_MAX = 300;

function fbArticleUrl(q) {
  return `${FOODBASE_WEB_BASE}?q=${encodeURIComponent(q)}`;
}

function fbGrade(v) {
  if (typeof v !== 'string') return null;
  const c = v.trim().toLowerCase()[0];
  return c && c >= 'a' && c <= 'e' ? c : null;
}

function fbDisplayName(it) {
  if (typeof it.name_localized === 'string' && it.name_localized.trim()) return it.name_localized.trim();
  const fromEntry = (e) => {
    if (typeof e === 'string' && e.trim()) return e.trim();
    if (e && typeof e === 'object') {
      for (const k of ['value', 'name', 'text', 'label']) {
        if (typeof e[k] === 'string' && e[k].trim()) return e[k].trim();
      }
    }
    return null;
  };
  if (typeof it.name === 'string' && it.name.trim()) return it.name.trim();
  if (Array.isArray(it.name) && it.name.length) {
    for (const e of it.name) {
      const lang = e && (e.lang || e.language);
      if (String(lang).toLowerCase() === 'bg') { const v = fromEntry(e); if (v) return v; }
    }
    for (const e of it.name) { const v = fromEntry(e); if (v) return v; }
  }
  return typeof it.name_default === 'string' && it.name_default.trim() ? it.name_default.trim() : '—';
}

function fbNormalize(it) {
  const ns = it.nutrition_summary && typeof it.nutrition_summary === 'object' ? it.nutrition_summary : {};
  const num = (v) => (typeof v === 'number' ? v : null);
  return {
    id: String(it.id || ''),
    name: fbDisplayName(it),
    brand: typeof it.brand === 'string' && it.brand.trim() ? it.brand.trim() : null,
    nutriscore: fbGrade(it.nutriscore),
    nova_group: typeof it.nova_group === 'number' ? Math.round(it.nova_group) : null,
    ecoscore: fbGrade(it.ecoscore_grade),
    image_url: typeof it.image_url === 'string' && it.image_url ? it.image_url : null,
    nutrition: {
      energy_kcal: num(ns.energy_kcal),
      proteins_g: num(ns.proteins_g),
      carbs_g: num(ns.carbs_g),
      sugars_g: num(ns.sugars_g),
      fat_g: num(ns.fat_g),
      fiber_g: num(ns.fiber_g),
    },
  };
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}

async function handleFoodbaseSearch(req, res, url) {
  if (req.method !== 'GET') return sendJSON(res, 405, { error: 'method_not_allowed' });
  if (!FOODBASE_API_KEY) return sendJSON(res, 503, { error: 'foodbase_disabled', message: 'FoodBase is not configured.' });

  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return sendJSON(res, 400, { error: 'missing_query', message: 'q is required.' });
  const lang = (url.searchParams.get('lang') || 'bg').trim();
  let limit = parseInt(url.searchParams.get('limit') || '5', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 5;
  if (limit > 10) limit = 10;

  const cacheKey = `${lang}:${limit}:${q.toLowerCase()}`;
  const hit = FB_CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < FB_TTL_MS) {
    return sendJSON(res, 200, { ...hit.payload, cached: true });
  }

  const upstream = `${FOODBASE_API_BASE}/foods/search?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}&limit=${limit}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let r;
  try {
    r = await fetch(upstream, {
      headers: { 'X-API-Key': FOODBASE_API_KEY, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
  } catch (_) {
    clearTimeout(timer);
    return sendJSON(res, 504, { error: 'upstream_unreachable', message: 'Няма връзка с FoodBase.' });
  }
  clearTimeout(timer);

  if (r.status === 429) return sendJSON(res, 429, { error: 'quota', message: 'Дневният лимит към FoodBase е достигнат.' });
  if (r.status === 401 || r.status === 403) return sendJSON(res, 502, { error: 'auth', message: 'Невалиден ключ за FoodBase.' });

  let body;
  try { body = await r.json(); } catch (_) { return sendJSON(res, 502, { error: 'bad_upstream' }); }

  if (!r.ok || (body && body.error && body.data == null)) {
    // Some quota states arrive as HTTP 200 with an {error,message} body.
    const isQuota = /quota/i.test(body && body.error ? String(body.error) : '');
    return sendJSON(res, isQuota ? 429 : 502, {
      error: isQuota ? 'quota' : 'upstream_error',
      message: (body && body.message) || 'FoodBase грешка.',
    });
  }

  const results = Array.isArray(body.data) ? body.data.map(fbNormalize) : [];
  const payload = { query: q, article_url: fbArticleUrl(q), count: results.length, results };

  FB_CACHE.set(cacheKey, { at: Date.now(), payload });
  if (FB_CACHE.size > FB_CACHE_MAX) FB_CACHE.delete(FB_CACHE.keys().next().value);

  return sendJSON(res, 200, payload);
}

// ── Request handler ─────────────────────────────────────────────
// ── API proxy middleware (backend endpoints other than FoodBase) ─
const apiProxy = createProxyMiddleware({
  target: API_PROXY_URL,
  changeOrigin: true,
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // FoodBase backend function — handled locally (server-side key injection),
  // MUST come before the generic /api proxy below.
  if (url.pathname === '/api/foodbase/search') {
    handleFoodbaseSearch(req, res, url).catch(() => sendJSON(res, 500, { error: 'internal' }));
    return;
  }

  // Everything else under /api or /auth → reverse-proxy to the real backend.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/') ||
      url.pathname === '/auth' || url.pathname.startsWith('/auth/')) {
    return apiProxy(req, res, () => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad gateway');
    });
  }

  // Serve config.js dynamically
  if (url.pathname === '/config.js') {
    res.writeHead(200, {
      'Content-Type': MIME['.js'],
      'Cache-Control': 'no-cache',
    });
    res.end(configJS());
    return;
  }

  // Serve version.json dynamically
  if (url.pathname === '/version.json') {
    res.writeHead(200, {
      'Content-Type': MIME['.json'],
      'Cache-Control': 'no-cache',
    });
    res.end(VERSION_JSON);
    return;
  }

  // Serve static files from ./web
  let filePath = path.join(WEB_DIR, url.pathname);

  // Default to index.html for directory roots
  if (url.pathname === '/' || url.pathname === '') {
    filePath = path.join(WEB_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found: ' + url.pathname);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ── Start ───────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  Kolichka Web Dev Server`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Frontend:  http://localhost:${PORT}`);
  console.log(`  API Proxy: ${API_PROXY_URL}`);
  console.log(`  Config:`);
  console.log(`    APP_NAME:        ${KOLICHKA_CONFIG.APP_NAME}`);
  console.log(`    APP_URL:         ${KOLICHKA_CONFIG.APP_URL || '(not set)'}`);
  console.log(`    DISCORD_URL:     ${KOLICHKA_CONFIG.DISCORD_URL || '(not set)'}`);
  console.log(`    ANALYTICS:       ${KOLICHKA_CONFIG.ANALYTICS_SCRIPT ? 'enabled' : 'disabled'}`);
  console.log(`    FOODBASE:        ${FOODBASE_API_KEY ? 'enabled (key set)' : 'disabled (no key)'}`);
  console.log(`  ─────────────────────────────────────\n`);
});
