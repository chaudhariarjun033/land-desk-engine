// land-desk-engine — Cloudflare Worker for ccinvgroup.com (Chaudhari Investments LLC)
// Serves the website, takes seller-form submissions into D1 (table site_leads).
// Land Desk's sync agent reads new rows through the Cloudflare D1 API and marks them synced.
import INDEX from "./pages/index.html";
import PRIVACY from "./pages/privacy.html";
import TERMS from "./pages/terms.html";
import NOT_FOUND from "./pages/404.html";

const CANON = "ccinvgroup.com";
const REDIRECT_HOSTS = new Set(["www.ccinvgroup.com", "ccinvland.com", "www.ccinvland.com", "ccinvholdings.com", "www.ccinvholdings.com"]);
const PAGES = { "/": INDEX, "/index.html": INDEX, "/privacy": PRIVACY, "/terms": TERMS };

const FIELDS = {
  firstName: 80, lastName: 80, email: 160, phone: 40, mailAddr: 300, situs: 300, county: 80, state: 2,
  apn: 80, acres: 40, landType: 40, ownership: 80, timeline: 60, askingPrice: 60, taxes: 40, liens: 40,
  hoa: 40, access: 60, notes: 5000, heardFrom: 60, page: 300, submittedAt: 40,
};
const STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
const UTIL = new Set(["Water", "Sewer", "Septic possible", "Electric", "Not sure"]);
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
const HOURLY_LIMIT = 5;
// Land Desk sync agent auth: SHA-256 of the admin key (the key itself is kept in Land Desk, not in code).
const ADMIN_KEY_SHA256 = "845fc67380bf0fdf052fc9090912142b43fea860a14005048178c6568c435945";
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS site_leads (id TEXT PRIMARY KEY, created TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, first_name TEXT, last_name TEXT, situs TEXT, county TEXT, state TEXT, apn TEXT, acres TEXT, data TEXT NOT NULL, ip_hash TEXT, ua TEXT, country TEXT, synced INTEGER NOT NULL DEFAULT 0, synced_at TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_site_leads_created ON site_leads(created)",
  "CREATE INDEX IF NOT EXISTS idx_site_leads_ip ON site_leads(ip_hash, created)",
  "CREATE INDEX IF NOT EXISTS idx_site_leads_email ON site_leads(email, situs)",
  "CREATE INDEX IF NOT EXISTS idx_site_leads_synced ON site_leads(synced)",
];
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
  schemaReady = true;
}
async function isAdmin(req) {
  const k = req.headers.get("x-admin-key") || "";
  return k.length > 20 && (await sha256(k)) === ADMIN_KEY_SHA256;
}
async function handleAdmin(req, env, path) {
  if (!(await isAdmin(req))) return json({ ok: false, error: "auth" }, 401);
  if (path === "/api/admin/leads" && req.method === "GET") {
    const all = new URL(req.url).searchParams.get("all") === "1";
    const rows = await env.DB.prepare(`SELECT id, created, data, country, synced FROM site_leads ${all ? "" : "WHERE synced=0"} ORDER BY created LIMIT 200`).all();
    return json({ ok: true, leads: rows.results.map((r) => ({ id: r.id, created: r.created, country: r.country, synced: r.synced, ...JSON.parse(r.data) })) });
  }
  if (path === "/api/admin/ack" && req.method === "POST") {
    const { ids } = await req.json().catch(() => ({}));
    if (!Array.isArray(ids) || !ids.length || ids.length > 200) return json({ ok: false, error: "ids" }, 400);
    const now = new Date().toISOString();
    await env.DB.batch(ids.map((id) => env.DB.prepare("UPDATE site_leads SET synced=1, synced_at=?1 WHERE id=?2").bind(now, String(id))));
    return json({ ok: true, acked: ids.length });
  }
  if (path === "/api/admin/delete" && req.method === "POST") {
    const { ids } = await req.json().catch(() => ({}));
    if (!Array.isArray(ids) || !ids.length || ids.length > 200) return json({ ok: false, error: "ids" }, 400);
    await env.DB.batch(ids.map((id) => env.DB.prepare("DELETE FROM site_leads WHERE id=?1").bind(String(id))));
    return json({ ok: true, deleted: ids.length });
  }
  return json({ ok: false, error: "not_found" }, 404);
}

const SEC_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
};

const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", ...SEC_HEADERS } });
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...SEC_HEADERS } });
const text = (body, type = "text/plain") => new Response(body, { headers: { "content-type": type + "; charset=utf-8", "cache-control": "public, max-age=3600" } });

