// Family Hub worker: static assets + verse audio, calendar, shared state, photos and weather APIs
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/verse-audio") return verseAudio(url, env, ctx);
    if (url.pathname === "/api/verse-text") return verseText(url, env, ctx);
    if (url.pathname === "/api/events") return events(url, env, ctx);
    if (url.pathname === "/api/weather") return weather(request, url, ctx, env);
    if (url.pathname === "/api/state") return state(request, env);
    if (url.pathname === "/api/photos" || url.pathname.startsWith("/api/photos/")) return photos(request, url, env);
    return env.ASSETS.fetch(request);
  }
};

// ---------- local weather (Open-Meteo; model-derived past weather + up to 16 forecast days) ----------
// Set WEATHER_LAT / WEATHER_LON / WEATHER_PLACE in wrangler.jsonc vars. Find coordinates:
// https://geocoding-api.open-meteo.com/v1/search?name=Your%20Town&countryCode=US
// API parameters: https://open-meteo.com/en/docs
let WEATHER_TIMEZONE = "America/Chicago";
const WEATHER_CODES = new Set([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
async function weather(request, url, ctx, env = {}) {
  if (env.TZ) WEATHER_TIMEZONE = env.TZ;
  const noStore = { "Cache-Control": "no-store" };
  const respond = response => request.method === "HEAD"
    ? new Response(null, { status: response.status, headers: response.headers }) : response;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Method not allowed" }, 405, { ...noStore, Allow: "GET, HEAD" });
  }
  const cache = caches.default;
  const key = new Request(new URL("/api/weather?v=1", url.origin).toString());
  // Cache availability should not determine weather availability.
  try { const hit = await cache.match(key); if (hit) return respond(hit); } catch {}
  const upstream = new URL("https://api.open-meteo.com/v1/forecast");
  upstream.search = new URLSearchParams({
    latitude: String(env.WEATHER_LAT || "39.8283"), longitude: String(env.WEATHER_LON || "-98.5795"), timezone: WEATHER_TIMEZONE,
    daily: "temperature_2m_max,temperature_2m_min,weather_code",
    temperature_unit: "fahrenheit", forecast_days: "16", past_days: "7"
  }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const up = await fetch(upstream.toString(), { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!up.ok) return respond(json({ error: "Weather service unavailable" }, up.status === 429 ? 503 : 502, noStore));
    const data = await up.json();
    const daily = data?.daily, units = data?.daily_units;
    const arrays = [daily?.time, daily?.temperature_2m_max, daily?.temperature_2m_min, daily?.weather_code];
    if (data?.timezone !== WEATHER_TIMEZONE || units?.temperature_2m_max !== "°F" || units?.temperature_2m_min !== "°F"
      || !arrays.every(Array.isArray) || !arrays[0].length || !arrays.every(a => a.length === arrays[0].length)) {
      return respond(json({ error: "Weather service returned incomplete data" }, 502, noStore));
    }
    const days = [];
    const seen = new Set();
    for (let i = 0; i < daily.time.length; i++) {
      const date = daily.time[i], high = daily.temperature_2m_max[i], low = daily.temperature_2m_min[i], code = daily.weather_code[i];
      // Missing values remain missing: Number(null) would incorrectly turn them into 0°F / clear skies.
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date
        || !Number.isFinite(high) || !Number.isFinite(low) || high < low || !WEATHER_CODES.has(code) || seen.has(date)) continue;
      seen.add(date);
      days.push({ date, high, low, code });
    }
    if (!days.length) return respond(json({ error: "Weather service returned no usable days" }, 502, noStore));
    days.sort((a, b) => a.date.localeCompare(b.date));
    const response = json({ location: env.WEATHER_PLACE || "", timezone: WEATHER_TIMEZONE, unit: "°F", generated: new Date().toISOString(), days },
      200, { "Cache-Control": "public, max-age=3600" });
    ctx.waitUntil(cache.put(key, response.clone()).catch(() => {}));
    return respond(response);
  } catch {
    return respond(json({ error: controller.signal.aborted ? "Weather service timed out" : "Weather service unavailable" },
      controller.signal.aborted ? 503 : 502, noStore));
  } finally { clearTimeout(timer); }
}

// ---------- shared state (one JSON blob in KV; newest rev wins, every screen pulls it) ----------
async function state(request, env) {
  if (!env.HUB_STATE) return json({ error: "HUB_STATE not bound" }, 503);
  const nocache = { "Cache-Control": "no-store" };
  if (request.method === "GET") {
    const cur = await env.HUB_STATE.get("state");
    return new Response(cur || "null", { headers: { "Content-Type": "application/json", ...nocache } });
  }
  if (request.method === "PUT") {
    let body; try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
    if (!body || typeof body._rev !== "number") return json({ error: "missing _rev" }, 400);
    const cur = await env.HUB_STATE.get("state", "json");
    if (cur && typeof cur._rev === "number" && cur._rev > body._rev) return json({ conflict: true, state: cur }, 409, nocache);
    await env.HUB_STATE.put("state", JSON.stringify(body));
    return json({ ok: true, _rev: body._rev }, 200, nocache);
  }
  return new Response("method", { status: 405 });
}

// ---------- family photos (10/29): JPEGs in KV ("photo:<id>"), list in "photos:index"; the page shrinks images before POSTing ----------
const PHOTO_ORIGINS = ["https://photos.google.com"];   // lets an in-page Google Photos sync script post straight from a photos.google.com tab (optional)
function cors(request) { const o = request.headers.get("Origin") || ""; return PHOTO_ORIGINS.includes(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,X-Name,X-Source,X-Album", "Access-Control-Max-Age": "86400" } : {}; }
async function photos(request, url, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
  if (!env.HUB_STATE) return json({ error: "HUB_STATE not bound" }, 503);
  const nocache = { "Cache-Control": "no-store", ...cors(request) };
  const m = url.pathname.match(/^\/api\/photos\/([a-z0-9]{6,24})$/);
  // Two stores: the first 368 (2025 album, 10/29) live in KV as photo:<id>; everything since lives in R2
  // (PHOTOS bucket, photos/<id>) — KV's free tier caps at 1 GB / 1,000 writes a day, the older albums blow past both.
  // The list is the keyspace of both (no shared index — back-to-back uploads raced on one and lost entries).
  const listAll = async () => {
    const legacy = (await env.HUB_STATE.get("photos:index", "json")) || []; const byId = new Map(legacy.map(p => [p.id, p]));
    const out = []; let cursor;
    do { const page = await env.HUB_STATE.list({ prefix: "photo:", limit: 1000, cursor }); cursor = page.list_complete ? null : page.cursor;
      for (const k of page.keys) { const id = k.name.slice(6); const md = k.metadata || {}; const old = byId.get(id) || {};
        out.push({ id, added: md.added || old.added || 0, bytes: md.bytes || old.bytes || 0, name: md.name || old.name || "", ...((md.source || old.source) ? { source: md.source || old.source } : {}), album: md.album || "2025" }); }
    } while (cursor);
    if (env.PHOTOS) { let c;
      do { const page = await env.PHOTOS.list({ prefix: "photos/", limit: 1000, cursor: c, include: ["customMetadata"] }); c = page.truncated ? page.cursor : null;
        for (const o of page.objects) { const md = o.customMetadata || {};
          out.push({ id: o.key.slice(7), added: +md.added || o.uploaded.getTime(), bytes: o.size, name: md.name || "", ...(md.source ? { source: md.source } : {}), ...(md.album ? { album: md.album } : {}) }); }
      } while (c); }
    return out.sort((a, b) => a.added - b.added);
  };
  if (request.method === "GET" && !m) return json({ photos: await listAll() }, 200, nocache);
  if (request.method === "GET" && m) {
    const hit = env.PHOTOS && await env.PHOTOS.get("photos/" + m[1]);
    if (hit) return new Response(hit.body, { headers: { "Content-Type": hit.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
    const { value, metadata } = await env.HUB_STATE.getWithMetadata("photo:" + m[1], "arrayBuffer");
    if (!value) return new Response("not found", { status: 404 });
    return new Response(value, { headers: { "Content-Type": (metadata && metadata.type) || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  if (request.method === "POST" && !m) {
    if (!env.PHOTOS) return json({ error: "PHOTOS not bound" }, 503);
    const buf = await request.arrayBuffer();
    if (buf.byteLength < 100) return json({ error: "empty" }, 400);
    if (buf.byteLength > 20 * 1024 * 1024) return json({ error: "too big" }, 413);
    const type = (request.headers.get("Content-Type") || "image/jpeg").split(";")[0].trim();
    if (!/^image\//.test(type)) return json({ error: "not an image" }, 415);
    const source = safeName(request.headers.get("X-Source")), album = safeName(request.headers.get("X-Album"));
    // album photos get an id derived from their Google base URL, so a re-run is a cheap HEAD instead of a full list
    let id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (source) {
      const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)))].map(b => b.toString(16).padStart(2, "0")).join("");
      id = "g" + h.slice(0, 15);
      if (await env.PHOTOS.head("photos/" + id)) return json({ ok: true, id, duplicate: true }, 200, nocache);
    }
    await env.PHOTOS.put("photos/" + id, buf, { httpMetadata: { contentType: type }, customMetadata: { added: String(Date.now()), name: safeName(request.headers.get("X-Name")), ...(source ? { source } : {}), ...(album ? { album } : {}) } });
    return json({ ok: true, id }, 200, nocache);
  }
  if (request.method === "DELETE" && m) {
    if (env.PHOTOS) await env.PHOTOS.delete("photos/" + m[1]);
    await env.HUB_STATE.delete("photo:" + m[1]);
    const legacy = (await env.HUB_STATE.get("photos:index", "json")) || [];
    if (legacy.some(p => p.id === m[1])) await env.HUB_STATE.put("photos:index", JSON.stringify(legacy.filter(p => p.id !== m[1])));
    return json({ ok: true }, 200, nocache);
  }
  return new Response("method", { status: 405 });
}
function safeName(v) { try { return decodeURIComponent(v || "").slice(0, 160); } catch { return ""; } }

// ---------- verse audio ----------
async function verseAudio(url, env, ctx) {
  const q = (url.searchParams.get("q") || "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!q) return new Response("missing q", { status: 400 });
  if (!env.ESV_API_KEY) return new Response("ESV_API_KEY not set", { status: 503 });
  const cache = caches.default;
  const key = new Request(new URL("/api/verse-audio?q=" + encodeURIComponent(q.toLowerCase()), url.origin).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const up = await fetch("https://api.esv.org/v3/passage/audio/?q=" + encodeURIComponent(q), {
    headers: { Authorization: "Token " + env.ESV_API_KEY }, redirect: "follow"
  });
  if (!up.ok) return new Response("esv " + up.status, { status: up.status === 401 ? 503 : 502 });
  const body = await up.arrayBuffer();
  const res = new Response(body, { headers: {
    "Content-Type": up.headers.get("Content-Type") || "audio/mpeg",
    "Cache-Control": "public, max-age=2592000",
    "X-Verse": q
  }});
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ---------- verse text: ESV passage split into numbered verses → {ref, verses:[{n,t}]} ----------
async function verseText(url, env, ctx) {
  const q = (url.searchParams.get("q") || "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!q) return new Response("missing q", { status: 400 });
  if (!env.ESV_API_KEY) return new Response("ESV_API_KEY not set", { status: 503 });
  const cache = caches.default;
  const key = new Request(new URL("/api/verse-text?v=2&q=" + encodeURIComponent(q.toLowerCase()), url.origin).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const p = new URLSearchParams({ q, "include-passage-references": "false", "include-verse-numbers": "true", "include-first-verse-numbers": "true",
    "include-footnotes": "false", "include-headings": "false", "include-short-copyright": "false", "include-selahs": "true", "indent-poetry": "false", "indent-paragraphs": "0" });
  const up = await fetch("https://api.esv.org/v3/passage/text/?" + p, { headers: { Authorization: "Token " + env.ESV_API_KEY } });
  if (!up.ok) return new Response("esv " + up.status, { status: up.status === 401 ? 503 : 502 });
  const j = await up.json();
  const raw = (j.passages || []).join(" ").replace(/\s+/g, " ").trim();
  const verses = []; const re = /\[(\d+)\]\s*([^\[]*)/g; let m;
  while ((m = re.exec(raw))) verses.push({ n: +m[1], t: m[2].trim() });
  const res = new Response(JSON.stringify({ ref: j.canonical || q, verses }), { headers: {
    "Content-Type": "application/json", "Cache-Control": "public, max-age=2592000" } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ---------- calendar events ----------
// CAL_FEEDS secret = JSON: [{"label":"Work","url":"https://calendar.google.com/calendar/ical/.../private-.../basic.ics","kind":"jason","me":"you@work.com"}, ...]
// kind "jason" = a parent's work calendar (hidden by the Family filter); anything else shows as family.
// TZ + KIDS come from wrangler vars (KIDS = comma list of kid ids; an event title naming a kid tags it to that kid).
let TZ = "America/Chicago";
let KIDS = [];

async function events(url, env, ctx) {
  if (env.TZ) TZ = env.TZ;
  KIDS = String(env.KIDS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!env.CAL_FEEDS) return json({ error: "CAL_FEEDS not set", events: [] }, 503);
  let feeds; try { feeds = JSON.parse(env.CAL_FEEDS); } catch { return json({ error: "CAL_FEEDS not JSON", events: [] }, 500); }
  const cache = caches.default;
  const ckey = new Request(new URL("/api/events?v=3", url.origin).toString());
  if (!url.searchParams.has("fresh")) { const hit = await cache.match(ckey); if (hit) return hit; }
  const now = new Date();
  const win = { from: addDays(now, -45), to: addDays(now, 400) };
  const out = [], errors = [];
  await Promise.all(feeds.map(async f => {
    try {
      const r = await fetch(f.url, { headers: { "User-Agent": "family-hub" }, cf: { cacheTtl: 300 } });
      if (!r.ok) throw new Error("http " + r.status);
      out.push(...parseIcs(await r.text(), f, win));
    } catch (e) { errors.push(`${f.label}: ${e.message}`); }
  }));
  // dedupe (same thing on two calendars) and sort
  const seen = new Set();
  const evs = out.filter(e => { const k = `${e.date}|${e.time || ""}|${e.title.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const res = json({ generated: now.toISOString(), count: evs.length, errors, events: evs }, 200, { "Cache-Control": "public, max-age=600" });
  ctx.waitUntil(cache.put(ckey, res.clone()));
  return res;
}
const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...h } });

// --- iCal → events --------------------------------------------------------
export function parseIcs(text, feed, win) {
  const lines = text.replace(/\r\n[ \t]|\n[ \t]/g, "").split(/\r?\n/);
  const vevents = []; let cur = null;
  for (const ln of lines) {
    if (ln === "BEGIN:VEVENT") { cur = {}; continue; }
    if (ln === "END:VEVENT") { if (cur) vevents.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = ln.indexOf(":"); if (i < 0) continue;
    const head = ln.slice(0, i), val = ln.slice(i + 1);
    const [name, ...ps] = head.split(";"); const params = {};
    for (const p of ps) { const j = p.indexOf("="); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ""); }
    const key = name.toUpperCase();
    const rec = { params, val };
    if (key === "EXDATE" || key === "ATTENDEE") (cur[key] = cur[key] || []).push(rec); else cur[key] = rec;
  }
  // overrides keyed by UID + RECURRENCE-ID
  const overrides = new Map();
  for (const v of vevents) if (v["RECURRENCE-ID"] && v.UID) overrides.set(v.UID.val + "|" + localKey(parseDt(v["RECURRENCE-ID"])), v);
  const out = [];
  for (const v of vevents) {
    if (v["RECURRENCE-ID"]) continue;                       // handled through its master
    if ((v.STATUS?.val || "").toUpperCase() === "CANCELLED") continue;
    if (declined(v, feed.me)) continue;
    const st = parseDt(v.DTSTART); if (!st) continue;
    const en = v.DTEND ? parseDt(v.DTEND) : null;
    const durMs = en ? en.ms - st.ms : (st.allDay ? 86400000 : 0);
    const starts = v.RRULE ? expand(st, v.RRULE.val, win) : [st];
    const ex = new Set((v.EXDATE || []).flatMap(e => e.val.split(",").map(x => localKey(parseDt({ params: e.params, val: x })))));
    for (const s of starts) {
      if (ex.has(localKey(s))) continue;
      const ov = v.UID && overrides.get(v.UID.val + "|" + localKey(s));
      let ev = v, s2 = s, d2 = durMs;
      if (ov) { if ((ov.STATUS?.val || "").toUpperCase() === "CANCELLED" || declined(ov, feed.me)) continue; ev = ov; s2 = parseDt(ov.DTSTART); const oe = ov.DTEND ? parseDt(ov.DTEND) : null; d2 = oe ? oe.ms - s2.ms : durMs; }
      if (s2.ms > win.to.getTime() || s2.ms + d2 < win.from.getTime()) continue;
      out.push(toEvent(ev, s2, d2, feed));
    }
  }
  return out;
}
function declined(v, me) {
  if (!me) return false;
  return (v.ATTENDEE || []).some(a => a.val.toLowerCase().includes(me.toLowerCase()) && (a.params.PARTSTAT || "").toUpperCase() === "DECLINED");
}
function toEvent(v, st, durMs, feed) {
  const title = (v.SUMMARY?.val || "(untitled)").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\n/g, " ").trim();
  const startL = local(st), endL = local({ ms: st.ms + durMs, allDay: st.allDay });
  const e = { date: startL.date, title, source: feed.label, allDay: !!st.allDay };
  if (!st.allDay) { e.time = startL.hm; e.end = endL.hm; if (endL.date !== startL.date && durMs > 0) e.endDate = endL.date; }
  else if (durMs > 86400000) e.endDate = endL.date;
  const org = (v.ORGANIZER?.params?.CN || "") + " " + (v.ORGANIZER?.val || "");
  const t = title.toLowerCase();
  const kids = KIDS.filter(k => new RegExp(`\\b${k}\\b`, "i").test(title));
  if (/\bflight|✈|airport|\bfly\b|depart|arrive/.test(t)) e.kind = "travel";
  else if (/vacation|\btrip\b|hawaii|o'ahu|oahu|cabin/.test(t)) e.kind = "vacation";
  else if (kids.length) { e.kind = "kid"; e.kids = kids; }
  else if (/family/i.test(org)) e.kind = "family";
  else e.kind = feed.kind || "family";
  return e;
}
// --- dates ---------------------------------------------------------------
function parseDt(p) {
  if (!p) return null;
  const v = p.val.trim(), tzid = p.params?.TZID;
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m || p.params?.VALUE === "DATE") { m = m || v.match(/^(\d{4})(\d{2})(\d{2})/); return { ms: zonedToUtc(+m[1], +m[2], +m[3], 0, 0, 0, TZ), allDay: true, y: +m[1], mo: +m[2], d: +m[3] }; }
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/); if (!m) return null;
  const [y, mo, d, h, mi, s] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)];
  if (m[7]) return { ms: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false };
  return { ms: zonedToUtc(y, mo, d, h, mi, s, tzid || TZ), allDay: false };
}
const fmtCache = {};
function parts(ms, tz) {
  const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }));
  const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(o.weekday) };
}
function zonedToUtc(y, mo, d, h, mi, s, tz) {           // wall time in tz → epoch ms (two-pass offset fix)
  let guess = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 2; i++) { const p = parts(guess, tz); const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s); guess += Date.UTC(y, mo - 1, d, h, mi, s) - asUtc; }
  return guess;
}
function local(dt) { const p = parts(dt.ms, TZ); const pad = n => String(n).padStart(2, "0"); return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, hm: `${pad(p.h)}:${pad(p.mi)}`, p }; }
function localKey(dt) { if (!dt) return ""; const l = local(dt); return dt.allDay ? l.date : l.date + "T" + l.hm; }
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
// --- RRULE (DAILY/WEEKLY/MONTHLY/YEARLY · INTERVAL · COUNT · UNTIL · BYDAY · BYMONTHDAY) ---
const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function expand(st, rule, win) {
  const r = {}; for (const kv of rule.split(";")) { const [k, v] = kv.split("="); r[k.toUpperCase()] = v; }
  const freq = r.FREQ, interval = +(r.INTERVAL || 1), count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseDt({ val: r.UNTIL, params: {} }).ms + (r.UNTIL.length === 8 ? 86400000 - 1 : 0) : Infinity;
  const byday = r.BYDAY ? r.BYDAY.split(",") : null, bymd = r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : null;
  const base = parts(st.ms, TZ); const hardStop = Math.min(until, win.to.getTime());
  const mk = (y, mo, d) => ({ ms: st.allDay ? zonedToUtc(y, mo, d, 0, 0, 0, TZ) : zonedToUtc(y, mo, d, base.h, base.mi, base.s, TZ), allDay: st.allDay });
  const out = []; let n = 0, guard = 0;
  const push = dt => { if (dt.ms < st.ms) return true; if (dt.ms > hardStop) return false; n++; if (n > count) return false; if (dt.ms + 86400000 * 2 >= win.from.getTime()) out.push(dt); return true; };
  if (freq === "DAILY") { for (let i = 0; guard++ < 5000; i += interval) { const d = new Date(Date.UTC(base.y, base.mo - 1, base.d + i)); if (!push(mk(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()))) break; } }
  else if (freq === "WEEKLY") {
    const days = byday ? byday.map(x => DOW[x.slice(-2)]) : [base.wd];
    const start = new Date(Date.UTC(base.y, base.mo - 1, base.d)); const wk0 = new Date(start.getTime() - start.getUTCDay() * 86400000);
    for (let w = 0; guard++ < 2000; w += interval) { let cont = true;
      for (const dw of [...days].sort()) { const d = new Date(wk0.getTime() + (w * 7 + dw) * 86400000); if (!push(mk(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()))) { cont = false; break; } }
      if (!cont) break; }
  }
  else if (freq === "MONTHLY") {
    for (let i = 0; guard++ < 1200; i += interval) { const y = base.y + Math.floor((base.mo - 1 + i) / 12), mo = ((base.mo - 1 + i) % 12) + 1; let cont = true;
      const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate(); let ds = [];
      if (byday) { for (const bd of byday) { const m = bd.match(/^([+-]?\d)?(\w\w)$/); const dw = DOW[m[2]], nth = m[1] ? +m[1] : 0;
          const hits = []; for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === dw) hits.push(d);
          if (!nth) ds.push(...hits); else { const pick = nth > 0 ? hits[nth - 1] : hits[hits.length + nth]; if (pick) ds.push(pick); } } }
      else if (bymd) ds = bymd.map(x => x < 0 ? dim + 1 + x : x).filter(x => x >= 1 && x <= dim);
      else ds = base.d <= dim ? [base.d] : [];
      for (const d of ds.sort((a, b) => a - b)) if (!push(mk(y, mo, d))) { cont = false; break; }
      if (!cont) break; }
  }
  else if (freq === "YEARLY") { for (let i = 0; guard++ < 200; i += interval) if (!push(mk(base.y + i, base.mo, base.d))) break; }
  else out.push(st);
  return out;
}
