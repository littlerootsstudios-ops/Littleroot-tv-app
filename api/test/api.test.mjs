// End-to-end test of the LittleRoots backend. Run `npx wrangler dev` first, then `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
const B = process.env.API || "http://127.0.0.1:8787";
const call = async (path, { token, ...o } = {}) => {
  const r = await fetch(B + path, { ...o, headers: { ...(o.body && typeof o.body === "string" ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}), ...(o.headers || {}) } });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
};
const ADMIN = { email: "olusholaoluyomi@gmail.com", password: "test-password-123", name: "Olushola" };
let token;

test("catalog is public and has the 30 seeded videos", async () => {
  const r = await call("/api/catalog");
  assert.equal(r.status, 200);
  assert.equal(r.body.videos.length, 30);
  assert.equal(r.body.categories[0].id, "shorts");
  assert.equal(r.body.videos.find(v => v.featured).id, "ade-and-the-jollof-mould");
  assert.deepEqual(r.body.videos.find(v => v.id === "noahs-ark").source, { type: "youtube", id: "RVgRb-fnj4Q" });
});

test("only approved emails can create an admin account", async () => {
  const r = await call("/api/auth/register", { method: "POST", body: JSON.stringify({ email: "stranger@example.com", password: "whatever-123" }) });
  assert.equal(r.status, 403);
});

test("admin can register (or sign in) and wrong password is rejected", async () => {
  let r = await call("/api/auth/register", { method: "POST", body: JSON.stringify(ADMIN) });
  if (r.status === 409) r = await call("/api/auth/login", { method: "POST", body: JSON.stringify(ADMIN) });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  token = r.body.token;
  const bad = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ ...ADMIN, password: "nope-nope-nope" }) });
  assert.equal(bad.status, 401);
  const me = await call("/api/me", { token });
  assert.equal(me.body.user.email, ADMIN.email);
});

test("admin endpoints need a signed-in admin", async () => {
  assert.equal((await call("/api/admin/videos")).status, 401);
  assert.equal((await call("/api/admin/videos", { token: "fake-token" })).status, 401);
});

test("full upload flow: create draft → upload → convert → ready → publish → in catalog", async () => {
  let r = await call("/api/admin/videos", { token, method: "POST", body: JSON.stringify({ title: "Test: Jonah and the Big Fish", category: "bible", ref: "Jonah 1–2", talk: ["Q1", "Q2"] }) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;
  assert.equal(r.body.status, "draft");
  // publishing before there's a video is refused
  r = await call(`/api/admin/videos/${id}`, { token, method: "PUT", body: JSON.stringify({ status: "published" }) });
  assert.equal(r.status, 400);
  // upload
  r = await call(`/api/admin/videos/${id}/upload`, { token, method: "POST", body: JSON.stringify({ filename: "jonah.mp4", size: 1234 }) });
  assert.equal(r.status, 200); assert.ok(r.body.uploadUrl);
  const up = await fetch(r.body.uploadUrl, { method: "PUT", body: new Uint8Array(1234), headers: { "Content-Type": "video/mp4" } }); // no sign-in, like a real storage link
  assert.equal(up.status, 200);
  r = await call(`/api/admin/videos/${id}`, { token }); assert.equal(r.body.processing, "uploading");
  // convert
  r = await call(`/api/admin/videos/${id}/convert`, { token, method: "POST" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call(`/api/admin/videos/${id}`, { token }); assert.equal(r.body.processing, "converting");
  await new Promise(res => setTimeout(res, 2800)); // simulated converter finishes
  r = await call(`/api/admin/videos/${id}`, { token });
  assert.equal(r.body.processing, "ready"); assert.equal(r.body.source, "hls"); assert.equal(r.body.duration, 245);
  assert.match(r.body.streamUrl, /\/hls\/test-jonah-and-the-big-fish-[A-Za-z0-9]+\/master\.m3u8$/);
  // the streaming playlist is reachable, the original upload in the inbox is gone
  const pl = await fetch(r.body.streamUrl); assert.equal(pl.status, 200); assert.match(await pl.text(), /#EXTM3U/);
  // publish
  r = await call(`/api/admin/videos/${id}`, { token, method: "PUT", body: JSON.stringify({ status: "published", featured: true }) });
  assert.equal(r.status, 200); assert.equal(r.body.status, "published");
  const cat = await call("/api/catalog");
  const v = cat.body.videos.find(x => x.id === id);
  assert.ok(v); assert.equal(v.source.type, "hls"); assert.equal(v.featured, true);
  assert.equal(cat.body.videos.filter(x => x.featured).length, 1, "only one featured story");
  // clean up
  r = await call(`/api/admin/videos/${id}`, { token, method: "DELETE" }); assert.equal(r.status, 200);
  assert.equal((await fetch(v.source.url)).status, 404, "files removed with the video");
  await call(`/api/admin/videos/ade-and-the-jollof-mould`, { token, method: "PUT", body: JSON.stringify({ featured: true }) });
});

test("converter report-back needs the secret and the matching folder", async () => {
  let r = await call("/api/converter/callback", { method: "POST", body: JSON.stringify({ videoId: "noahs-ark", status: "ready", outputPrefix: "hls/x" }), headers: { "X-Converter-Secret": "wrong" } });
  assert.equal(r.status, 403);
  r = await call("/api/converter/callback", { method: "POST", body: JSON.stringify({ videoId: "noahs-ark", status: "ready", outputPrefix: "hls/not-expected" }), headers: { "X-Converter-Secret": "local-test-secret" } });
  assert.equal(r.status, 409);
});

test("YouTube links: bad IDs are refused", async () => {
  const r = await call("/api/admin/videos", { token, method: "POST", body: JSON.stringify({ title: "Bad link", youtubeId: "not-an-id" }) });
  assert.equal(r.status, 400);
});

test("categories: create, rename, refuse deleting a category that has videos", async () => {
  let r = await call("/api/admin/categories", { token, method: "POST", body: JSON.stringify({ name: "Test Category" }) });
  assert.equal(r.status, 201);
  r = await call("/api/admin/categories/test-category", { token, method: "PUT", body: JSON.stringify({ name: "Renamed" }) });
  assert.equal(r.status, 200);
  assert.equal((await call("/api/admin/categories/bible", { token, method: "DELETE" })).status, 409);
  assert.equal((await call("/api/admin/categories/test-category", { token, method: "DELETE" })).status, 200);
});

test("inbox originals are never served publicly", async () => {
  assert.equal((await fetch(B + "/media/inbox/anything.mp4")).status, 404);
});

test("admin page is served", async () => {
  const r = await fetch(B + "/admin/"); assert.equal(r.status, 200); assert.match(await r.text(), /LittleRoots Admin/);
});
