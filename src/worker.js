// Creyo projecttool: one Worker that serves the page and its API.
// Every request must carry a valid Cloudflare Access login of a known person.
// No keys or secrets ever reach the browser.

import { validateUpdate, describeUpdate, describeItemChange } from "./update.js";

const MAX_FILE = 10 * 1024 * 1024;
const FILE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
const TEXT_MAX = 8000;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function secure(res, { html = false } = {}) {
  const h = new Headers(res.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("X-Frame-Options", "DENY");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  h.set("Strict-Transport-Security", "max-age=31536000");
  if (html) h.set("Content-Security-Policy", CSP);
  if (!h.has("Cache-Control")) h.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const json = (data, status = 200) =>
  secure(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } }));
const fail = (status, error, detail) => json({ error, ...(detail ? { detail } : {}) }, status);
const now = () => new Date().toISOString();

// ---------- people and auth ----------

function people(env) {
  try {
    const p = JSON.parse(env.PEOPLE || "{}");
    return Object.fromEntries(
      Object.entries(p).map(([key, v]) => [key, { key, name: String(v.name), email: String(v.email).toLowerCase(), admin: !!v.admin }]),
    );
  } catch {
    return {};
  }
}

function names(env) {
  return Object.fromEntries(Object.values(people(env)).map((p) => [p.key, p.name]));
}

function personByEmail(env, email) {
  const e = String(email || "").toLowerCase();
  return Object.values(people(env)).find((p) => p.email === e) || null;
}

const b64urlToBytes = (s) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

let jwksCache = { at: 0, team: "", keys: [] };
async function accessKeys(team, force) {
  if (!force && jwksCache.team === team && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("certs_unavailable");
  const j = await r.json();
  jwksCache = { at: Date.now(), team, keys: j.keys || [] };
  return jwksCache.keys;
}

export async function verifyAccessJwt(token, env) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!token || !team || !aud || team.startsWith("REPLACE") || aud.startsWith("REPLACE")) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  let keys = await accessKeys(team, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await accessKeys(team, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return null;
  const nowS = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  if (payload.iss !== `https://${team}`) return null;
  if (typeof payload.exp !== "number" || payload.exp < nowS) return null;
  if (typeof payload.nbf === "number" && payload.nbf > nowS + 60) return null;
  return payload.email ? String(payload.email).toLowerCase() : null;
}

async function currentUser(request, env) {
  const url = new URL(request.url);
  // Local development only: never active on a real hostname.
  if (env.DEV_AUTH_EMAIL && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    return personByEmail(env, request.headers.get("X-Dev-Email") || env.DEV_AUTH_EMAIL);
  }
  const email = await verifyAccessJwt(request.headers.get("Cf-Access-Jwt-Assertion"), env);
  return email ? personByEmail(env, email) : null;
}

// ---------- data helpers ----------

async function all(env, sql, ...args) {
  return (await env.DB.prepare(sql).bind(...args).all()).results || [];
}
async function first(env, sql, ...args) {
  return await env.DB.prepare(sql).bind(...args).first();
}
function historyRow(env, itemId, at, who, what, reason) {
  return env.DB.prepare("INSERT INTO item_history (item_id, at, who, what, reason) VALUES (?,?,?,?,?)").bind(itemId, at, who, what.slice(0, 500), (reason || "").slice(0, 500));
}
function change(env, who, kind, ref, summary) {
  return env.DB.prepare("INSERT INTO changes (at, who, kind, ref, summary) VALUES (?,?,?,?,?)").bind(now(), who, kind, String(ref), summary.slice(0, 300));
}
async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
const cleanText = (v, max = TEXT_MAX) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);

async function snapshot(env) {
  const [phases, items, log, meta] = await Promise.all([
    all(env, "SELECT * FROM phases ORDER BY sort, id"),
    all(env, "SELECT * FROM items ORDER BY sort, id"),
    all(env, "SELECT * FROM log ORDER BY id"),
    all(env, "SELECT * FROM meta"),
  ]);
  return { phases, items, log, meta };
}

