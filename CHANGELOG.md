# Changelog

All notable changes to this project will be documented in this file.

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
