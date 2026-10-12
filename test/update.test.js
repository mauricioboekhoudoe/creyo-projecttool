import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateUpdate, describeUpdate } from "../src/update.js";

const people = { M: {}, C: {} };
const empty = { phases: [], items: [], log: [], meta: [] };

test("the initial plan is a valid update", () => {
  const seed = JSON.parse(readFileSync(new URL("../seed/initial-update.json", import.meta.url)));
  const v = validateUpdate(seed, { people });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const d = describeUpdate(v.update, empty, new Set());
  assert.deepEqual(d.errors, []);
  assert.ok(d.lines.some((l) => l.startsWith("Nieuw: F25")));
});

test("rejects a wrong format and unknown fields", () => {
  const v = validateUpdate({ format: "x", hack: 1 }, { people });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("format")));
  assert.ok(v.errors.some((e) => e.includes("hack")));
});

test("rejects unknown owners, statuses and item fields", () => {
  const v = validateUpdate(
    { format: "creyo-update/1", items: [{ id: "F1", owner: "Z" }, { id: "F2", status: "gone" }, { id: "F3", evil: "<script>" }] },
    { people },
  );
  assert.equal(v.ok, false);
  assert.equal(v.errors.length, 3);
});

test("a new item needs a title and an existing phase", () => {
  const v = validateUpdate({ format: "creyo-update/1", items: [{ id: "F99", phase_id: "Q" }] }, { people });
  assert.equal(v.ok, true);
  const d = describeUpdate(v.update, empty, new Set());
  assert.ok(d.errors.some((e) => e.includes("titel")));
  assert.ok(d.errors.some((e) => e.includes("fase Q")));
});

test("describes changes to existing items in Dutch", () => {
  const current = {
    phases: [{ id: "A", name: "x" }],
    items: [{ id: "F10", phase_id: "A", title: "t", owner: "M", status: "open", priority: 1, why: "", next: "", waits_for: "" }],
    log: [],
    meta: [],
  };
  const v = validateUpdate({ format: "creyo-update/1", items: [{ id: "F10", status: "done", owner: "C", reason: "Getest op de echte site, het werkt." }] }, { people });
  const d = describeUpdate(v.update, current, new Set(), { M: "Mauricio", C: "Charona" });
  assert.deepEqual(d.errors, []);
  assert.equal(d.lines[0], "F10: Status: open → klaar, Toegewezen aan: Mauricio → Charona. Waarom: Getest op de echte site, het werkt.");
  assert.deepEqual(d.history, [{ item_id: "F10", what: "Status: open → klaar, Toegewezen aan: Mauricio → Charona", reason: "Getest op de echte site, het werkt." }]);
});

test("a status change without a plain-language reason is refused", () => {
  const current = { phases: [{ id: "A", name: "x" }], items: [{ id: "F10", phase_id: "A", title: "t", owner: "M", status: "open", priority: 1, why: "", next: "", waits_for: "" }], log: [], meta: [] };
  const v = validateUpdate({ format: "creyo-update/1", items: [{ id: "F10", status: "done" }] }, { people });
  const d = describeUpdate(v.update, current, new Set());
  assert.ok(d.errors.some((e) => e.includes("reason")));
  const v2 = validateUpdate({ format: "creyo-update/1", items: [{ id: "F10", next: "Iets anders" }] }, { people });
  assert.deepEqual(describeUpdate(v2.update, current, new Set()).errors, []);
});

test("a new item needs a plain-language why", () => {
  const v = validateUpdate({ format: "creyo-update/1", items: [{ id: "F99", title: "Nieuw" }] }, { people });
  const d = describeUpdate(v.update, empty, new Set());
  assert.ok(d.errors.some((e) => e.includes('"why"')));
});

test("log entries can carry phases and be corrected by id", () => {
  const current = { phases: [{ id: "A", name: "x" }], items: [], log: [{ id: 3, title: "Oud" }], meta: [] };
  const v = validateUpdate(
    { format: "creyo-update/1", log: [{ id: 3, phase_ids: ["A"] }, { date: "2026-10-12", title: "Nieuw", phase_ids: ["A"] }, { id: 9, title: "x" }, { date: "2026-10-12", title: "y", phase_ids: ["Q"] }] },
    { people },
  );
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.update.log[0].phase_ids, "A");
  assert.equal(v.update.log[0].title, undefined);
  const d = describeUpdate(v.update, current, new Set());
  assert.ok(d.lines.some((l) => l.includes("regel 3 bijgewerkt")));
  assert.ok(d.errors.some((e) => e.includes("regel 9")));
  assert.ok(d.errors.some((e) => e.includes("fase Q")));
});

test("feedback and comments must point to something that exists", () => {
  const v = validateUpdate(
    { format: "creyo-update/1", feedback: [{ id: 7, status: "converted", item_id: "F25" }], comments: [{ target_type: "item", target_id: "F404", text: "hi" }] },
    { people },
  );
  assert.equal(v.ok, true);
  const d = describeUpdate(v.update, empty, new Set([1]));
  assert.ok(d.errors.some((e) => e.includes("Feedback 7")));
  assert.ok(d.errors.some((e) => e.includes("F404")));
});

test("limits text length", () => {
  const v = validateUpdate({ format: "creyo-update/1", items: [{ id: "F1", why: "x".repeat(2001) }] }, { people });
  assert.equal(v.ok, false);
});
