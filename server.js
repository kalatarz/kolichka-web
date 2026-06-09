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

// ── Request handler ─────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

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

// ── API proxy middleware ────────────────────────────────────────
const apiProxy = createProxyMiddleware(['/api', '/auth'], {
  target: API_PROXY_URL,
  changeOrigin: true,
  logLevel: 'debug',
});

server.use(apiProxy);

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
  console.log(`  ─────────────────────────────────────\n`);
});
