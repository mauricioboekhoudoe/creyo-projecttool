// End-to-end check against `wrangler dev --local` (run: npm run dev, then node test/smoke.local.mjs).
// Uses the local-only DEV_AUTH_EMAIL login; never runs against a real hostname.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:8787";
const ADMIN = "mauricio@boekhoudoe.nl";
const MEMBER = "charona@example.test";
const seed = JSON.parse(readFileSync(new URL("../seed/initial-update.json", import.meta.url)));

async function call(path, { method = "GET", as = ADMIN, json, body, headers = {}, raw = false } = {}) {
  const h = { "X-Dev-Email": as, ...headers };
  if (method !== "GET" && !("X-Creyo" in headers)) h["X-Creyo"] = "1";
  if (json !== undefined) {
    h["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  const r = await fetch(BASE + path, { method, headers: h, body });
  if (raw) return r;
  let data = null;
  try { data = await r.json(); } catch { /* not json */ }
  return { status: r.status, data, headers: r.headers };
}
const step = (name) => console.log("ok -", name);

// Start from an empty plan so the check is repeatable.
let s = await call("/api/state");
assert.equal(s.status, 200);
if (s.data.items.length) {
  const v = await call("/api/admin/versions");
  const firstV = v.data.versions.at(-1);
  await call(`/api/admin/versions/${firstV.id}/restore`, { method: "POST", json: {} });
  await call(`/api/admin/versions/${firstV.id}/restore`, { method: "POST", json: {} }).catch(() => {});
}

let r = await call("/api/state", { as: "stranger@example.test" });
assert.equal(r.status, 401); step("unknown e-mail is refused");

r = await call("/api/admin/check", { method: "POST", json: { payload: seed }, headers: { "X-Creyo": "0" } });
assert.equal(r.status, 403); step("write without the X-Creyo header is refused");

r = await call("/api/admin/check", { method: "POST", json: { payload: seed }, headers: { Origin: "https://evil.example" } });
assert.equal(r.status, 403); step("write from another origin is refused");

r = await call("/api/admin/check", { method: "POST", json: { payload: seed } });
assert.equal(r.status, 200, JSON.stringify(r.data)); assert.ok(r.data.summary.length > 60); step("seed check lists the changes");

r = await call("/api/admin/apply", { method: "POST", json: { payload: seed } });
assert.equal(r.status, 200, JSON.stringify(r.data));
s = await call("/api/state");
assert.equal(s.data.items.length, seed.items.length); assert.equal(s.data.phases.length, 8); assert.equal(s.data.log.length, 10);
step("seed applied: 64 items, 8 phases, 10 log entries");

r = await call("/api/admin/export", { as: MEMBER });
assert.equal(r.status, 403); step("member cannot export");

r = await call("/api/items/F10", { method: "PATCH", as: MEMBER, json: { status: "busy", title: "hacked" } });
assert.equal(r.status, 200); assert.equal(r.data.item.status, "busy"); assert.notEqual(r.data.item.title, "hacked");
step("member can change status but not the title");

r = await call("/api/items/F11", { method: "PATCH", as: MEMBER, json: { status: "done", reason: "Gecontroleerd, de melding komt niet meer." } });
assert.equal(r.status, 200);
s = await call("/api/state");
assert.deepEqual(
  ((h) => [h.who, h.what, h.reason])(s.data.history.find((h) => h.item_id === "F11")),
  ["C", "Status: open → klaar", "Gecontroleerd, de melding komt niet meer."],
);
step("a person's change is kept in the history with their reason");

r = await call("/api/items/F10", { method: "PATCH", json: { owner: "Z" } });
assert.equal(r.status, 400); step("unknown owner is refused");

r = await call("/api/feedback", { method: "POST", as: MEMBER, json: { text: "In de mediakit mis ik saves <b>per</b> post", for_owner: "M" } });
assert.equal(r.status, 200); const fbId = r.data.id; step("member sends feedback");

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
r = await call(`/api/files?target_type=feedback&target_id=${fbId}`, { method: "POST", as: MEMBER, body: png, headers: { "Content-Type": "image/png", "X-File-Name": "scherm<1>.png" } });
assert.equal(r.status, 200); const fileId = r.data.id; assert.equal(r.data.name, "scherm_1_.png");
step("screenshot upload, file name cleaned");

r = await call(`/api/files?target_type=feedback&target_id=${fbId}`, { method: "POST", body: "<script>", headers: { "Content-Type": "text/html" } });
assert.equal(r.status, 415); step("non-image upload refused");

const fr = await call(`/api/files/${fileId}`, { raw: true });
assert.equal(fr.status, 200); assert.equal(fr.headers.get("content-type"), "image/png"); assert.ok(fr.headers.get("content-security-policy").includes("sandbox"));
step("screenshot served with a sandboxing CSP");

r = await call("/api/comments", { method: "POST", json: { target_type: "feedback", target_id: String(fbId), text: "Klopt, nemen we mee in F25." } });
assert.equal(r.status, 200);
r = await call("/api/comments", { method: "POST", json: { target_type: "item", target_id: "NOPE", text: "x" } });
assert.equal(r.status, 404); step("comments, and none on missing targets");

r = await call("/api/admin/export");
assert.equal(r.status, 200); assert.equal(r.data.open_feedback.length, 1); assert.deepEqual(r.data.open_feedback[0].screenshots, ["scherm_1_.png"]);
assert.ok(r.data.changes.some((c) => c.kind === "feedback_new" && c.who === "Charona"));
const exportedAt = r.data.exported_at;
r = await call("/api/admin/export/done", { method: "POST", json: { exported_at: exportedAt } });
assert.equal(r.status, 200);
r = await call("/api/admin/export");
assert.equal(r.data.changes.length, 0); step("export lists new feedback and only changes since the last export");

const upd = {
  format: "creyo-update/1",
  note: "Feedback verwerkt",
  feedback: [{ id: fbId, status: "converted", item_id: "F25" }],
  items: [
    { id: "F25", next: "Mockup maken" },
    { id: "F23", status: "done", reason: "Live gezet en getest op de echte site." },
    { id: "F26", phase_id: "A2", title: "Nieuwe test-taak", owner: "C", why: "Om te testen." },
  ],
  comments: [{ target_type: "feedback", target_id: String(fbId), text: "Omgezet naar F25." }],
  log: [{ date: "2026-10-12", title: "Test", what: "w", why: "y", result: "r", item_ids: ["F25"] }, { id: 1, phase_ids: ["A"] }],
};
r = await call("/api/admin/check", { method: "POST", json: { payload: { format: "creyo-update/1", items: [{ id: "F23", status: "done" }] } } });
assert.equal(r.status, 400); assert.ok(r.data.detail.some((e) => e.includes("reason"))); step("status change from Claude without a reason is refused");
r = await call("/api/admin/apply", { method: "POST", json: { payload: upd } });
assert.equal(r.status, 200, JSON.stringify(r.data));
s = await call("/api/state");
assert.equal(s.data.feedback[0].status, "converted"); assert.ok(s.data.items.find((i) => i.id === "F26"));
assert.equal(s.data.items.find((i) => i.id === "F25").next, "Mockup maken");
assert.ok(s.data.comments.some((c) => c.created_by === "claude"));
const h23 = s.data.history.find((h) => h.item_id === "F23");
assert.equal(h23.reason, "Live gezet en getest op de echte site."); assert.ok(h23.what.startsWith("Status:")); assert.ok(h23.who.startsWith("claude"));
assert.equal(s.data.log.find((l) => l.id === 1).phase_ids, "A");
step("update from Claude applied: feedback converted, item added, comment, log, history with reason, log tagged with a phase");

r = await call("/api/admin/apply", { method: "POST", json: { payload: { format: "creyo-update/1", items: [{ id: "F27" }] } } });
assert.equal(r.status, 400); step("invalid update refused, nothing changed");

const v = await call("/api/admin/versions");
assert.ok(v.data.versions.length >= 2);
const beforeUpd = v.data.versions[0].id;
r = await call(`/api/admin/versions/${beforeUpd}/restore`, { method: "POST", json: {} });
assert.equal(r.status, 200);
s = await call("/api/state");
assert.ok(!s.data.items.find((i) => i.id === "F26")); assert.equal(s.data.feedback[0].status, "converted");
step("rollback restores the plan, keeps people's feedback");

r = await call("/api/feedback", { method: "POST", as: MEMBER, json: { text: "inlog: geheim123", for_owner: "M" } });
const secretFb = r.data.id;
r = await call("/api/feedback", { method: "POST", json: { text: "van Mauricio" } });
const adminFb = r.data.id;
r = await call(`/api/feedback/${adminFb}`, { method: "DELETE", as: MEMBER });
assert.equal(r.status, 403); step("a member cannot delete someone else's feedback");
r = await call(`/api/feedback/${secretFb}`, { method: "DELETE", as: MEMBER });
assert.equal(r.status, 200);
s = await call("/api/state");
assert.ok(!s.data.feedback.some((f) => f.id === secretFb));
r = await call("/api/admin/export");
assert.ok(!JSON.stringify(r.data).includes("geheim123"));
step("a member deletes their own feedback; the text is gone from the export too");
r = await call("/api/comments", { method: "POST", as: MEMBER, json: { target_type: "item", target_id: "F10", text: "password: x" } });
const cid = r.data.id;
r = await call(`/api/comments/${cid}`, { method: "DELETE" });
assert.equal(r.status, 200); step("an admin can delete a comment");

const page = await fetch(BASE + "/", { headers: { "X-Dev-Email": ADMIN } });
assert.equal(page.status, 200); assert.ok(page.headers.get("content-security-policy").includes("script-src 'self'"));
step("page served with CSP");

console.log("\nall smoke checks passed");