function restoreStatements(env, snap) {
  const s = [
    env.DB.prepare("DELETE FROM items"),
    env.DB.prepare("DELETE FROM phases"),
    env.DB.prepare("DELETE FROM log"),
    env.DB.prepare("DELETE FROM meta"),
  ];
  for (const p of snap.phases || [])
    s.push(env.DB.prepare("INSERT INTO phases (id, name, note, sort) VALUES (?,?,?,?)").bind(p.id, p.name, p.note || "", p.sort || 0));
  for (const i of snap.items || [])
    s.push(
      env.DB.prepare(
        "INSERT INTO items (id, phase_id, title, owner, status, priority, why, next, waits_for, sort, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(i.id, i.phase_id, i.title, i.owner, i.status, i.priority, i.why || "", i.next || "", i.waits_for || "", i.sort || 0, i.updated_at, i.updated_by),
    );
  for (const l of snap.log || [])
    s.push(
      env.DB.prepare("INSERT INTO log (id, date, title, what, why, result, item_ids, phase_ids, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(
        l.id, l.date, l.title, l.what || "", l.why || "", l.result || "", l.item_ids || "", l.phase_ids || "", l.created_at, l.created_by,
      ),
    );
  for (const m of snap.meta || []) s.push(env.DB.prepare("INSERT INTO meta (key, value) VALUES (?,?)").bind(m.key, m.value));
  return s;
}

// ---------- routes ----------

async function getState(env, user) {
  const ppl = people(env);
  const [phases, items, log, meta, feedback, comments, files, history] = await Promise.all([
    all(env, "SELECT * FROM phases ORDER BY sort, id"),
    all(env, "SELECT * FROM items ORDER BY sort, id"),
    all(env, "SELECT * FROM log ORDER BY date DESC, id DESC"),
    all(env, "SELECT * FROM meta"),
    all(env, "SELECT * FROM feedback ORDER BY id DESC"),
    all(env, "SELECT * FROM comments ORDER BY id"),
    all(env, "SELECT id, target_type, target_id, name, content_type, size, created_at, created_by FROM files ORDER BY created_at"),
    all(env, "SELECT * FROM item_history ORDER BY id DESC"),
  ]);
  return {
    me: { key: user.key, name: user.name, admin: user.admin },
    people: Object.values(ppl).map((p) => ({ key: p.key, name: p.name, admin: p.admin })),
    meta: Object.fromEntries(meta.map((m) => [m.key, m.value])),
    phases,
    items,
    log,
    feedback,
    comments,
    files,
    history,
  };
}

const MEMBER_ITEM_FIELDS = ["status", "owner"];
const ADMIN_ITEM_FIELDS = ["status", "owner", "title", "why", "next", "waits_for", "priority", "phase_id"];

async function patchItem(env, user, id, body) {
  const item = await first(env, "SELECT * FROM items WHERE id = ?", id);
  if (!item) return fail(404, "not_found");
  const allowed = user.admin ? ADMIN_ITEM_FIELDS : MEMBER_ITEM_FIELDS;
  const ppl = people(env);
  const set = {};
  for (const k of allowed) {
    if (!(k in (body || {}))) continue;
    let v = body[k];
    if (k === "status" && !["open", "busy", "wait", "done"].includes(v)) return fail(400, "invalid_status");
    if (k === "owner" && v !== null && !ppl[v]) return fail(400, "invalid_owner");
    if (k === "priority" && ![1, 2, 3].includes(v)) return fail(400, "invalid_priority");
    if (k === "phase_id" && v !== null && !(await first(env, "SELECT id FROM phases WHERE id = ?", v))) return fail(400, "invalid_phase");
    if (["title", "why", "next", "waits_for"].includes(k)) v = cleanText(v, k === "title" ? 200 : TEXT_MAX);
    if (item[k] !== v) set[k] = v;
  }
  if (!Object.keys(set).length) return json({ ok: true, item });
  const reason = cleanText(body?.reason, 500);
  const cols = Object.keys(set);
  const what = describeItemChange(item, set, names(env)).join(", ");
  const summary = cols.map((c) => `${c}: ${item[c] ?? "-"} -> ${set[c] ?? "-"}`).join("; ") + (reason ? ` | waarom: ${reason}` : "");
  const t = now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE items SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ?, updated_by = ? WHERE id = ?`).bind(
      ...cols.map((c) => set[c]),
      t,
      user.key,
      id,
    ),
    historyRow(env, id, t, user.key, what || "Aangepast", reason),
    change(env, user.key, "item_update", id, summary),
  ]);
  return json({ ok: true, item: await first(env, "SELECT * FROM items WHERE id = ?", id) });
}

async function postFeedback(env, user, body) {
  const text = cleanText(body?.text);
  if (!text) return fail(400, "text_required");
  const ppl = people(env);
  const forOwner = body?.for_owner && ppl[body.for_owner] ? body.for_owner : null;
  const r = await env.DB.prepare("INSERT INTO feedback (text, for_owner, status, created_at, created_by) VALUES (?,?, 'new', ?, ?)")
    .bind(text, forOwner, now(), user.key)
    .run();
  const id = r.meta.last_row_id;
  await change(env, user.key, "feedback_new", id, text.slice(0, 160)).run();
  return json({ ok: true, id });
}

async function patchFeedback(env, user, id, body) {
  if (!user.admin) return fail(403, "admin_only");
  const fb = await first(env, "SELECT * FROM feedback WHERE id = ?", id);
  if (!fb) return fail(404, "not_found");
  const status = body?.status;
  if (!["new", "converted", "closed"].includes(status)) return fail(400, "invalid_status");
  const itemId = body?.item_id ? cleanText(body.item_id, 20) : fb.item_id;
  await env.DB.batch([
    env.DB.prepare("UPDATE feedback SET status = ?, item_id = ? WHERE id = ?").bind(status, itemId, id),
    change(env, user.key, "feedback_update", id, `status -> ${status}${itemId ? ` (${itemId})` : ""}`),
  ]);
  return json({ ok: true });
}

async function targetExists(env, type, id) {
  if (type === "item") return !!(await first(env, "SELECT id FROM items WHERE id = ?", id));
  if (type === "feedback") return !!(await first(env, "SELECT id FROM feedback WHERE id = ?", Number(id)));
  return false;
}

async function postComment(env, user, body) {
  const type = body?.target_type;
  const target = String(body?.target_id ?? "");
  const text = cleanText(body?.text);
  if (!text) return fail(400, "text_required");
  if (!(await targetExists(env, type, target))) return fail(404, "target_not_found");
  const r = await env.DB.prepare("INSERT INTO comments (target_type, target_id, text, created_at, created_by) VALUES (?,?,?,?,?)")
    .bind(type, target, text, now(), user.key)
    .run();
  await change(env, user.key, "comment_new", `${type}:${target}`, text.slice(0, 160)).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

function safeName(n) {
  return cleanText(n || "screenshot", 120).replace(/[^\w.\- ]+/g, "_") || "screenshot";
}

async function postFile(env, user, request, url) {
  const type = url.searchParams.get("target_type");
  const target = url.searchParams.get("target_id") || "";
  if (!(await targetExists(env, type, target))) return fail(404, "target_not_found");
  const ct = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!FILE_TYPES.has(ct)) return fail(415, "unsupported_type", "Alleen afbeeldingen (png, jpg, webp, gif) en pdf.");
  const len = Number(request.headers.get("Content-Length") || "0");
  if (len > MAX_FILE) return fail(413, "too_large", "Maximaal 10 MB.");
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) return fail(400, "empty");
  if (buf.byteLength > MAX_FILE) return fail(413, "too_large", "Maximaal 10 MB.");
  const id = crypto.randomUUID();
  const name = safeName(request.headers.get("X-File-Name"));
  await env.FILES.put(id, buf, { httpMetadata: { contentType: ct } });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO files (id, target_type, target_id, name, content_type, size, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)").bind(
      id, type, target, name, ct, buf.byteLength, now(), user.key,
    ),
    change(env, user.key, "file_new", `${type}:${target}`, name),
  ]);
  return json({ ok: true, id, name });
}

async function getFile(env, id) {
  const meta = await first(env, "SELECT * FROM files WHERE id = ?", id);
  if (!meta) return fail(404, "not_found");
  const obj = await env.FILES.get(id);
  if (!obj) return fail(404, "not_found");
  return secure(
    new Response(obj.body, {
      headers: {
        "Content-Type": meta.content_type,
        "Content-Disposition": `inline; filename="${meta.name.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    }),
  );
}

