/**
 * Kolichka Web — Runtime Configuration
 *
 * This file is loaded before the main app scripts and defines
 * window.__KOLICHKA_CONFIG__, which the frontend reads for all
 * external URLs, branding, and optional features.
 *
 * For development, this file is generated automatically by server.js
 * from .env variables. For static hosting, edit it manually or
 * generate it during your build process.
 */

window.__KOLICHKA_CONFIG__ = {

  /** API base URL — leave as '/' for same-origin proxy setups.
   *  Set to a full URL (e.g. 'https://api.example.com') for cross-origin. */
  API_BASE_URL: '/',

  /** Application display name shown in the UI title and notifications. */
  APP_NAME: 'Kolichka',

  /** Public-facing app URL — used for og:url, canonical links, etc. */
  APP_URL: '',

  /** Discord community invite link (empty to hide). */
  DISCORD_URL: '',

  /** Data source attribution link (empty to hide). */
  DATA_SOURCE_URL: '',

  /** Contact email shown in the UI footer/feedback section. */
  FEEDBACK_EMAIL: '',

  /** Privacy/DPO contact email shown in the footer. */
  PRIVACY_EMAIL: '',

  /** Umami-compatible analytics script URL (empty to disable tracking). */
  ANALYTICS_SCRIPT: '',

  /** Umami website ID (required if ANALYTICS_SCRIPT is set). */
  ANALYTICS_WEBSITE_ID: '',
};
