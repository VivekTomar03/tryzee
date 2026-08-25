const { join } = require("path");

/**
 * Puppeteer's default cache is $HOME/.cache/puppeteer. On Render that resolves
 * to /opt/render/.cache, which is NOT carried from the build container into the
 * runtime one — Chromium downloads during build and is then missing at runtime
 * ("Could not find Chrome").
 *
 * Pinning the cache inside the project directory keeps the browser next to the
 * code, so it survives into runtime. This file is the officially supported
 * mechanism and applies to both `npm install` and `puppeteer.launch()`, unlike
 * PUPPETEER_CACHE_DIR which only helps if the host actually sets it.
 */
module.exports = {
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