async function deleteFile(env, user, id) {
  const meta = await first(env, "SELECT * FROM files WHERE id = ?", id);
  if (!meta) return fail(404, "not_found");
  if (!user.admin && meta.created_by !== user.key) return fail(403, "forbidden");
  await env.FILES.delete(id);
  await env.DB.batch([env.DB.prepare("DELETE FROM files WHERE id = ?").bind(id), change(env, user.key, "file_deleted", `${meta.target_type}:${meta.target_id}`, meta.name)]);
  return json({ ok: true });
}

async function exportForClaude(env) {
  const ppl = people(env);
  const nm = (k) => ppl[k]?.name || (String(k).startsWith("claude") ? "Claude" : k);
  const since = (await first(env, "SELECT value FROM meta WHERE key = 'last_export_at'"))?.value || "";
  const [changes, fbOpen, items, files, comments] = await Promise.all([
    all(env, "SELECT * FROM changes WHERE at > ? ORDER BY id", since),
    all(env, "SELECT * FROM feedback WHERE status = 'new' ORDER BY id"),
    all(env, "SELECT id, phase_id, title, owner, status, priority, next, waits_for FROM items ORDER BY sort, id"),
    all(env, "SELECT target_type, target_id, name FROM files"),
    all(env, "SELECT * FROM comments WHERE created_at > ? ORDER BY id", since),
  ]);
  const filesOf = (t, id) => files.filter((f) => f.target_type === t && f.target_id === String(id)).map((f) => f.name);
  return {
    format: "creyo-export/1",
    exported_at: now(),
    since: since || null,
    changes: changes.map((c) => ({ at: c.at, who: nm(c.who), kind: c.kind, ref: c.ref, summary: c.summary })),
    new_comments: comments.map((c) => ({ at: c.created_at, who: nm(c.created_by), on: `${c.target_type}:${c.target_id}`, text: c.text })),
    open_feedback: fbOpen.map((f) => ({
      id: f.id,
      at: f.created_at,
      from: nm(f.created_by),
      for: f.for_owner ? nm(f.for_owner) : null,
      text: f.text,
      screenshots: filesOf("feedback", f.id),
    })),
    items: items.map((i) => ({ ...i, owner: i.owner ? nm(i.owner) : null, screenshots: filesOf("item", i.id) })),
  };
}

