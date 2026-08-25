const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");

const scrapRoutes = express.Router();

// A bare "Mozilla/5.0" gets 403'd by most e-commerce sites - send a full
// browser-like header set instead.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
};

// A srcset is "url1 1x, url2 2x" - not a URL. Adding it whole produces an <img>
// src that never loads. Parse out the candidates and keep the highest resolution.
function bestFromSrcset(srcset) {
  if (!srcset) return null;

  const candidates = srcset
    .split(",")
    .map((part) => {
      const [url, descriptor = ""] = part.trim().split(/\s+/);
      if (!url) return null;
      // Descriptors are "1024w" or "2x"; treat a missing one as lowest.
      const size = parseFloat(descriptor) || 0;
      return { url, size };
    })
    .filter(Boolean);

  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.size > a.size ? b : a)).url;
}

// Flipkart and friends expose the same photo at several resolutions through
// separate <source> tags. Collapse them so the picker does not show duplicates.
function imageIdentity(url) {
  try {
    const file = new URL(url).pathname.split("/").pop();
    return file || url;
  } catch {
    return url;
  }
}

function dedupeByIdentity(urls) {
  const seen = new Map();
  for (const url of urls) {
    const id = imageIdentity(url);
    if (!seen.has(id)) seen.set(id, url);
  }
  return [...seen.values()];
}

const AXIOS_TIMEOUT_MS = Number(process.env.SCRAPE_AXIOS_TIMEOUT_MS) || 15000;
const PUPPETEER_TIMEOUT_MS =
  Number(process.env.SCRAPE_PUPPETEER_TIMEOUT_MS) || 45000;

scrapRoutes.post("/", async (req, res) => {
  const { url } = req.body;

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "A valid http(s) url is required." });
  }

  // Callers sometimes pass a direct image URL instead of a product page. There is
  // nothing to scrape there, and Puppeteer would burn ~10s to find nothing.
  if (/\.(jpg|jpeg|png|webp|gif|svg|avif)(\?.*)?$/i.test(url)) {
    console.log(`[scrape] direct image url, returning as-is: ${url}`);
    return res.json({ images: [url] });
  }

  const imageSet = new Set();
  const excludedKeywords = [
    "logo",
    "icon",
    "banner",
    "placeholder",
    "avatar",
    "tracking",
    "sprite",
    "ads",
    "shimmer",
    "constant",
    "loader",
  ];

  const isValidImage = (src) => {
    if (!src || !src.startsWith("http")) return false;
    const lowerSrc = src.toLowerCase();
    return !excludedKeywords.some((keyword) => lowerSrc.includes(keyword));
  };

  const isValidImageUrl = (url) => {
    return url && /\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/.test(url);
  };

  try {
    // Sites like Meesho and Amazon 403 the scraper outright. That must fall
    // through to Puppeteer rather than failing the request, so this stage gets
    // its own catch - previously a 403 here skipped the fallback entirely.
    try {
      const response = await axios.get(url, {
        timeout: AXIOS_TIMEOUT_MS,
        headers: BROWSER_HEADERS,
      });

      const html = response.data;
      const $ = cheerio.load(html);

      // Extract from <picture><source>
      $("picture source").each((_, source) => {
        const best = bestFromSrcset($(source).attr("srcset"));
        if (isValidImageUrl(best) && isValidImage(best)) imageSet.add(best);
      });

      // Lazy-loaded <img srcset> - common on Flipkart / Myntra listings.
      $("img[srcset]").each((_, el) => {
        const best = bestFromSrcset($(el).attr("srcset"));
        if (isValidImageUrl(best) && isValidImage(best)) imageSet.add(best);
      });

      // Extract from <img> tags
      $("img").each((_, el) => {
        const attrs = ["src", "data-src", "data-lazy", "data-original"];
        attrs.forEach((attr) => {
          const val = $(el).attr(attr);
          if (val && isValidImage(val)) {
            imageSet.add(val);
          }
        });
      });

      // Extract from inline styles
      $("[style]").each((_, el) => {
        const style = $(el).attr("style");
        const match = style.match(
          /background(?:-image)?:.*url\(['"]?(.*?)['"]?\)/i
        );
        if (match && isValidImage(match[1])) {
          imageSet.add(match[1]);
        }
      });

      // Fallback to regex over raw HTML
      const regexMatches = html.match(
        /https?:\/\/[^\s<>"']+\.(?:jpg|jpeg|png|webp|gif|svg)/gi
      );
      if (regexMatches) {
        regexMatches.forEach((src) => {
          if (isValidImage(src)) {
            imageSet.add(src);
          }
        });
      }
    } catch (axiosErr) {
      console.log(
        `[scrape] axios+cheerio failed (${
          axiosErr.response?.status ?? axiosErr.code ?? axiosErr.message
        }), falling through to Puppeteer`
      );
    }

    let images = Array.from(imageSet);

    // Fallback to Puppeteer if no good images found
    if (images.length === 0) {
      console.log("[scrape] falling back to Puppeteer for:", url);
      let browser = null;
      try {
        browser = await puppeteer.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--disable-gpu",
            "--disable-blink-features=AutomationControlled",
          ],
        });
        const page = await browser.newPage();
        await page.setUserAgent(BROWSER_HEADERS["User-Agent"]);
        await page.setViewport({ width: 1440, height: 900 });

        // timeout: 0 meant this could hang forever on a slow page.
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: PUPPETEER_TIMEOUT_MS,
        });
        // Give lazy-loaded product images a moment to attach.
        await new Promise((r) => setTimeout(r, 3000));

        const puppeteerImages = await page.evaluate(() => {
          const urls = new Set();

          document.querySelectorAll("img").forEach((img) => {
            if (
              img.src &&
              img.naturalWidth > 100 &&
              img.naturalHeight > 100 &&
              !img.src.includes("logo") &&
              !img.src.includes("sprite") &&
              !img.src.includes("icon")
            ) {
              urls.add(img.src);
            }
          });

          // Same srcset trap as the cheerio path - take the largest candidate,
          // never the raw attribute.
          const pickBest = (srcset) => {
            const best = srcset
              .split(",")
              .map((part) => {
                const [u, d = ""] = part.trim().split(/\s+/);
                return u ? { u, size: parseFloat(d) || 0 } : null;
              })
              .filter(Boolean)
              .reduce((a, b) => (b.size > a.size ? b : a), { u: null, size: -1 });
            return best.u;
          };

          document
            .querySelectorAll("picture source[srcset], img[srcset]")
            .forEach((el) => {
              const best = pickBest(el.srcset);
              if (best) urls.add(best);
            });

          return Array.from(urls);
        });

        images = puppeteerImages;
        console.log(`[scrape] puppeteer found ${images.length} images`);
      } catch (puppeteerErr) {
        console.error(`[scrape] puppeteer failed: ${puppeteerErr.message}`);
      } finally {
        // Without this a thrown goto leaks a Chrome process on every failure.
        if (browser) await browser.close().catch(() => {});
      }
    }

    images = dedupeByIdentity(images);
    console.log(`[scrape] returning ${Math.min(images.length, 10)} images`);

    if (images.length === 0) {
      return res.status(404).json({
        error:
          "No product images found on that page. Try a different product link.",
      });
    }

    res.json({ images: images.slice(0, 10) });
  } catch (error) {
    console.error("[scrape] error:", error.message);
    res.status(500).json({ error: "Failed to scrape product images." });
  }
});

module.exports = scrapRoutes;
