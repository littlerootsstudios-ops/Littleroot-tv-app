import type { Context, Next } from "hono";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  PUBLIC_URL: string;
  MEDIA_PUBLIC_URL: string;
  ADMIN_EMAILS: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET: string;
  CONVERTER_REPO: string;
  MOCK_EXTERNAL: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  GITHUB_TOKEN?: string;
  CONVERTER_SECRET?: string;
}

export interface User { id: string; email: string; name: string | null; role: "admin" }
export type Vars = { user: User | null; tokenHash: string | null };
export type C = Context<{ Bindings: Env; Variables: Vars }>;

export const mock = (env: Env) => env.MOCK_EXTERNAL === "1";

/* ---------- small helpers ---------- */
const enc = new TextEncoder();
export function b64url(bytes: ArrayBuffer | Uint8Array) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = ""; for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export const randomId = (prefix = "") => prefix + randomToken(12);
export async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function hmacHex(algo: "SHA-256" | "SHA-512", key: string, data: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: algo }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export const isoIn = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export function err(c: C, status: number, code: string, message: string) {
  return c.json({ error: code, message }, status as any);
}

/* ---------- passwords (PBKDF2-SHA256, 100k rounds: the Workers maximum) ---------- */
const ROUNDS = 100_000;
async function pbkdf2(password: string, salt: Uint8Array, rounds: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256));
}
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ROUNDS}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, ROUNDS))}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [scheme, rounds, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const salt = Uint8Array.from(atob(saltB64.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0));
  return safeEqual(b64url(await pbkdf2(password, salt, Number(rounds))), hashB64);
}

/* ---------- sessions ---------- */
export async function createSession(env: Env, userId: string) {
  const token = randomToken(32);
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, last_seen) VALUES (?,?,?,datetime('now'))")
    .bind(await sha256Hex(token), userId, isoIn(30 * 86400)).run();
  return token;
}

/** Reads "Authorization: Bearer <token>" and loads the user (if any). */
export async function loadUser(c: C, next: Next) {
  c.set("user", null); c.set("tokenHash", null);
  const h = c.req.header("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (token) {
    const hash = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      "SELECT u.id, u.email, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?"
    ).bind(hash).first<User & { expires_at: string }>();
    if (row && row.expires_at > new Date().toISOString()) {
      c.set("user", { id: row.id, email: row.email, name: row.name, role: row.role });
      c.set("tokenHash", hash);
      c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE sessions SET last_seen = datetime('now') WHERE token_hash = ?").bind(hash).run());
    }
  }
  await next();
}
export async function requireAdmin(c: C, next: Next) {
  const u = c.get("user");
  if (!u) return err(c, 401, "sign_in_required", "Please sign in.");
  if (u.role !== "admin") return err(c, 403, "admins_only", "This page is for LittleRoots admins.");
  await next();
}
