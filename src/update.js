// Validation and preview of an update block from Claude ("creyo-update/1").
// Pure functions, so they are tested without a Worker runtime.

const STATUS = ["open", "busy", "wait", "done"];
const STATUS_NL = { open: "open", busy: "bezig", wait: "wacht", done: "klaar" };
const FB_STATUS = ["new", "converted", "closed"];
const ITEM_FIELDS = ["id", "phase_id", "title", "owner", "status", "priority", "why", "next", "waits_for", "sort", "reason"];
const PRIO_NL = { 1: "hoog", 2: "normaal", 3: "laag" };
const FIELD_NL = { title: "Titel", why: "Waarom", next: "Volgende stap", waits_for: "Wacht op", phase_id: "Fase" };
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
    if (it.reason !== undefined) str(it.reason, 500) ? (o.reason = clean(it.reason)) : e(`${it.id}: reason moet tekst zijn van maximaal 500 tekens.`);
    out.items.push(o);
  });

  arr("remove_items", 100).forEach((id, n) => (ITEM_ID.test(id ?? "") ? out.remove_items.push(id) : e(`remove_items[${n}]: ongeldig id.`)));

  arr("log", 50).forEach((l, n) => {
    if (!isObj(l)) return e(`log[${n}]: geen object.`);
    const isEdit = l.id !== undefined;
    if (isEdit && !Number.isInteger(l.id)) return e(`log[${n}]: id moet een geheel getal zijn.`);
    for (const k of Object.keys(l)) if (!["id", "date", "title", "what", "why", "result", "item_ids", "phase_ids"].includes(k)) return e(`log[${n}]: onbekend veld "${k}".`);
    const o = isEdit ? { id: l.id } : {};
    if (l.date !== undefined || !isEdit) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date ?? "")) return e(`log[${n}]: datum moet JJJJ-MM-DD zijn.`);
      o.date = l.date;
    }
    if (l.title !== undefined || !isEdit) {
      if (!str(l.title, 200) || !clean(l.title)) return e(`log[${n}]: titel ontbreekt of is te lang.`);
      o.title = clean(l.title);
    }
    for (const k of ["what", "why", "result"]) {
      if (l[k] !== undefined && !str(l[k], 4000)) return e(`log[${n}]: ${k} te lang.`);
      if (l[k] !== undefined || !isEdit) o[k] = clean(l[k] ?? "");
    }
    for (const [k, re] of [["item_ids", ITEM_ID], ["phase_ids", PHASE_ID]]) {
      if (l[k] === undefined) {
        if (!isEdit) o[k] = "";
        continue;
      }
      if (!Array.isArray(l[k]) || !l[k].every((x) => re.test(x))) return e(`log[${n}]: ${k} moet een lijst met id's zijn.`);
      o[k] = l[k].join(",");
    }
    if (isEdit && Object.keys(o).length === 1) return e(`log[${n}]: regel ${l.id} heeft niets om bij te werken.`);
    out.log.push(o);
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

// Plain-Dutch description of what changes on one item, used for its history.
export function describeItemChange(old, patch, names = {}) {
  const nm = (k) => (k ? names[k] || k : "niemand");
  const out = [];
  if (patch.status !== undefined && patch.status !== old.status) out.push(`Status: ${STATUS_NL[old.status] || old.status} → ${STATUS_NL[patch.status] || patch.status}`);
  if (patch.owner !== undefined && (patch.owner || null) !== (old.owner || null)) out.push(`Toegewezen aan: ${nm(old.owner)} → ${nm(patch.owner)}`);
  if (patch.priority !== undefined && patch.priority !== old.priority) out.push(`Prioriteit: ${PRIO_NL[old.priority] || old.priority} → ${PRIO_NL[patch.priority] || patch.priority}`);
  if (patch.phase_id !== undefined && (patch.phase_id || null) !== (old.phase_id || null)) out.push(`Fase: ${old.phase_id || "-"} → ${patch.phase_id || "-"}`);
  for (const k of ["title", "why", "next", "waits_for"]) if (patch[k] !== undefined && patch[k] !== (old[k] ?? "")) out.push(`${FIELD_NL[k]} aangepast`);
  return out;
}

// Checks the update against the current content and lists what will change, in Dutch.
// Also returns one history entry per touched item, with the reason in plain language.
export function describeUpdate(u, current, knownFeedbackIds, names = {}) {
  const errors = [];
  const lines = [];
  const history = [];
  const phases = new Set([...current.phases.map((p) => p.id), ...u.phases.map((p) => p.id)]);
  const items = new Map(current.items.map((i) => [i.id, i]));
  const afterItems = new Set([...items.keys(), ...u.items.map((i) => i.id)]);
  const logIds = new Set((current.log || []).map((l) => l.id));

  if (u.meta) for (const k of Object.keys(u.meta)) lines.push(`Kop "${k}" bijgewerkt`);
  for (const p of u.phases) lines.push(current.phases.some((x) => x.id === p.id) ? `Fase ${p.id} bijgewerkt` : `Nieuwe fase ${p.id}: ${p.name}`);

  for (const it of u.items) {
    const old = items.get(it.id);
    if (it.phase_id && !phases.has(it.phase_id)) errors.push(`${it.id}: fase ${it.phase_id} bestaat niet.`);
    if (!old) {
      if (!it.title) errors.push(`${it.id} is nieuw en heeft een titel nodig.`);
      if (!it.why) errors.push(`${it.id} is nieuw: schrijf in "why" in gewone taal waarom deze taak er is.`);
      lines.push(`Nieuw: ${it.id} ${it.title || ""}`.trim());
      history.push({ item_id: it.id, what: "Nieuwe taak", reason: it.reason || it.why || "" });
      continue;
    }
    const diffs = describeItemChange(old, it, names);
    const needsReason = diffs.some((d) => /^(Status|Toegewezen aan|Prioriteit|Fase):/.test(d));
    if (needsReason && !it.reason) errors.push(`${it.id}: ${diffs.filter((d) => /:/.test(d))[0]}. Schrijf in "reason" in gewone taal waarom.`);
    if (diffs.length) {
      lines.push(`${it.id}: ${diffs.join(", ")}${it.reason ? `. Waarom: ${it.reason}` : ""}`);
      history.push({ item_id: it.id, what: diffs.join(", "), reason: it.reason || "" });
    }
  }
  for (const id of u.remove_items) {
    if (!items.has(id)) errors.push(`Verwijderen: ${id} bestaat niet.`);
    else lines.push(`Verwijderd: ${id}`);
  }
  const newLog = u.log.filter((l) => l.id === undefined);
  const editLog = u.log.filter((l) => l.id !== undefined);
  for (const l of [...u.log]) {
    for (const pid of (l.phase_ids || "").split(",").filter(Boolean)) if (!phases.has(pid)) errors.push(`Logboek: fase ${pid} bestaat niet.`);
  }
  if (newLog.length) lines.push(`Logboek: ${newLog.length} nieuwe ${newLog.length === 1 ? "regel" : "regels"}`);
  for (const l of editLog) {
    if (!logIds.has(l.id)) errors.push(`Logboek: regel ${l.id} bestaat niet.`);
    else lines.push(`Logboek: regel ${l.id} bijgewerkt (${(current.log.find((x) => x.id === l.id) || {}).title || ""})`);
  }
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
  return { lines, errors, history };
}
