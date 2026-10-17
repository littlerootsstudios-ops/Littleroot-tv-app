import { Hono } from "hono";
import { AwsClient } from "aws4fetch";
import { type Env, type Vars, type C, err, requireAdmin, randomToken, slugify, safeEqual, mock, publicUrl } from "./lib";

export const admin = new Hono<{ Bindings: Env; Variables: Vars }>();
admin.use("*", requireAdmin);

const now = () => new Date().toISOString();

/* ---------- helpers ---------- */
function adminVideo(env: Env, v: any) {
  return {
    id: v.id, title: v.title, description: v.description, category: v.category_id, ref: v.bible_ref, kind: v.kind, age: v.age,
    talk: JSON.parse(v.talk || "[]"), short: !!v.is_short, parents: !!v.for_parents, bedtime: !!v.bedtime, featured: !!v.featured,
    status: v.status, sort: v.sort, thumbnail: v.thumbnail_url, duration: v.duration_s,
    source: v.source_type, youtubeId: v.source_type === "youtube" ? v.source_id : null,
    processing: v.processing, processingError: v.processing_error,
    streamUrl: v.source_type === "hls" && v.processing === "ready" ? `${env.MEDIA_PUBLIC_URL}/${v.media_path}/master.m3u8` : null,
    updatedAt: v.updated_at,
  };
}
async function getVideo(env: Env, id: string) {
  return env.DB.prepare("SELECT * FROM videos WHERE id = ?").bind(id).first<any>();
}
async function deletePrefix(env: Env, prefix: string) {
  if (!prefix) return;
  let cursor: string | undefined;
  do {
    const list = await env.MEDIA.list({ prefix: prefix.endsWith("/") ? prefix : prefix + "/", cursor });
    if (list.objects.length) await env.MEDIA.delete(list.objects.map(o => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/* ---------- overview ---------- */
admin.get("/stats", async c => {
  const v = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(status='published') AS published, SUM(source_type='youtube') AS youtube, SUM(source_type='hls' AND processing='ready') AS hosted, SUM(processing IN ('uploading','converting')) AS working FROM videos"
  ).first<any>();
  let bytes = 0, cursor: string | undefined;
  do { const l = await c.env.MEDIA.list({ cursor }); for (const o of l.objects) bytes += o.size; cursor = l.truncated ? l.cursor : undefined; } while (cursor);
  return c.json({ videos: v, storage: { usedBytes: bytes, freeTierBytes: 10 * 1024 ** 3 } });
});

/* ---------- categories ---------- */
admin.get("/categories", async c => {
  const r = await c.env.DB.prepare("SELECT c.*, (SELECT COUNT(*) FROM videos v WHERE v.category_id = c.id) AS count FROM categories c ORDER BY sort, name").all();
  return c.json({ categories: r.results.map((k: any) => ({ id: k.id, name: k.name, note: k.note, sort: k.sort, world: !!k.is_world, cover: k.cover_video, count: k.count })) });
});
admin.post("/categories", async c => {
  const b = await c.req.json<any>().catch(() => ({}));
  const name = String(b.name || "").trim();
  if (!name) return err(c, 400, "name_required", "Give the category a name.");
  const id = slugify(b.id || name);
  if (await c.env.DB.prepare("SELECT 1 FROM categories WHERE id = ?").bind(id).first()) return err(c, 409, "exists", "A category with this name already exists.");
  const max = await c.env.DB.prepare("SELECT COALESCE(MAX(sort),0)+1 AS n FROM categories").first<any>();
  await c.env.DB.prepare("INSERT INTO categories (id, name, note, sort, is_world, cover_video) VALUES (?,?,?,?,?,?)")
    .bind(id, name, b.note || null, b.sort ?? max.n, b.world ? 1 : 0, b.cover || null).run();
  return c.json({ id }, 201);
});
admin.put("/categories/:id", async c => {
  const b = await c.req.json<any>().catch(() => ({}));
  const k = await c.env.DB.prepare("SELECT * FROM categories WHERE id = ?").bind(c.req.param("id")).first<any>();
  if (!k) return err(c, 404, "not_found", "Category not found.");
  await c.env.DB.prepare("UPDATE categories SET name = ?, note = ?, sort = ?, is_world = ?, cover_video = ? WHERE id = ?")
    .bind(b.name ?? k.name, b.note !== undefined ? b.note || null : k.note, b.sort ?? k.sort, b.world !== undefined ? (b.world ? 1 : 0) : k.is_world, b.cover !== undefined ? b.cover || null : k.cover_video, k.id).run();
  return c.json({ ok: true });
});
admin.delete("/categories/:id", async c => {
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM videos WHERE category_id = ?").bind(c.req.param("id")).first<any>();
  if (n.n) return err(c, 409, "not_empty", `Move its ${n.n} video${n.n > 1 ? "s" : ""} to another category first.`);
  await c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

/* ---------- videos ---------- */
admin.get("/videos", async c => {
  const r = await c.env.DB.prepare("SELECT * FROM videos ORDER BY category_id, sort, title").all();
  return c.json({ videos: r.results.map(v => adminVideo(c.env, v)) });
});
admin.get("/videos/:id", async c => {
  const v = await getVideo(c.env, c.req.param("id"));
  if (!v) return err(c, 404, "not_found", "Video not found.");
  if (mock(c.env) && v.processing === "converting" && v.processing_started && Date.now() - Date.parse(v.processing_started) > 2500) {
    await finishConversion(c.env, v.id, { status: "ready", outputPrefix: v.pending_media_path, durationS: 245 }); // simulated converter
    return c.json(adminVideo(c.env, await getVideo(c.env, v.id)));
  }
  return c.json(adminVideo(c.env, v));
});

function readFields(b: any) {
  const talk = Array.isArray(b.talk) ? b.talk.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 5) : undefined;
  return {
    title: b.title !== undefined ? String(b.title).trim() : undefined,
    description: b.description, category_id: b.category, bible_ref: b.ref, kind: b.kind, age: b.age,
    talk: talk ? JSON.stringify(talk) : undefined,
    is_short: b.short === undefined ? undefined : b.short ? 1 : 0,
    for_parents: b.parents === undefined ? undefined : b.parents ? 1 : 0,
    bedtime: b.bedtime === undefined ? undefined : b.bedtime ? 1 : 0,
    featured: b.featured === undefined ? undefined : b.featured ? 1 : 0,
    status: b.status === undefined ? undefined : b.status === "published" ? "published" : "draft",
    sort: b.sort === undefined ? undefined : Number(b.sort) || 0,
  } as Record<string, any>;
}
async function validate(c: C, f: Record<string, any>, existing?: any) {
  if (f.title !== undefined && !f.title) return "Give the video a title.";
  if (f.category_id !== undefined && f.category_id && !(await c.env.DB.prepare("SELECT 1 FROM categories WHERE id = ?").bind(f.category_id).first())) return "Pick a category from the list.";
  if (f.status === "published") {
    const v = { ...existing, ...Object.fromEntries(Object.entries(f).filter(([, x]) => x !== undefined)) };
    if (!v.category_id) return "Pick a category before publishing.";
    if (!(v.source_type === "youtube" || (v.source_type === "hls" && v.processing === "ready"))) return "Upload the video (or add a YouTube ID) before publishing.";
  }
  return null;
}
admin.post("/videos", async c => {
  const b = await c.req.json<any>().catch(() => ({}));
  const f = readFields(b); f.status = "draft";
  if (!f.title) return err(c, 400, "title_required", "Give the video a title.");
  const problem = await validate(c, f); if (problem) return err(c, 400, "invalid", problem);
  let id = slugify(f.title) || "video", n = 2;
  while (await c.env.DB.prepare("SELECT 1 FROM videos WHERE id = ?").bind(id).first()) id = `${slugify(f.title)}-${n++}`;
  let source_type = null, source_id = null;
  if (b.youtubeId) { if (!YT_ID.test(b.youtubeId)) return err(c, 400, "bad_youtube", "That doesn't look like a YouTube video ID (11 characters)."); source_type = "youtube"; source_id = b.youtubeId; }
  await c.env.DB.prepare(`INSERT INTO videos (id, title, description, category_id, bible_ref, kind, age, talk, is_short, for_parents, bedtime, featured, status, sort, source_type, source_id, thumbnail_url)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, f.title, f.description || null, f.category_id || null, f.bible_ref || null, f.kind || null, f.age || null, f.talk || "[]",
      f.is_short || 0, f.for_parents || 0, f.bedtime || 0, 0, "draft", f.sort || 0, source_type, source_id, source_type === "youtube" ? `https://i.ytimg.com/vi/${source_id}/hqdefault.jpg` : null).run();
  return c.json(adminVideo(c.env, await getVideo(c.env, id)), 201);
});
admin.put("/videos/:id", async c => {
  const v = await getVideo(c.env, c.req.param("id"));
  if (!v) return err(c, 404, "not_found", "Video not found.");
  const b = await c.req.json<any>().catch(() => ({}));
  const f = readFields(b);
  if (b.youtubeId !== undefined && v.source_type !== "hls") {
    if (b.youtubeId && !YT_ID.test(b.youtubeId)) return err(c, 400, "bad_youtube", "That doesn't look like a YouTube video ID (11 characters).");
    f.source_type = b.youtubeId ? "youtube" : null; f.source_id = b.youtubeId || null;
    if (b.youtubeId && (!v.thumbnail_url || v.thumbnail_url.includes("i.ytimg.com"))) f.thumbnail_url = `https://i.ytimg.com/vi/${b.youtubeId}/hqdefault.jpg`;
  }
  const problem = await validate(c, f, v); if (problem) return err(c, 400, "invalid", problem);
  const sets = Object.entries(f).filter(([, x]) => x !== undefined);
  if (f.featured === 1) await c.env.DB.prepare("UPDATE videos SET featured = 0 WHERE featured = 1").run(); // one featured story at a time
  if (sets.length) await c.env.DB.prepare(`UPDATE videos SET ${sets.map(([k]) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...sets.map(([, x]) => (x === "" ? null : x)), v.id).run();
  return c.json(adminVideo(c.env, await getVideo(c.env, v.id)));
});
admin.delete("/videos/:id", async c => {
  const v = await getVideo(c.env, c.req.param("id"));
  if (!v) return err(c, 404, "not_found", "Video not found.");
  await deletePrefix(c.env, v.media_path); await deletePrefix(c.env, v.pending_media_path);
  if (v.upload_key) await c.env.MEDIA.delete(v.upload_key);
  if (v.thumbnail_url?.includes("/thumbs/")) await c.env.MEDIA.delete("thumbs/" + v.thumbnail_url.split("/thumbs/").pop());
  await c.env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(v.id).run();
  return c.json({ ok: true });
});

/* ---------- step 1: upload the original file straight to storage (no size limit through the server) ---------- */
admin.post("/videos/:id/upload", async c => {
  const v = await getVideo(c.env, c.req.param("id"));
  if (!v) return err(c, 404, "not_found", "Video not found.");
  if (v.processing === "converting") return err(c, 409, "busy", "This video is still converting. Wait for it to finish.");
  const { filename = "video.mp4", size = 0 } = await c.req.json<any>().catch(() => ({}));
  if (size > 5 * 1024 ** 3) return err(c, 400, "too_big", "Videos must be under 5 GB.");
  const ext = (String(filename).split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  const key = `inbox/${v.id}/${randomToken(8)}.${ext}`;
  if (v.upload_key) await c.env.MEDIA.delete(v.upload_key);
  await c.env.DB.prepare("UPDATE videos SET upload_key = ?, processing = 'uploading', processing_error = NULL, updated_at = datetime('now') WHERE id = ?").bind(key, v.id).run();
  if (mock(c.env)) return c.json({ uploadUrl: `${publicUrl(c)}/api/mock-upload/${encodeURIComponent(key)}`, method: "PUT", key, mock: true });
  if (!c.env.R2_ACCESS_KEY_ID || !c.env.R2_SECRET_ACCESS_KEY || !c.env.R2_ACCOUNT_ID) return err(c, 500, "storage_not_set_up", "Storage keys aren't set up yet (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).");
  const aws = new AwsClient({ accessKeyId: c.env.R2_ACCESS_KEY_ID, secretAccessKey: c.env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
  const url = new URL(`https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${c.env.R2_BUCKET}/${key}`);
  url.searchParams.set("X-Amz-Expires", "21600"); // 6 hours, for slow connections
  const signed = await aws.sign(new Request(url, { method: "PUT" }), { aws: { signQuery: true } });
  return c.json({ uploadUrl: signed.url, method: "PUT", key });
});
/* ---------- step 2: start the free converter (GitHub Actions) ---------- */
admin.post("/videos/:id/convert", async c => {
  const v = await getVideo(c.env, c.req.param("id"));
  if (!v) return err(c, 404, "not_found", "Video not found.");
  if (!v.upload_key || !(await c.env.MEDIA.head(v.upload_key))) return err(c, 400, "no_upload", "The upload didn't finish. Try uploading again.");
  const prefix = `hls/${v.id}-${randomToken(9).replace(/[-_]/g, "x")}`; // secret, unguessable folder
  if (!mock(c.env)) {
    if (!c.env.GITHUB_TOKEN || !c.env.CONVERTER_SECRET) return err(c, 500, "converter_not_set_up", "The converter isn't set up yet (GITHUB_TOKEN, CONVERTER_SECRET).");
    const r = await fetch(`https://api.github.com/repos/${c.env.CONVERTER_REPO}/actions/workflows/convert.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "littleroots-api", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { video_id: v.id, input_key: v.upload_key, output_prefix: prefix, callback_url: `${publicUrl(c)}/api/converter/callback` } }),
    });
    if (r.status !== 204) { console.error("GitHub dispatch failed", r.status, await r.text()); return err(c, 502, "converter_unavailable", "Couldn't start the converter. Try again in a minute."); }
  } else {
    // simulated converter: writes a stand-in playlist so the rest of the flow can be tested
    await c.env.MEDIA.put(`${prefix}/master.m3u8`, "#EXTM3U\n#EXT-X-VERSION:6\n", { httpMetadata: { contentType: "application/vnd.apple.mpegurl" } });
  }
  await c.env.DB.prepare("UPDATE videos SET processing = 'converting', pending_media_path = ?, processing_started = ?, processing_error = NULL, updated_at = datetime('now') WHERE id = ?")
    .bind(prefix, now(), v.id).run();
  return c.json({ ok: true, processing: "converting" });
});

/* ---------- step 3: the converter reports back ---------- */
async function finishConversion(env: Env, videoId: string, b: { status: string; outputPrefix: string; durationS?: number; error?: string }) {
  const v = await getVideo(env, videoId);
  if (!v || v.pending_media_path !== b.outputPrefix) return false;
  if (b.status !== "ready") {
    await env.DB.prepare("UPDATE videos SET processing = 'failed', processing_error = ?, pending_media_path = NULL, updated_at = datetime('now') WHERE id = ?")
      .bind(String(b.error || "The converter couldn't read this file. Try exporting it as MP4 and upload again.").slice(0, 300), v.id).run();
    await deletePrefix(env, b.outputPrefix);
    return true;
  }
  const oldPath = v.media_path;
  const autoThumb = !v.thumbnail_url || v.thumbnail_url.includes("i.ytimg.com") || v.thumbnail_url.includes("/hls/");
  await env.DB.prepare(`UPDATE videos SET source_type = 'hls', source_id = NULL, media_path = ?, pending_media_path = NULL, processing = 'ready', processing_error = NULL,
      duration_s = ?, thumbnail_url = ?, upload_key = NULL, updated_at = datetime('now') WHERE id = ?`)
    .bind(b.outputPrefix, b.durationS ? Math.round(b.durationS) : v.duration_s, autoThumb ? `${env.MEDIA_PUBLIC_URL}/${b.outputPrefix}/thumbnail.jpg` : v.thumbnail_url, v.id).run();
  if (v.upload_key) await env.MEDIA.delete(v.upload_key);        // original no longer needed (keep your master copy in Google Drive)
  if (oldPath && oldPath !== b.outputPrefix) await deletePrefix(env, oldPath); // replaced an older version
  return true;
}
export async function converterCallback(c: C) {
  const secret = c.req.header("x-converter-secret") || "";
  if (!c.env.CONVERTER_SECRET || !safeEqual(secret, c.env.CONVERTER_SECRET)) return err(c, 403, "forbidden", "Wrong converter secret.");
  const b = await c.req.json<any>().catch(() => ({}));
  const ok = await finishConversion(c.env, String(b.videoId), { status: String(b.status), outputPrefix: String(b.outputPrefix), durationS: Number(b.durationS) || undefined, error: b.error });
  return ok ? c.json({ ok: true }) : err(c, 409, "stale", "This conversion is no longer expected.");
}

/* ---------- custom thumbnail ---------- */
admin.post("/videos/:id/thumbnail", async c => {
  const v = await getVideo(c.env, c.req.param("id"));
  if (!v) return err(c, 404, "not_found", "Video not found.");
  const type = c.req.header("content-type") || "";
  const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[type];
  if (!ext) return err(c, 400, "bad_image", "Use a JPG, PNG or WebP image.");
  const body = await c.req.arrayBuffer();
  if (body.byteLength > 5 * 1024 * 1024) return err(c, 400, "too_big", "Images must be under 5 MB.");
  const key = `thumbs/${v.id}-${randomToken(6)}.${ext}`;
  await c.env.MEDIA.put(key, body, { httpMetadata: { contentType: type } });
  if (v.thumbnail_url?.includes("/thumbs/")) await c.env.MEDIA.delete("thumbs/" + v.thumbnail_url.split("/thumbs/").pop());
  await c.env.DB.prepare("UPDATE videos SET thumbnail_url = ?, updated_at = datetime('now') WHERE id = ?").bind(`${c.env.MEDIA_PUBLIC_URL}/${key}`, v.id).run();
  return c.json(adminVideo(c.env, await getVideo(c.env, v.id)));
});
