// Generates api/migrations/0002_seed.sql from the catalog in src/littleroots-tv.html
import fs from "fs"; import vm from "vm";
const html = fs.readFileSync(process.argv[2], "utf8");
const start = html.indexOf("const WORLDS = ["), end = html.indexOf("const NAV = [");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(html.slice(start, end).replace(/^const /gm, "var ").replace(/\(\) => continueList\(\)/, "() => []"), ctx);
const { WORLDS, WORLD_NAMES, CATALOG, ROWS, HERO } = ctx;
const q = v => v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const rowFor = id => ROWS.find(r => r.id === id) || {};
const order = ["shorts", "bible", "stories", "dance", "worship", "loved"];
let sql = "-- The LittleRoots catalog: 30 videos from the YouTube channel (interim source until each is uploaded to our own storage)\n\n";
order.forEach((id, i) => {
  const w = WORLDS.find(x => x.id === id), r = rowFor(id);
  const cover = w && CATALOG.find(v => v.yt === w.cover);
  sql += `INSERT INTO categories (id, name, note, sort, is_world, cover_video) VALUES (${q(id)}, ${q(r.name || WORLD_NAMES[id])}, ${q(r.note || null)}, ${i + 1}, ${w ? 1 : 0}, ${q(cover ? cover.slug : null)});\n`;
});
sql += "\n";
const perCat = {};
for (const v of CATALOG) {
  const n = (perCat[v.world] = (perCat[v.world] || 0) + 1);
  sql += `INSERT INTO videos (id, title, description, category_id, bible_ref, kind, age, talk, is_short, for_parents, bedtime, free, featured, status, source_type, source_id, thumbnail_url, sort) VALUES (${[
    q(v.slug), q(v.title), q(v.desc), q(v.world), q(v.ref || null), q(v.kind), q(v.age), q(JSON.stringify(v.talk || [])),
    v.short ? 1 : 0, v.parents ? 1 : 0, v.bedtime ? 1 : 0, 1, v.slug === HERO ? 1 : 0, q("published"), q("youtube"), q(v.yt),
    q(`https://i.ytimg.com/vi/${v.yt}/hqdefault.jpg`), n,
  ].join(", ")});\n`;
}
fs.writeFileSync(process.argv[3], sql);
console.log(`categories: ${order.length}, videos: ${CATALOG.length}, featured: ${HERO}`);
