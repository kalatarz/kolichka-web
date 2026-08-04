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
// Public (keyless) website endpoint used as a fallback when the API key is
// missing or its quota/token is exhausted. Same {data,…} shape as the API.
const FOODBASE_PUBLIC_SEARCH = `${FOODBASE_WEB_BASE}/search.json`;
// Allow the keyless public fallback (default on) so the feature keeps working
// when the daily API quota is spent. Set FOODBASE_ALLOW_PUBLIC=false to disable.
const FOODBASE_ALLOW_PUBLIC = process.env.FOODBASE_ALLOW_PUBLIC !== 'false';

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
  // Enabled when we have a key OR the keyless public fallback is allowed.
  FOODBASE_ENABLED: !!FOODBASE_API_KEY || FOODBASE_ALLOW_PUBLIC,
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

// Product display names carry size/units/store-brand codes that break FoodBase's
// fuzzy match (e.g. "NN Хляб Добруджа нарязан 650 гр (650 g)"). Strip to the
// searchable name ("Хляб Добруджа нарязан"). Mirrors the web app's cleanName.
const FB_UNIT = new Set(['г', 'гр', 'грама', 'кг', 'мл', 'л', 'бр', 'броя', 'g', 'kg', 'ml', 'l', 'x', 'х']);
function fbCleanQuery(s) {
  const raw = String(s == null ? '' : s);
  let toks = raw.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter((t) => {
    const w = t.replace(/[.,]/g, '').toLowerCase();
    if (!w) return false;
    if (/^\d/.test(w)) return false;        // sizes / quantities: "200gr", "650"
    if (w.endsWith('%')) return false;
    if (FB_UNIT.has(w)) return false;
    return true;
  });
  // When a Cyrillic product term is present, drop pure-Latin tokens — brand
  // names / store codes ("Lakhmy", "MILKA", "NN") that add no useful signal and
  // often match nothing — so the search stays on the generic product ("шоколад").
  const isCyr = (t) => /[Ѐ-ӿ]/.test(t);
  if (toks.some(isCyr)) toks = toks.filter(isCyr);
  const out = toks.join(' ').trim();
  return out || raw.trim();
}
// Search endpoints return a LIGHT item (no nutrition_summary / ecoscore). The
// authenticated detail endpoint /foods/{id} has the full macros + ecoscore (same
// data the website product page shows). Fetch it to enrich the one result the
// modal displays. Respects the free plan's 1 req/sec (retry once).
async function fbDetail(id, lang) {
  if (!FOODBASE_API_KEY || !id) return null;
  const u = `${FOODBASE_API_BASE}/foods/${encodeURIComponent(id)}?lang=${encodeURIComponent(lang)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fbGet(u, { 'X-API-Key': FOODBASE_API_KEY }, 8000);
    if (r.ok && r.body && r.body.id) return r.body;
    if (r.status === 429 && attempt === 0) { await new Promise((res) => setTimeout(res, 1100)); continue; }
    return null;
  }
  return null;
}

// One search attempt: authenticated API first, public fallback second.
async function fbSearch(q, lang, limit) {
  const api = await fbFromApi(q, lang, limit);
  if (api.kind === 'ok') return { kind: 'ok', data: api.data, source: 'api' };
  const pub = await fbFromPublic(q, lang, limit);
  if (pub.kind === 'ok') return { kind: 'ok', data: pub.data, source: 'public' };
  if (api.kind === 'quota' || pub.kind === 'quota') return { kind: 'quota' };
  if (api.kind === 'auth') return { kind: 'auth' };
  return { kind: 'error' };
}
// Broader forms of a cleaned query, most-precise first, for when the precise
// query matches nothing ("млечен шоколад с череша" → "млечен шоколад" → "шоколад").
function fbBroaden(q) {
  const cyr = q.split(/\s+/).filter((t) => /[Ѐ-ӿ]/.test(t));
  const out = [];
  if (cyr.length > 2) out.push(cyr.slice(0, 2).join(' '));
  if (cyr.length > 1) out.push(cyr[cyr.length - 1]); // head noun is usually last in BG (adj+noun)
  return out;
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

async function fbGet(url, headers, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: ctrl.signal });
    let body = null;
    try { body = await r.json(); } catch (_) { /* non-JSON */ }
    return { status: r.status, ok: r.ok, body };
  } catch (_) {
    return { status: 0, ok: false, body: null };
  } finally {
    clearTimeout(timer);
  }
}

// Primary path: authenticated API (higher quality, needs a key + daily quota).
// Returns { kind: 'ok'|'quota'|'auth'|'error'|'skip', data? }.
async function fbFromApi(q, lang, limit) {
  if (!FOODBASE_API_KEY) return { kind: 'skip' };
  const u = `${FOODBASE_API_BASE}/foods/search?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}&limit=${limit}`;
  const r = await fbGet(u, { 'X-API-Key': FOODBASE_API_KEY }, 12000);
  if (r.status === 429) return { kind: 'quota' };
  if (r.status === 401 || r.status === 403) return { kind: 'auth' };
  // Some quota states arrive as HTTP 200 with an {error} body.
  if (r.body && r.body.error && r.body.data == null) {
    return { kind: /quota|limit/i.test(String(r.body.error)) ? 'quota' : 'error' };
  }
  if (!r.ok || !r.body || !Array.isArray(r.body.data)) return { kind: 'error' };
  return { kind: 'ok', data: r.body.data };
}

// Fallback path: the public website's keyless search.json (same {data,…} shape).
// Doesn't consume the API-key quota; used when the key is absent/exhausted.
async function fbFromPublic(q, lang, limit) {
  if (!FOODBASE_ALLOW_PUBLIC) return { kind: 'skip' };
  const u = `${FOODBASE_PUBLIC_SEARCH}?q=${encodeURIComponent(q)}&page=1&lang=${encodeURIComponent(lang)}`;
  // foodbase.dev's public endpoint intermittently returns Cloudflare 502/520/524
  // (or drops the connection) for some queries — retry with a short per-attempt
  // timeout so a hanging query can't stall the request.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fbGet(u, {}, 6000);
    if (r.ok && r.body && Array.isArray(r.body.data)) return { kind: 'ok', data: r.body.data.slice(0, limit) };
    if (r.status === 429) return { kind: 'quota' };
    if (attempt < 1) await new Promise((res) => setTimeout(res, 300));
  }
  return { kind: 'error' };
}

async function handleFoodbaseSearch(req, res, url) {
  if (req.method !== 'GET') return sendJSON(res, 405, { error: 'method_not_allowed' });
  if (!FOODBASE_API_KEY && !FOODBASE_ALLOW_PUBLIC) {
    return sendJSON(res, 503, { error: 'foodbase_disabled', message: 'FoodBase is not configured.' });
  }

  const rawQ = (url.searchParams.get('q') || '').trim();
  if (!rawQ) return sendJSON(res, 400, { error: 'missing_query', message: 'q is required.' });
  const q = fbCleanQuery(rawQ) || rawQ; // normalise the product name before searching
  const lang = (url.searchParams.get('lang') || 'bg').trim();
  let limit = parseInt(url.searchParams.get('limit') || '5', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 5;
  if (limit > 10) limit = 10;

  const cacheKey = `${lang}:${limit}:${q.toLowerCase()}`;
  const hit = FB_CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < FB_TTL_MS) {
    return sendJSON(res, 200, { ...hit.payload, cached: true });
  }

  // Authenticated API first, public fallback second.
  const first = await fbSearch(q, lang, limit);
  if (first.kind !== 'ok') {
    if (first.kind === 'quota') return sendJSON(res, 429, { error: 'quota', message: 'Дневният лимит към FoodBase е достигнат.' });
    if (first.kind === 'auth') return sendJSON(res, 502, { error: 'auth', message: 'Невалиден ключ за FoodBase.' });
    return sendJSON(res, 502, { error: 'upstream_error', message: 'FoodBase не е достъпен в момента.' });
  }
  let source = first.source;
  let usedQ = q;
  let results = first.data.map(fbNormalize);
  // Precise query found nothing → broaden toward the generic product term.
  if (results.length === 0) {
    for (const b of fbBroaden(q)) {
      if (!b || b.toLowerCase() === usedQ.toLowerCase()) continue;
      const more = await fbSearch(b, lang, limit);
      if (more.kind === 'ok' && more.data.length) { results = more.data.map(fbNormalize); usedQ = b; source = more.source; break; }
    }
  }
  // Enrich the top result (shown in the modal) with detail-endpoint macros +
  // ecoscore that search omits — the "more data" the website product page has.
  if (results.length && results[0].id) {
    const det = await fbDetail(results[0].id, lang);
    if (det) { results[0] = fbNormalize(det); source = source === 'public' ? 'public+detail' : 'detail'; }
  }
  const payload = { query: rawQ, search_query: usedQ, article_url: fbArticleUrl(usedQ), source, count: results.length, results };

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
  console.log(`    FOODBASE:        ${KOLICHKA_CONFIG.FOODBASE_ENABLED ? 'enabled' : 'disabled'} (key:${FOODBASE_API_KEY ? 'yes' : 'no'}, public-fallback:${FOODBASE_ALLOW_PUBLIC ? 'on' : 'off'})`);
  console.log(`  ─────────────────────────────────────\n`);
});
