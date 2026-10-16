// LittleRoots TV-safe build
// Source: littleroots-tv.html (modern code, as published in the Claude preview)
// Output: index.html — a complete page that also runs on older smart-TV browsers
//         (LG webOS 5+ / Chromium 68+, Hisense VIDAA with similar engines).
// Usage:  node build-tv.mjs <source.html> <out.html> <path-to-node_modules>
import fs from "fs";
import { createRequire } from "module";
const [, , SRC, OUT, NM] = process.argv;
const require = createRequire(NM + "/");
const babel = require("@babel/core");

let html = fs.readFileSync(SRC, "utf8");

/* ---------- CSS ---------- */
const styleRe = /<style>([\s\S]*?)<\/style>/;
let css = html.match(styleRe)[1];

// 1. inset shorthand -> top/right/bottom/left
css = css.replace(/(^|[;{\s])inset:\s*([^;}]+)/g, (m, pre, val) => {
  const v = val.trim().split(/\s+/);
  const [t, r = t, b = t, l = r] = v;
  return `${pre}top: ${t}; right: ${r}; bottom: ${b}; left: ${l}`;
});

// 2. clamp()/min()/max(): add a plain fallback declaration before each one
function findFn(str, from) {
  const re = /(^|[^a-z-])(clamp|min|max)\(/gi; re.lastIndex = from;
  const m = re.exec(str); if (!m) return null;
  const start = m.index + m[1].length, open = start + m[2].length;
  let depth = 0, i = open;
  for (; i < str.length; i++) { if (str[i] === "(") depth++; else if (str[i] === ")" && --depth === 0) break; }
  return { start, end: i + 1, name: m[2].toLowerCase(), inner: str.slice(open + 1, i) };
}
function splitArgs(s) { const out = []; let d = 0, cur = ""; for (const ch of s) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } out.push(cur.trim()); return out; }
function simplify(val) {
  let f;
  while ((f = findFn(val, 0))) {
    let args = splitArgs(f.inner).map(simplify);
    let pick;
    if (f.name === "clamp") pick = args[1];
    else {
      const real = args.filter(a => !/^env\(/.test(a));
      pick = real.find(a => /%|vw|vh/.test(a)) || real[0] || args[0];
    }
    if (/\s[-+*/]\s/.test(pick) && !/^calc\(/.test(pick)) pick = `calc(${pick})`;
    val = val.slice(0, f.start) + pick + val.slice(f.end);
  }
  return val;
}
css = css.replace(/(?<=[{;]\s*)(-{0,2}[a-z][a-z-]*)\s*:\s*([^;{}]*?\b(?:clamp|min|max)\([^;{}]*?)(?=;|\s*\})/gi, (m, prop, val) => {
  if (!findFn(val, 0)) return m;
  const fb = simplify(val);
  if (prop.startsWith("--")) return `${prop}: ${fb}`; // custom properties can't fall back
  return `${prop}: ${fb}; ${prop}: ${val}`;
});

// 3. split selector lists that contain :focus-visible (old browsers drop the whole rule)
css = css.replace(/(^|\})(\s*)([^{}@]*:focus-visible[^{}]*)\{([^{}]*)\}/g, (m, close, ws, sel, body) => {
  const parts = sel.split(",").map(s => s.trim());
  const modern = parts.filter(s => s.includes(":focus-visible")), safe = parts.filter(s => !s.includes(":focus-visible"));
  return `${close}${ws}${safe.length ? `${safe.join(", ")} {${body}}\n` : ""}${modern.join(", ")} {${body}}`;
});

// 4. fallbacks for aspect-ratio and flexbox gap
css += `
/* ---- TV-safe fallbacks (added by build) ---- */
html, body { margin: 0; }
@supports not (aspect-ratio: 1 / 1) {
  .thumb { height: 0; padding-top: 56.25%; }
  .card.short .thumb { padding-top: 177.78%; }
  .world { height: 0; padding-top: 62.5%; }
  .sheet-art { height: 0; padding-top: 38.1%; }
  .verse .thumb { display: block; padding: 56.25% 0 0; }
  .verse q { position: absolute; top: 50%; left: 1rem; right: 1rem; transform: translateY(-50%); }
  .p-end .next img { height: auto; }
}
.no-flexgap .top > * + * { margin-left: 1.5rem; }
.no-flexgap .nav > * + * { margin-left: .35rem; }
.no-flexgap .nav .parents { margin-left: auto; }
.no-flexgap .track > * + * { margin-left: 1rem; }
.no-flexgap .actions > *, .no-flexgap .chips > *, .no-flexgap .choices > * { margin: 0 .7rem .6rem 0; }
.no-flexgap .meta > * { margin: 0 .9rem .3rem 0; }
.no-flexgap .row-head > * + * { margin-left: .8rem; }
.no-flexgap .p-row > * + * { margin-left: .8rem; }
.no-flexgap .p-top > * + * { margin-left: 1rem; }
.no-flexgap .btn > svg { margin-right: .5rem; }
`;
html = html.replace(styleRe, () => `<style>${css}</style>`);

/* ---------- JS: transpile the app script for older browsers ---------- */
html = html.replace(/<script>([\s\S]*?)<\/script>/g, (m, code) => {
  const out = babel.transformSync(code, { presets: [[require.resolve("@babel/preset-env"), { targets: "chrome 53" }]], sourceType: "script", compact: false, comments: true });
  return `<script>${out.code}</script>`;
});

/* ---------- full page skeleton ---------- */
const title = (html.match(/<title>([^<]*)<\/title>/) || [, "LittleRoots"])[1];
html = html.replace(/<title>[^<]*<\/title>\s*/, "").replace(/<meta name="claude:viewport-fit-sides"[^>]*>\s*/, "");
const flexGapTest = `<script>(function(){var d=document.createElement("div");d.style.display="flex";d.style.flexDirection="column";d.style.rowGap="1px";d.appendChild(document.createElement("div"));d.appendChild(document.createElement("div"));document.documentElement.appendChild(d);var ok=d.scrollHeight===1;d.parentNode.removeChild(d);if(!ok)document.documentElement.className+=" no-flexgap";})();</script>`;
const headBits = [];
html = html.replace(/<link[^>]*>\s*/g, m => { headBits.push(m.trim()); return ""; });
const styleBlock = html.match(styleRe)[0]; html = html.replace(styleRe, "");
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0D322C">
<title>${title}</title>
${headBits.join("\n")}
${flexGapTest}
${styleBlock}
</head>
<body>
${html.trim()}
</body>
</html>
`;
fs.writeFileSync(OUT, page);
console.log("built", OUT, (page.length / 1024).toFixed(0) + " KB");