async function applyUpdate(env, user, body, dryRun) {
  const payload = body?.payload;
  const v = validateUpdate(payload, { people: people(env) });
  if (!v.ok) return fail(400, "invalid_update", v.errors);
  const current = await snapshot(env);
  const knownFeedback = new Set((await all(env, "SELECT id FROM feedback")).map((r) => r.id));
  const summary = describeUpdate(v.update, current, knownFeedback, names(env));
  if (summary.errors.length) return fail(400, "invalid_update", summary.errors);
  if (dryRun) return json({ ok: true, summary: summary.lines });

  const by = `claude (via ${user.key})`;
  const t = now();
  const u = v.update;
  const stmts = [
    env.DB.prepare("INSERT INTO versions (created_at, created_by, note, snapshot) VALUES (?,?,?,?)").bind(
      t, user.key, `voor: ${u.note || "update van Claude"}`, JSON.stringify(current),
    ),
  ];
  if (u.meta) for (const [k, val] of Object.entries(u.meta)) stmts.push(env.DB.prepare("INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, val));
  const oldPhases = new Map(current.phases.map((p) => [p.id, p]));
  for (const p of u.phases) {
    const old = oldPhases.get(p.id) || { note: "", sort: 0 };
    stmts.push(
      env.DB.prepare("INSERT INTO phases (id, name, note, sort) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, note = excluded.note, sort = excluded.sort").bind(
        p.id, p.name, p.note ?? old.note, p.sort ?? old.sort,
      ),
    );
  }
  const existing = new Map(current.items.map((i) => [i.id, i]));
  for (const it of u.items) {
    const old = existing.get(it.id);
    const merged = { phase_id: null, owner: null, status: "open", priority: 2, why: "", next: "", waits_for: "", sort: 0, ...(old || {}), ...it };
    stmts.push(
      env.DB.prepare(
        `INSERT INTO items (id, phase_id, title, owner, status, priority, why, next, waits_for, sort, updated_at, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET phase_id=excluded.phase_id, title=excluded.title, owner=excluded.owner, status=excluded.status,
         priority=excluded.priority, why=excluded.why, next=excluded.next, waits_for=excluded.waits_for, sort=excluded.sort,
         updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
      ).bind(merged.id, merged.phase_id, merged.title, merged.owner, merged.status, merged.priority, merged.why, merged.next, merged.waits_for, merged.sort, t, by),
    );
  }
  for (const id of u.remove_items) stmts.push(env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id));
  for (const l of u.log) {
    if (l.id === undefined) {
      stmts.push(
        env.DB.prepare("INSERT INTO log (date, title, what, why, result, item_ids, phase_ids, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)").bind(
          l.date, l.title, l.what, l.why, l.result, l.item_ids, l.phase_ids, t, by,
        ),
      );
    } else {
      const cols = ["date", "title", "what", "why", "result", "item_ids", "phase_ids"].filter((k) => l[k] !== undefined);
      stmts.push(env.DB.prepare(`UPDATE log SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...cols.map((c) => l[c]), l.id));
    }
  }
  for (const h of summary.history) stmts.push(historyRow(env, h.item_id, t, by, h.what, h.reason));
  for (const f of u.feedback) stmts.push(env.DB.prepare("UPDATE feedback SET status = ?, item_id = COALESCE(?, item_id) WHERE id = ?").bind(f.status, f.item_id ?? null, f.id));
  for (const c of u.comments)
    stmts.push(env.DB.prepare("INSERT INTO comments (target_type, target_id, text, created_at, created_by) VALUES (?,?,?,?,?)").bind(c.target_type, c.target_id, c.text, t, "claude"));
  stmts.push(change(env, user.key, "update_applied", "plan", u.note || "update van Claude"));
  await env.DB.batch(stmts);
  return json({ ok: true, summary: summary.lines });
}

async function restoreVersion(env, user, id) {
  const v = await first(env, "SELECT * FROM versions WHERE id = ?", id);
  if (!v) return fail(404, "not_found");
  const snap = JSON.parse(v.snapshot);
  const current = await snapshot(env);
  const t = now();
  const nms = names(env);
  const before = new Map(current.items.map((i) => [i.id, i]));
  const hist = [];
  for (const it of snap.items || []) {
    const old = before.get(it.id);
    const what = old ? describeItemChange(old, it, nms).join(", ") : "Taak teruggezet";
    if (what) hist.push(historyRow(env, it.id, t, user.key, what, `Vorige versie teruggezet (versie ${id})`));
    before.delete(it.id);
  }
  for (const gone of before.keys()) hist.push(historyRow(env, gone, t, user.key, "Taak weggehaald", `Vorige versie teruggezet (versie ${id})`));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO versions (created_at, created_by, note, snapshot) VALUES (?,?,?,?)").bind(t, user.key, `voor terugzetten naar versie ${id}`, JSON.stringify(current)),
    ...restoreStatements(env, snap),
    ...hist,
    change(env, user.key, "version_restored", id, `teruggezet naar versie ${id}`),
  ]);
  return json({ ok: true });
}

