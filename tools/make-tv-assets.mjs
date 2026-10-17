// Makes the TV app icons, splash screen and store images from brand/littleroots-logo.svg.
// Usage: node tools/make-tv-assets.mjs   (needs Playwright's Chromium)
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/npm-tools/node_modules/playwright")); }

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const svg = fs.readFileSync(path.join(ROOT, "brand/littleroots-logo.svg"), "utf8")
  .replace(/<\?xml[^>]*>|<!--[\s\S]*?-->/g, "")
  .replace(/viewBox="[^"]*"/, 'viewBox="132 292 310 222"')
  .replace(/\swidth="[^"]*"|\sheight="[^"]*"|\sstyle="[^"]*"/g, "")
  .replace(/\.st0\{fill:#0D322C;\}/, ".st0{fill:#F3EBD8;}");

// [file, width, height, logo width as share of canvas, tagline?, jpg?]
const OUT = [
  ["tv/webos/icon.png", 80, 80, 0.86],
  ["tv/webos/largeIcon.png", 130, 130, 0.84],
  ["tv/webos/splash.png", 1920, 1080, 0.36, true],
  ["tv/store/lg-icon-400.png", 400, 400, 0.8],
  ["tv/store/vidaa-icon-480x480.jpg", 480, 480, 0.8, false, true],
  ["tv/store/vidaa-icon-480x270.png", 480, 270, 0.6],
  ["tv/store/banner-1920x1080.jpg", 1920, 1080, 0.36, true, true],
  ["tv/store/banner-1280x720.png", 1280, 720, 0.36, true],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, w, h, share, tagline, jpg] of OUT) {
  await page.setViewportSize({ width: w, height: h });
  const small = w <= 130;
  await page.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800&display=swap" rel="stylesheet">
<style>
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;
 background:radial-gradient(ellipse at 50% 38%, #1d5248 0%, #0D322C 62%, #08231f 100%);font-family:Nunito,sans-serif}
${small ? "body{border-radius:0}" : ""}
svg{width:${Math.round(w * share)}px;height:auto;display:block}
p{margin:${Math.round(h * 0.035)}px 0 0;color:#E7C27F;font-weight:800;letter-spacing:.06em;font-size:${Math.round(h * 0.034)}px}
p b{color:#F3EBD8;font-weight:800}
</style></head><body>${svg}${tagline ? "<p>Small seeds. Deep roots. <b>Stories for every generation.</b></p>" : ""}</body></html>`);
  await page.waitForTimeout(tagline ? 1200 : 150);
  fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
  await page.screenshot({ path: path.join(ROOT, file), type: jpg ? "jpeg" : "png", quality: jpg ? 92 : undefined });
  console.log("made", file, `${w}x${h}`);
}
await browser.close();
