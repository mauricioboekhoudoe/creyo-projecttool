// Validation and preview of an update block from Claude ("creyo-update/1").
// Pure functions, so they are tested without a Worker runtime.

const STATUS = ["open", "busy", "wait", "done"];
const STATUS_NL = { open: "open", busy: "bezig", wait: "wacht", done: "klaar" };
const FB_STATUS = ["new", "converted", "closed"];
const ITEM_FIELDS = ["id", "phase_id", "title", "owner", "status", "priority", "why", "next", "waits_for", "sort"];
const ITEM_ID = /^[A-Z][A-Z0-9-]{0,9}$/;
const PHASE_ID = /^[A-Z][A-Z0-9]{0,5}$/;
const META_KEYS = ["goal", "headline"];

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const str = (v, max) => typeof v === "string" && v.length <= max;
const clean = (v) => String(v).replace(/\u0000/g, "").trim();

export function validateUpdate(payload, { people }) {
  const errors = [];
  const e = (m) => errors.length < 50 && errors.push(m);
  if (!isObj(payload)) return { ok: false, errors: ["Het blok is geen geldig JSON-object."] };
  if (payload.format !== "creyo-update/1") e('Het veld "format" moet "creyo-update/1" zijn.');
  const allowedTop = ["format", "note", "meta", "phases", "items", "remove_items", "log", "feedback", "comments"];
  for (const k of Object.keys(payload)) if (!allowedTop.includes(k)) e(`Onbekend veld "${k}".`);

  const out = { note: "", meta: null, phases: [], items: [], remove_items: [], log: [], feedback: [], comments: [] };
  if (payload.note !== undefined) str(payload.note, 200) ? (out.note = clean(payload.note)) : e('"note" moet tekst zijn van maximaal 200 tekens.');

  if (payload.meta !== undefined) {
    if (!isObj(payload.meta)) e('"meta" moet een object zijn.');
    else {
      out.meta = {};
      for (const [k, v] of Object.entries(payload.meta)) {
        if (!META_KEYS.includes(k)) e(`meta: onbekend veld "${k}".`);
        else if (!str(v, 1000)) e(`meta.${k} moet tekst zijn van maximaal 1000 tekens.`);
        else out.meta[k] = clean(v);
      }
    }
  }

  const arr = (k, max) => {
    const v = payload[k];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      e(`"${k}" moet een lijst zijn.`);
      return [];
    }
    if (v.length > max) e(`"${k}" heeft meer dan ${max} regels.`);
    return v.slice(0, max);
  };

  arr("phases", 50).forEach((p, n) => {
    if (!isObj(p) || !PHASE_ID.test(p.id ?? "")) return e(`phases[${n}]: ongeldig id.`);
    if (!str(p.name, 120) || !clean(p.name)) return e(`phases[${n}] (${p.id}): naam ontbreekt of is te lang.`);
    if (p.note !== undefined && !str(p.note, 500)) return e(`phases[${n}] (${p.id}): note te lang.`);
    if (p.sort !== undefined && !Number.isInteger(p.sort)) return e(`phases[${n}] (${p.id}): sort moet een geheel getal zijn.`);
    out.phases.push({ id: p.id, name: clean(p.name), note: p.note !== undefined ? clean(p.note) : undefined, sort: p.sort });
  });

  const seen = new Set();
  arr("items", 300).forEach((it, n) => {
    if (!isObj(it) || !ITEM_ID.test(it.id ?? "")) return e(`items[${n}]: ongeldig id.`);
    if (seen.has(it.id)) return e(`items: ${it.id} staat er twee keer in.`);
    seen.add(it.id);
    const o = { id: it.id };
    for (const k of Object.keys(it)) if (!ITEM_FIELDS.includes(k)) e(`${it.id}: onbekend veld "${k}".`);
    if (it.phase_id !== undefined) {
      if (it.phase_id !== null && !PHASE_ID.test(it.phase_id)) e(`${it.id}: ongeldige fase.`);
      else o.phase_id = it.phase_id;
    }
    if (it.title !== undefined) {
      if (!str(it.title, 200) || !clean(it.title)) e(`${it.id}: titel ontbreekt of is langer dan 200 tekens.`);
      else o.title = clean(it.title);
    }
    if (it.owner !== undefined) {
      if (it.owner !== null && !people[it.owner]) e(`${it.id}: onbekende eigenaar "${it.owner}".`);
      else o.owner = it.owner;
    }
    if (it.status !== undefined) STATUS.includes(it.status) ? (o.status = it.status) : e(`${it.id}: status moet open, busy, wait of done zijn.`);
    if (it.priority !== undefined) [1, 2, 3].includes(it.priority) ? (o.priority = it.priority) : e(`${it.id}: prioriteit moet 1, 2 of 3 zijn.`);
    for (const k of ["why", "next", "waits_for"])
      if (it[k] !== undefined) str(it[k], 2000) ? (o[k] = clean(it[k])) : e(`${it.id}: ${k} moet tekst zijn van maximaal 2000 tekens.`);
    if (it.sort !== undefined) Number.isInteger(it.sort) ? (o.sort = it.sort) : e(`${it.id}: sort moet een geheel getal zijn.`);
    out.items.push(o);
  });

  arr("remove_items", 100).forEach((id, n) => (ITEM_ID.test(id ?? "") ? out.remove_items.push(id) : e(`remove_items[${n}]: ongeldig id.`)));

  arr("log", 50).forEach((l, n) => {
    if (!isObj(l)) return e(`log[${n}]: geen object.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date ?? "")) return e(`log[${n}]: datum moet JJJJ-MM-DD zijn.`);
    if (!str(l.title, 200) || !clean(l.title)) return e(`log[${n}]: titel ontbreekt of is te lang.`);
    for (const k of ["what", "why", "result"]) if (l[k] !== undefined && !str(l[k], 4000)) return e(`log[${n}]: ${k} te lang.`);
    const ids = l.item_ids === undefined ? [] : l.item_ids;
    if (!Array.isArray(ids) || !ids.every((x) => ITEM_ID.test(x))) return e(`log[${n}]: item_ids moet een lijst met id's zijn.`);
    out.log.push({ date: l.date, title: clean(l.title), what: clean(l.what ?? ""), why: clean(l.why ?? ""), result: clean(l.result ?? ""), item_ids: ids.join(",") });
  });

  arr("feedback", 100).forEach((f, n) => {
    if (!isObj(f) || !Number.isInteger(f.id)) return e(`feedback[${n}]: ongeldig id.`);
    if (!FB_STATUS.includes(f.status)) return e(`feedback ${f.id}: status moet new, converted of closed zijn.`);
    if (f.item_id !== undefined && f.item_id !== null && !ITEM_ID.test(f.item_id)) return e(`feedback ${f.id}: ongeldig item_id.`);
    out.feedback.push({ id: f.id, status: f.status, item_id: f.item_id ?? null });
  });

  arr("comments", 50).forEach((c, n) => {
    if (!isObj(c) || !["item", "feedback"].includes(c.target_type)) return e(`comments[${n}]: target_type moet item of feedback zijn.`);
    if (!str(String(c.target_id ?? ""), 20) || c.target_id === undefined) return e(`comments[${n}]: target_id ontbreekt.`);
    if (!str(c.text, 4000) || !clean(c.text)) return e(`comments[${n}]: tekst ontbreekt of is te lang.`);
    out.comments.push({ target_type: c.target_type, target_id: String(c.target_id), text: clean(c.text) });
  });

  return errors.length ? { ok: false, errors } : { ok: true, update: out };
}