async function route(request, env, user) {
  const url = new URL(request.url);
  const p = url.pathname;
  const m = request.method;

  if (p === "/api/state" && m === "GET") return json(await getState(env, user));

  let r;
  if ((r = p.match(/^\/api\/items\/([A-Za-z0-9_-]{1,20})$/)) && m === "PATCH") return patchItem(env, user, r[1], await readBody(request));
  if (p === "/api/feedback" && m === "POST") return postFeedback(env, user, await readBody(request));
  if ((r = p.match(/^\/api\/feedback\/(\d+)$/)) && m === "PATCH") return patchFeedback(env, user, Number(r[1]), await readBody(request));
  if (p === "/api/comments" && m === "POST") return postComment(env, user, await readBody(request));
  if (p === "/api/files" && m === "POST") return postFile(env, user, request, url);
  if ((r = p.match(/^\/api\/files\/([0-9a-f-]{36})$/))) {
    if (m === "GET") return getFile(env, r[1]);
    if (m === "DELETE") return deleteFile(env, user, r[1]);
  }

  // Admin only from here.
  if (p.startsWith("/api/admin/") && !user.admin) return fail(403, "admin_only");
  if (p === "/api/admin/export" && m === "GET") return json(await exportForClaude(env));
  if (p === "/api/admin/export/done" && m === "POST") {
    const at = cleanText((await readBody(request))?.exported_at, 40);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(at)) return fail(400, "invalid_time");
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('last_export_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(at).run();
    return json({ ok: true });
  }
  if (p === "/api/admin/check" && m === "POST") return applyUpdate(env, user, await readBody(request), true);
  if (p === "/api/admin/apply" && m === "POST") return applyUpdate(env, user, await readBody(request), false);
  if (p === "/api/admin/versions" && m === "GET")
    return json({ versions: await all(env, "SELECT id, created_at, created_by, note FROM versions ORDER BY id DESC LIMIT 50") });
  if ((r = p.match(/^\/api\/admin\/versions\/(\d+)\/restore$/)) && m === "POST") return restoreVersion(env, user, Number(r[1]));

  return fail(404, "not_found");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let user;
    try {
      user = await currentUser(request, env);
    } catch {
      user = null;
    }
    if (!user) {
      const isApi = url.pathname.startsWith("/api/");
      return isApi
        ? fail(401, "not_signed_in")
        : secure(new Response("Geen toegang. Log in via Cloudflare Access met een uitgenodigd e-mailadres.", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
    }

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") {
        // Block cross-site requests: same origin and our own header are required.
        const origin = request.headers.get("Origin");
        if (origin && origin !== url.origin) return fail(403, "bad_origin");
        if (request.headers.get("X-Creyo") !== "1") return fail(403, "missing_header");
      }
      try {
        return await route(request, env, user);
      } catch (e) {
        console.error("api_error", url.pathname, e && e.message);
        return fail(500, "server_error");
      }
    }

    const res = await env.ASSETS.fetch(request);
    const ct = res.headers.get("Content-Type") || "";
    return secure(res, { html: ct.includes("text/html") });
  },
};
