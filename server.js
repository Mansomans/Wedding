// Wedding Weekend backend.
// Serves public/ and a small JSON API. Storage is Postgres when DATABASE_URL
// is set (Render), otherwise a JSON file in data/ for local development.

import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SITE_PASSWORD = (process.env.SITE_PASSWORD || "09102026").replace(/\D/g, "");
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_DAYS = 30;
const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.RENDER;
if (!process.env.SITE_PASSWORD) console.warn("SITE_PASSWORD not set; using the built-in default.");
if (!process.env.SESSION_SECRET) console.warn("SESSION_SECRET not set; sessions reset on every restart.");

/* ---------------- storage ---------------- */
let store;

class PgStore {
  constructor(url) {
    this.pool = new pg.Pool({ connectionString: url, ssl: /render\.com|sslmode=require/.test(url) ? { rejectUnauthorized: false } : false });
  }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS plan (id int PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS guests (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
  }
  async getState() {
    const [p, g] = await Promise.all([
      this.pool.query(`SELECT data, updated_at FROM plan WHERE id = 1`),
      this.pool.query(`SELECT data, updated_at FROM guests ORDER BY data->>'name'`),
    ]);
    const times = [...p.rows, ...g.rows].map(r => new Date(r.updated_at).getTime());
    return { plan: p.rows[0]?.data || null, guests: g.rows.map(r => r.data), version: times.length ? Math.max(...times) : 0 };
  }
  async setPlan(plan) {
    await this.pool.query(`INSERT INTO plan (id, data, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [plan]);
  }
  async putGuests(list) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const g of list) await client.query(`INSERT INTO guests (id, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [g.id, g]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  }
  async deleteGuest(id) { await this.pool.query(`DELETE FROM guests WHERE id = $1`, [id]); }
}

class FileStore {
  constructor(file) { this.file = file; this.data = { plan: null, guests: {}, version: 0 }; }
  async init() {
    try { this.data = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { /* fresh */ }
  }
  save() { this.data.version = Date.now(); fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }
  async getState() {
    const guests = Object.values(this.data.guests).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return { plan: this.data.plan, guests, version: this.data.version };
  }
  async setPlan(plan) { this.data.plan = plan; this.save(); }
  async putGuests(list) { for (const g of list) this.data.guests[g.id] = g; this.save(); }
  async deleteGuest(id) { delete this.data.guests[id]; this.save(); }
}

/* ---------------- sessions ---------------- */
function sign(payload) {
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function makeToken() { return sign(String(Date.now() + SESSION_DAYS * 86400000)); }
function verifyToken(token) {
  if (!token || typeof token !== "string") return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const expected = sign(payload);
  const a = Buffer.from(token), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(payload) > Date.now();
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("="); if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function setSession(res, token) {
  const attrs = [`ww_session=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_DAYS * 86400}`];
  if (IS_PROD) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}
function clearSession(res) { res.setHeader("Set-Cookie", "ww_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"); }
function requireAuth(req, res, next) {
  if (verifyToken(cookies(req).ww_session)) return next();
  res.status(401).json({ error: "locked" });
}

// Simple login throttle: 15 attempts per IP per 15 minutes.
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, reset: now + 15 * 60000 };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + 15 * 60000; }
  rec.n++; attempts.set(ip, rec);
  return rec.n > 15;
}

/* ---------------- validation ---------------- */
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
function cleanCustomOption(o) {
  if (!isObj(o) || typeof o.id !== "string" || !/^[\w-]{4,60}$/.test(o.id)) return null;
  const out = { id: o.id, custom: true, name: String(o.name || "").trim().slice(0, 120) || "Added option" };
  if (typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) out.date = o.date;
  if (Number.isFinite(Number(o.costFactor))) out.costFactor = Math.min(3, Math.max(0.1, Number(o.costFactor)));
  for (const k of ["where", "desc", "time", "duration"]) if (o[k]) out[k] = String(o[k]).slice(0, 300);
  for (const k of ["fixed", "perGuest", "capacity"]) if (o[k] !== undefined && Number.isFinite(Number(o[k]))) out[k] = Math.max(0, Number(o[k]));
  for (const k of ["pros", "cons"]) if (Array.isArray(o[k])) out[k] = o[k].slice(0, 8).map(x => String(x).slice(0, 120)).filter(Boolean);
  if (typeof o.link === "string" && /^https?:\/\/[^\s]{1,500}$/.test(o.link)) out.link = o.link;
  return out;
}
function cleanPlan(p) {
  if (!isObj(p)) return null;
  const customOptions = {};
  if (isObj(p.customOptions)) {
    for (const [did, list] of Object.entries(p.customOptions)) {
      if (!/^[\w-]{1,40}$/.test(did) || !Array.isArray(list)) continue;
      customOptions[did] = list.slice(0, 50).map(cleanCustomOption).filter(Boolean);
    }
  }
  const rate = Number(p.plusOneRate);
  return {
    picks: isObj(p.picks) ? p.picks : {}, extras: isObj(p.extras) ? p.extras : {}, notes: isObj(p.notes) ? p.notes : {},
    customOptions, plusOneRate: Number.isFinite(rate) ? Math.min(100, Math.max(0, Math.round(rate))) : 100,
  };
}
function cleanGuest(g) {
  if (!isObj(g) || typeof g.id !== "string" || !/^[\w-]{4,40}$/.test(g.id)) return null;
  const name = String(g.name || "").trim().slice(0, 120);
  if (!name) return null;
  return {
    id: g.id, name,
    side: String(g.side || "").slice(0, 60), group: String(g.group || "").slice(0, 60),
    party: Math.min(20, Math.max(1, Math.round(Number(g.party) || 1))),
    plusOne: !!g.plusOne,
    status: ["invited", "maybe", "no"].includes(g.status) ? g.status : "invited",
    events: isObj(g.events) ? Object.fromEntries(Object.entries(g.events).map(([k, v]) => [String(k).slice(0, 30), !!v])) : {},
    notes: String(g.notes || "").slice(0, 500),
    createdAt: Number(g.createdAt) || Date.now(),
  };
}

/* ---------------- app ---------------- */
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => { res.setHeader("X-Robots-Tag", "noindex, nofollow"); res.setHeader("Cache-Control", "no-store"); next(); });

app.post("/api/login", (req, res) => {
  if (throttled(req.ip)) return res.status(429).json({ error: "Too many attempts. Wait 15 minutes and try again." });
  const given = String(req.body?.password || "").replace(/\D/g, "");
  const a = Buffer.from(given), b = Buffer.from(SITE_PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: "wrong" });
  attempts.delete(req.ip);
  setSession(res, makeToken());
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => { clearSession(res); res.json({ ok: true }); });

app.get("/api/state", requireAuth, async (req, res, next) => {
  try { res.json(await store.getState()); } catch (e) { next(e); }
});
app.put("/api/plan", requireAuth, async (req, res, next) => {
  try {
    const plan = cleanPlan(req.body);
    if (!plan) return res.status(400).json({ error: "bad plan" });
    await store.setPlan(plan);
    res.json(await store.getState());
  } catch (e) { next(e); }
});
app.put("/api/guests", requireAuth, async (req, res, next) => {
  try {
    const list = (Array.isArray(req.body) ? req.body : [req.body]).map(cleanGuest);
    if (!list.length || list.some(g => !g)) return res.status(400).json({ error: "bad guest" });
    if (list.length > 500) return res.status(400).json({ error: "too many at once" });
    await store.putGuests(list);
    res.json(await store.getState());
  } catch (e) { next(e); }
});
app.delete("/api/guests/:id", requireAuth, async (req, res, next) => {
  try { await store.deleteGuest(req.params.id); res.json(await store.getState()); } catch (e) { next(e); }
});
app.get("/healthz", (req, res) => res.type("text").send("ok"));

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: "server error" });
});

(async () => {
  store = process.env.DATABASE_URL ? new PgStore(process.env.DATABASE_URL) : new FileStore(path.join(__dirname, "data", "local.json"));
  await store.init();
  console.log(`Storage: ${process.env.DATABASE_URL ? "Postgres" : "local JSON file (data/local.json)"}`);
  app.listen(PORT, () => console.log(`Wedding Weekend listening on http://localhost:${PORT}`));
})().catch(e => { console.error("Failed to start:", e); process.exit(1); });