// Checks the update against the current content and lists what will change, in Dutch.
export function describeUpdate(u, current, knownFeedbackIds) {
  const errors = [];
  const lines = [];
  const phases = new Set([...current.phases.map((p) => p.id), ...u.phases.map((p) => p.id)]);
  const items = new Map(current.items.map((i) => [i.id, i]));
  const afterItems = new Set([...items.keys(), ...u.items.map((i) => i.id)]);

  if (u.meta) for (const k of Object.keys(u.meta)) lines.push(`Kop "${k}" bijgewerkt`);
  for (const p of u.phases) lines.push(current.phases.some((x) => x.id === p.id) ? `Fase ${p.id} bijgewerkt` : `Nieuwe fase ${p.id}: ${p.name}`);

  for (const it of u.items) {
    const old = items.get(it.id);
    if (it.phase_id && !phases.has(it.phase_id)) errors.push(`${it.id}: fase ${it.phase_id} bestaat niet.`);
    if (!old) {
      if (!it.title) errors.push(`${it.id} is nieuw en heeft een titel nodig.`);
      lines.push(`Nieuw: ${it.id} ${it.title || ""}`.trim());
      continue;
    }
    const diffs = [];
    if (it.status && it.status !== old.status) diffs.push(`status ${STATUS_NL[old.status]} → ${STATUS_NL[it.status]}`);
    if (it.owner !== undefined && it.owner !== old.owner) diffs.push(`eigenaar ${old.owner || "-"} → ${it.owner || "-"}`);
    if (it.priority && it.priority !== old.priority) diffs.push(`prioriteit ${old.priority} → ${it.priority}`);
    for (const k of ["title", "why", "next", "waits_for", "phase_id"]) if (it[k] !== undefined && it[k] !== old[k]) diffs.push(`${k} gewijzigd`);
    if (diffs.length) lines.push(`${it.id}: ${diffs.join(", ")}`);
  }
  for (const id of u.remove_items) {
    if (!items.has(id)) errors.push(`Verwijderen: ${id} bestaat niet.`);
    else lines.push(`Verwijderd: ${id}`);
  }
  if (u.log.length) lines.push(`Logboek: ${u.log.length} nieuwe ${u.log.length === 1 ? "regel" : "regels"}`);
  for (const f of u.feedback) {
    if (!knownFeedbackIds.has(f.id)) errors.push(`Feedback ${f.id} bestaat niet.`);
    else lines.push(`Feedback ${f.id}: ${f.status}${f.item_id ? ` (${f.item_id})` : ""}`);
  }
  for (const c of u.comments) {
    const ok = c.target_type === "item" ? afterItems.has(c.target_id) : knownFeedbackIds.has(Number(c.target_id));
    if (!ok) errors.push(`Reactie op ${c.target_type} ${c.target_id}: bestaat niet.`);
    else lines.push(`Reactie van Claude op ${c.target_type === "item" ? c.target_id : `feedback ${c.target_id}`}`);
  }
  if (!lines.length && !errors.length) lines.push("Geen wijzigingen.");
  return { lines, errors };
}
