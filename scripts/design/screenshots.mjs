// Captures the main screens at phone and desktop widths so a design change
// can be compared before/after. Usage:
//   node scripts/design/screenshots.mjs <label> [baseUrl]
// Writes docs/design/screenshots/<label>/<page>-<width>.jpg
import { mkdir } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const label = process.argv[2] ?? "current";
const base = process.argv[3] ?? "http://localhost:4321";
const pages = {
  home: "/",
  posts: "/posts",
  "article-travelogue": "/posts/spain1",
  "article-practical": "/posts/airport-access-athens",
  destination: "/destination",
  "destination-country": "/destination/greece",
  gallery: "/gallery",
  collections: "/collections",
  "collection-journey": "/collections/paris-2025-02",
  about: "/about",
  contact: "/contact",
  faq: "/faq",
};
const widths = (process.env.WIDTHS ?? "375,1440").split(",").map(Number);
const out = path.resolve("docs/design/screenshots", label);
await mkdir(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  const page = await browser.newPage();
  for (const width of widths) {
    await page.setViewport({
      width,
      height: width < 768 ? 812 : 900,
      isMobile: width < 768,
      hasTouch: width < 768,
    });
    for (const [name, url] of Object.entries(pages)) {
      await page.goto(base + url, { waitUntil: "networkidle2", timeout: 60_000 });
      // Lazy images only load once scrolled past.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      // Sections below the fold use content-visibility: auto, which a
      // full-page capture would otherwise leave blank.
      await page.addStyleTag({ content: "*{content-visibility:visible!important}" });
      await new Promise((r) => setTimeout(r, 400));
      await page.screenshot({
        path: path.join(out, `${name}-${width}.jpg`),
        type: "jpeg",
        quality: 62,
        fullPage: true,
      });
      console.log(`${name}-${width}`);
    }
  }
} finally {
  await browser.close();
}
