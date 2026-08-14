# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Nutrition scores via [foodbase.dev](https://foodbase.dev): a green leaf on product,
  hero and promotion cards opens Nutri-Score / Eco-Score / NOVA badges and per-100 g macros
- `GET /api/foodbase/search` backend function in `server.js` — server-side key injection,
  product-name normalisation, query broadening, detail-endpoint enrichment, 10-minute cache
- Keyless public fallback (`FOODBASE_ALLOW_PUBLIC`, default on) so the feature works
  without an API key and survives daily-quota exhaustion
- `Dockerfile.node` + `docker-compose.staging.yml` — Node runtime that hosts the backend
  function while proxying the rest of `/api` to the real backend

### Fixed
- `/api` and `/auth` reverse proxy was broken under http-proxy-middleware v3 (it no longer
  accepts a path array, and `http.Server` has no `.use()`); path matching now happens in the
  request handler

## [2.0.0] — 2025-07-11

### Added
- Initial open-source release extracted from Kolichka v2 frontend
- Dual UI: modern `v2.html` and classic map-based `classic.html`
- Runtime configuration via `config.js` (API URL, branding, analytics)
- Node.js dev server with API proxy (`server.js`)
- PWA manifest and push notification service worker support
- GPLv3 license

### Changed
- Removed hardcoded domains — all URLs are now configurable
- Removed default analytics tracking (opt-in via config)
- Parameterized Discord and data source links
- All fetch calls use relative paths, compatible with reverse proxy deployment
