# Kolichka Web

[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

Open-source web interface for the Kolichka grocery price comparison platform. This is the **web frontend** — a static UI that connects to any Kolichka-compatible API backend.

## Try it (live demo)

A live instance runs at **[kolichka.gotvach.com](https://kolichka.gotvach.com)** — a free grocery price-comparison app for Bulgaria. Things to try:

- 🛒 **[Open a ready-made basket](https://kolichka.gotvach.com/?b=%D0%A5%D0%BB%D1%8F%D0%B1%2C%D0%9F%D1%80%D1%8F%D1%81%D0%BD%D0%BE+%D0%BC%D0%BB%D1%8F%D0%BA%D0%BE%2C%D0%AF%D0%B9%D1%86%D0%B0%2C%D0%9A%D0%B0%D1%88%D0%BA%D0%B0%D0%B2%D0%B0%D0%BB%2C%D0%9F%D0%B8%D0%BB%D0%B5%D1%88%D0%BA%D0%BE+%D1%84%D0%B8%D0%BB%D0%B5%2C%D0%91%D0%B0%D0%BD%D0%B0%D0%BD%D0%B8%2C%D0%A1%D0%BB%D1%8A%D0%BD%D1%87%D0%BE%D0%B3%D0%BB%D0%B5%D0%B4%D0%BE%D0%B2%D0%BE+%D0%BE%D0%BB%D0%B8%D0%BE)** (хляб, мляко, яйца, кашкавал, пилешко, банани, олио) and compare it across nearby stores — every basket gets a **shareable link** like that, so you can send your list to family
- ⭐ Save **favorites** and track their prices over time
- 🔔 Enable **push notifications** for weekly deals near you
- 📧 Subscribe by **email** for the best weekly offers
- 🗺️ **[Classic map view](https://kolichka.gotvach.com/classic.html)**

## What is Kolichka?

Kolichka is a Bulgarian grocery store price comparison platform that helps users find the best prices across local supermarkets. This repository contains the static web UI — it connects to any Kolichka-compatible API backend.

## Quick Start

### Prerequisites
- Node.js 18+
- A running Kolichka-compatible API backend (serving the endpoints in the [API Contract](#api-contract) below)

### Development

```bash
# Clone and install
git clone https://github.com/kalatarz/kolichka-web.git
cd kolichka-web
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your backend URL and settings

# Start dev server (port 3000)
npm start
```

Open http://localhost:3000 in your browser.

### Configuration

All runtime configuration is loaded via `.env` (dev server) or `web/config.js` (static hosting):

| Variable | Description | Default |
|---|---|---|
| `API_PROXY_URL` | Backend API URL (proxied at `/api`) | `http://localhost:3001` |
| `APP_NAME` | Display name in UI | `Kolichka` |
| `APP_URL` | Public-facing URL (og:url, canonical) | *(empty)* |
| `DISCORD_URL` | Discord community link | *(empty)* |
| `DATA_SOURCE_URL` | Data source attribution link | *(empty)* |
| `ANALYTICS_SCRIPT` | Umami-compatible analytics script URL | *(disabled)* |
| `ANALYTICS_WEBSITE_ID` | Analytics website ID | *(disabled)* |

## Static Hosting (Production)

For production, you can serve the `web/` directory as static files from any web server (nginx, Caddy, Apache, etc.). The only requirement is that `/api/*` requests are proxied to your backend.

### Nginx example

```nginx
server {
    listen 80;
    server_name kolichka.example.com;

    # Static files
    root /path/to/kolichka-web/web;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Auth endpoints
    location /auth/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
    }
}
```

### Caddy example

```
kolichka.example.com {
    root * /path/to/kolichka-web/web
    file_server
    encode gzip

    @api path /api/* /auth/*
    reverse_proxy @api localhost:3001
}
```

### Custom config.js for static hosting

If you are not using the Node dev server, create `web/config.js` manually:

```javascript
window.__KOLICHKA_CONFIG__ = {
  API_BASE_URL: '/',
  APP_NAME: 'Kolichka',
  APP_URL: 'https://kolichka.example.com',
  DISCORD_URL: 'https://discord.gg/your-invite',
  DATA_SOURCE_URL: 'https://kolkostruva.bg',
  ANALYTICS_SCRIPT: '',
  ANALYTICS_WEBSITE_ID: '',
};
```

## Project Structure

```
kolichka-web/
├── web/                    # Static frontend files
│   ├── index.html          # Redirects to v2.html
│   ├── v2.html             # Main modern UI
│   ├── classic.html        # Classic map-based UI
│   ├── config.js           # Runtime configuration (generated or manual)
│   ├── manifest.json       # PWA manifest
│   ├── push-sw.js          # Push notification service worker
│   ├── favicon.ico
│   └── favicon-512.png
├── server.js               # Node.js dev/proxy server
├── package.json
├── .env.example            # Environment template
├── .gitignore
├── LICENSE                 # GPLv3
├── CHANGELOG.md
└── README.md
```

## API Contract

The frontend expects a Kolichka-compatible backend serving these endpoints:

- `GET /api/stores` — List all stores
- `GET /api/stores/nearby?lat=&lng=&radius=` — Stores near coordinates
- `GET /api/compare?store_ids=&product_name=` — Price comparison
- `GET /version.json` — Version/health check

## License

This project is licensed under the GNU General Public License v3.0 — see [LICENSE](LICENSE) for details.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request
