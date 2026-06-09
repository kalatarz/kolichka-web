# ── Stage 1: Build config.js from env vars ──────────────────────
FROM node:20-alpine AS builder

WORKDIR /build
COPY web/ ./web/

# Read env vars and generate config.js
RUN cat > /build/web/config.js << 'CONFIGEOF'
window.__KOLICHKA_CONFIG__ = {
  API_BASE_URL: "/",
  APP_NAME: "${APP_NAME:-Kolichka}",
  APP_URL: "${APP_URL:-}",
  DISCORD_URL: "${DISCORD_URL:-}",
  DATA_SOURCE_URL: "${DATA_SOURCE_URL:-}",
  ANALYTICS_SCRIPT: "${ANALYTICS_SCRIPT:-}",
  ANALYTICS_WEBSITE_ID: "${ANALYTICS_WEBSITE_ID:-}",
};
CONFIGEOF

# ── Stage 2: Nginx serves static files ──────────────────────────
FROM nginx:alpine AS production

COPY --from=builder /build/web/ /usr/share/nginx/html/

# Default nginx config serves static files.
# Reverse proxy for /api should be configured via nginx conf override or compose.
RUN echo '{"version":"2.0.0"}' > /usr/share/nginx/html/version.json

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