async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function handleLead(req, env) {
  const origin = req.headers.get("origin");
  if (origin && !/^https:\/\/(www\.)?ccinvgroup\.com$/.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
    return json({ ok: false, error: "origin" }, 403);
  if (!(req.headers.get("content-type") || "").includes("application/json")) return json({ ok: false, error: "type" }, 415);
  const raw = await req.text();
  if (raw.length > 20000) return json({ ok: false, error: "too_large" }, 413);
  let d;
  try { d = JSON.parse(raw); } catch { return json({ ok: false, error: "json" }, 400); }
  if (!d || typeof d !== "object") return json({ ok: false, error: "json" }, 400);

  // Bots: honeypot filled, or submitted faster than a person could fill the form. Pretend success.
  if (d.website || (typeof d.ms === "number" && d.ms < 2500)) return json({ ok: true });

  const lead = {};
  for (const [k, max] of Object.entries(FIELDS)) {
    if (d[k] == null) continue;
    const v = String(d[k]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
    if (v) lead[k] = v;
  }
  lead.utilities = Array.isArray(d.utilities) ? d.utilities.filter((u) => UTIL.has(u)) : [];
  lead.consentEmail = d.consentEmail === true;
  lead.consentPhone = d.consentPhone === true && !!lead.phone;
  if (lead.state) lead.state = lead.state.toUpperCase();

  const missing = ["firstName", "lastName", "email", "situs", "county", "state"].filter((k) => !lead[k]);
  if (missing.length) return json({ ok: false, error: "missing", fields: missing }, 422);
  if (!EMAIL_RE.test(lead.email)) return json({ ok: false, error: "email" }, 422);
  if (!STATES.has(lead.state)) return json({ ok: false, error: "state" }, 422);
  if (!lead.consentEmail) return json({ ok: false, error: "consent" }, 422);
  lead.email = lead.email.toLowerCase();

  const ip = req.headers.get("cf-connecting-ip") || "0.0.0.0";
  const ipHash = (await sha256(ip + "|" + (env.IP_SALT || "ccinv-land-desk"))).slice(0, 32);
  const now = new Date();
  const hourAgo = new Date(now - 3600e3).toISOString();
  const dayAgo = new Date(now - 86400e3).toISOString();

  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_leads WHERE ip_hash=?1 AND created>?2").bind(ipHash, hourAgo).first();
  if (recent && recent.n >= HOURLY_LIMIT) return json({ ok: false, error: "rate" }, 429);

  // Same person, same property, within a day: treat as a duplicate, don't store twice.
  const dup = await env.DB.prepare("SELECT id FROM site_leads WHERE email=?1 AND situs=?2 AND created>?3 LIMIT 1").bind(lead.email, lead.situs, dayAgo).first();
  if (dup) return json({ ok: true, id: dup.id, duplicate: true });

  const id = "web_" + now.toISOString().replace(/\D/g, "").slice(0, 14) + "_" + crypto.randomUUID().slice(0, 8);
  await env.DB.prepare(
    "INSERT INTO site_leads (id, created, email, phone, first_name, last_name, situs, county, state, apn, acres, data, ip_hash, ua, country) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)"
  ).bind(
    id, now.toISOString(), lead.email, lead.phone || null, lead.firstName, lead.lastName, lead.situs, lead.county, lead.state,
    lead.apn || null, lead.acres || null, JSON.stringify(lead), ipHash, (req.headers.get("user-agent") || "").slice(0, 300),
    (req.cf && req.cf.country) || null
  ).run();
  return json({ ok: true, id });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const host = url.hostname.toLowerCase();
    if (REDIRECT_HOSTS.has(host)) return Response.redirect(`https://${CANON}${url.pathname}${url.search}`, 301);

    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path.startsWith("/api/")) {
      try { await ensureSchema(env); } catch (e) { console.error("schema_error", e && e.message); }
    }
    if (path.startsWith("/api/admin/")) {
      try { return await handleAdmin(req, env, path); }
      catch (e) { console.error("admin_error", e && e.message); return json({ ok: false, error: "server" }, 500); }
    }
    if (path === "/api/lead") {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { allow: "POST" } });
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      try { return await handleLead(req, env); }
      catch (e) { console.error("lead_error", e && e.message); return json({ ok: false, error: "server" }, 500); }
    }
    if (path === "/api/health") {
      let db = false;
      try { db = !!(await env.DB.prepare("SELECT 1 AS ok").first()); } catch {}
      return json({ ok: db, db, time: new Date().toISOString() }, db ? 200 : 503);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json({ ok: false, error: "method" }, 405);
    if (path === "/robots.txt") return text(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://${CANON}/sitemap.xml\n`);
    if (path === "/sitemap.xml")
      return text(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          ["/", "/privacy", "/terms"].map((p) => `  <url><loc>https://${CANON}${p}</loc></url>`).join("\n") + "\n</urlset>\n",
        "application/xml"
      );
    if (path === "/privacy.html" || path === "/terms.html") return Response.redirect(`https://${CANON}${path.replace(".html", "")}`, 301);
    const page = PAGES[path];
    return page ? html(page) : html(NOT_FOUND, 404);
  },
};
