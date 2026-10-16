import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Env, type Vars, err, loadUser, requireAdmin, createSession, hashPassword, verifyPassword, mock } from "./lib";
import { admin, converterCallback } from "./admin";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// TVs and phones load the app from other addresses, so the API accepts any origin (admin sign-in uses tokens, not cookies).
app.use("/api/*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], maxAge: 86400 }));
app.use("/api/*", loadUser);

app.get("/api/health", c => c.json({ ok: true }));

/* ================= Catalog: everything the TV and phone apps show ================= */
const bool = (v: unknown) => v === 1 || v === true;
export function streamUrl(env: Env, v: any) {
  if (v.source_type === "hls" && v.processing === "ready") return `${env.MEDIA_PUBLIC_URL}/${v.media_path}/master.m3u8`;
  return null;
}
export function publicVideo(env: Env, v: any) {
  return {
    id: v.id, title: v.title, description: v.description, category: v.category_id, ref: v.bible_ref, kind: v.kind, age: v.age,
    talk: JSON.parse(v.talk || "[]"), short: bool(v.is_short), parents: bool(v.for_parents), bedtime: bool(v.bedtime),
    featured: bool(v.featured), thumbnail: v.thumbnail_url, duration: v.duration_s,
    source: v.source_type === "youtube" ? { type: "youtube", id: v.source_id } : { type: "hls", url: streamUrl(env, v) },
  };
}
app.get("/api/catalog", async c => {
  const [cats, vids] = await Promise.all([
    c.env.DB.prepare("SELECT id, name, note, sort, is_world, cover_video FROM categories ORDER BY sort, name").all(),
    c.env.DB.prepare("SELECT * FROM videos WHERE status = 'published' AND (source_type = 'youtube' OR processing = 'ready') ORDER BY sort, title").all(),
  ]);
  c.header("Cache-Control", "public, max-age=60");
  return c.json({
    categories: cats.results.map((k: any) => ({ id: k.id, name: k.name, note: k.note, world: bool(k.is_world), cover: k.cover_video })),
    videos: vids.results.map(v => publicVideo(c.env, v)),
  });
});

/* ================= Admin sign-in (only emails in ADMIN_EMAILS can create an account) ================= */
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
app.post("/api/auth/register", async c => {
  const { email = "", password = "", name = "" } = await c.req.json<any>().catch(() => ({}));
  const em = String(email).trim().toLowerCase();
  if (!emailOk(em)) return err(c, 400, "bad_email", "Enter a valid email address.");
  const admins = c.env.ADMIN_EMAILS.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.includes(em)) return err(c, 403, "not_allowed", "This email isn't on the LittleRoots admin list.");
  if (String(password).length < 8) return err(c, 400, "weak_password", "Use a password of at least 8 characters.");
  if (await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(em).first())
    return err(c, 409, "email_taken", "This admin account already exists. Sign in instead.");
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO users (id, email, name, password_hash) VALUES (?,?,?,?)")
    .bind(id, em, String(name).trim() || null, await hashPassword(String(password))).run();
  return c.json({ token: await createSession(c.env, id) }, 201);
});
app.post("/api/auth/login", async c => {
  const { email = "", password = "" } = await c.req.json<any>().catch(() => ({}));
  const u = await c.env.DB.prepare("SELECT id, password_hash FROM users WHERE email = ?").bind(String(email).trim().toLowerCase()).first<any>();
  if (!u || !(await verifyPassword(String(password), u.password_hash)))
    return err(c, 401, "wrong_login", "That email and password don't match. Try again.");
  return c.json({ token: await createSession(c.env, u.id) });
});
app.post("/api/auth/logout", requireAdmin, async c => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(c.get("tokenHash")).run();
  return c.json({ ok: true });
});
app.get("/api/me", requireAdmin, c => c.json({ user: c.get("user") }));

/* ================= Admin + the video converter's report-back ================= */
app.route("/api/admin", admin);
app.post("/api/converter/callback", converterCallback);
// Local testing only: stands in for the direct-to-storage upload link (like a real one, it needs no sign-in)
app.put("/api/mock-upload/*", async c => {
  if (!mock(c.env)) return c.notFound();
  const key = decodeURIComponent(c.req.path.split("/mock-upload/")[1]);
  if (!key.startsWith("inbox/") || key.includes("..")) return c.notFound();
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType: c.req.header("content-type") || "video/mp4" } });
  return c.body(null, 200);
});

/* ================= Media from storage (thumbnails; streaming files when no public bucket address is set) ================= */
const TYPES: Record<string, string> = { m3u8: "application/vnd.apple.mpegurl", ts: "video/mp2t", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4" };
app.get("/media/*", async c => {
  const key = decodeURIComponent(c.req.path.slice("/media/".length));
  if (!key || key.startsWith("inbox/") || key.includes("..")) return c.notFound();
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.notFound();
  const ext = key.split(".").pop()!.toLowerCase();
  return new Response(obj.body, { headers: { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*" } });
});

app.get("/admin", c => c.redirect("/admin/"));
app.notFound(c => c.req.path.startsWith("/api/") ? err(c, 404, "not_found", "Not found.") : c.env.ASSETS.fetch(c.req.raw));
app.onError((e, c) => { console.error(e); return err(c, 500, "server_error", "Something went wrong. Please try again."); });

export default app;
