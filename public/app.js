"use strict";
// Creyo projecttool, browser side. All data comes from the Worker API; nothing secret lives here.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const STATUS = { open: ["Open", "p-open"], busy: ["Bezig", "p-busy"], wait: ["Wacht", "p-wait"], done: ["Klaar", "p-done"] };
const FB_STATUS = { new: ["Nieuw", "p-new"], converted: ["Omgezet naar taak", "p-converted"], closed: ["Afgesloten", "p-closed"] };
const FILE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];
const MAX_FILE = 10 * 1024 * 1024;

let S = null; // state from /api/state
let filter = "all";
let openItemId = null;
let openPhaseId = null; // phase panel open (or the phase an open item was reached from)
let pendingPatch = null; // status/owner change waiting for "Opslaan" with a reason
let pendingFiles = []; // for the feedback form
let checkedText = null; // text that passed "Controleren"
let secretWarnedFor = null; // feedback text the "looks like a password" warning was shown for
// Words and shapes that usually mean a password or key was pasted.
const SECRET_HINT = /(wachtwoord|password|passwd|\binlog\b|inloggegevens|api[ _-]?key|secret|token|sk_(live|test)_|pk_(live|test)_|re_[A-Za-z0-9]{8,}|-----BEGIN)/i;

// ---------- api ----------
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.method && opts.method !== "GET") headers["X-Creyo"] = "1";
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.json);
  }
  const r = await fetch(path, { method: opts.method || "GET", headers, body: opts.body, credentials: "same-origin" });
  let data = null;
  try { data = await r.json(); } catch { /* not json */ }
  if (!r.ok) {
    const err = new Error((data && (data.detail && !Array.isArray(data.detail) ? data.detail : data.error)) || `Fout ${r.status}`);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

function say(msg, isErr = false) {
  const el = $("#status");
  el.textContent = msg || "";
  el.classList.toggle("err", !!isErr);
}

const ERR_NL = {
  not_signed_in: "Je bent niet (meer) ingelogd. Ververs de pagina om opnieuw in te loggen.",
  admin_only: "Alleen een beheerder kan dit doen.",
  too_large: "Dit bestand is te groot. Maximaal 10 MB.",
  unsupported_type: "Alleen afbeeldingen (png, jpg, webp, gif) en pdf.",
  text_required: "Schrijf eerst iets.",
  server_error: "Er ging iets mis op de server. Probeer het opnieuw.",
  forbidden: "Dit mag alleen degene die het schreef, of een beheerder.",
};
const errText = (e) => ERR_NL[e.message] || e.message || "Er ging iets mis.";

// ---------- helpers ----------
const person = (k) => S.people.find((p) => p.key === k);
const pName = (k) => (k === "claude" || String(k).startsWith("claude") ? "Claude" : person(k)?.name || "Onbekend");
const whoChip = (k) => {
  const isClaude = k === "claude" || String(k).startsWith("claude");
  const cls = isClaude ? "" : esc(k || "");
  const letter = isClaude ? "AI" : esc((person(k)?.name || "?").slice(0, 1));
  return `<span class="who ${cls}" title="${esc(pName(k))}">${letter}</span>`;
};
const fmt = (iso) => {
  try { return new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
};
const fmtDate = (d) => {
  try { return new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; }
};
const pill = (map, k) => `<span class="pill ${map[k]?.[1] || "p-open"}">${esc(map[k]?.[0] || k)}</span>`;
const filesFor = (type, id) => S.files.filter((f) => f.target_type === type && f.target_id === String(id));
const commentsFor = (type, id) => S.comments.filter((c) => c.target_type === type && c.target_id === String(id));
const historyFor = (id) => (S.history || []).filter((h) => h.item_id === id);
const ORDER = { busy: 0, wait: 1, open: 2, done: 3 };
const byUrgency = (a, b) => ORDER[a.status] - ORDER[b.status] || a.priority - b.priority || a.sort - b.sort;
function logForPhase(pid) {
  const ids = new Set(S.items.filter((i) => i.phase_id === pid).map((i) => i.id));
  return S.log.filter((l) => (l.phase_ids || "").split(",").includes(pid) || (l.item_ids || "").split(",").some((x) => ids.has(x)));
}
function logEntryHtml(l, compact) {
  const tags = [...(l.phase_ids ? l.phase_ids.split(",").map((x) => "fase " + x) : []), ...(l.item_ids ? l.item_ids.split(",") : [])].join(", ");
  return `<article class="e card${compact ? " compact" : ""}"><div class="d">${esc(fmtDate(l.date))}${tags ? " · " + esc(tags) : ""}</div>
    <h3>${esc(l.title)}</h3>
    <dl class="kv">${l.what ? `<dt>Wat</dt><dd>${esc(l.what)}</dd>` : ""}${l.why ? `<dt>Waarom</dt><dd>${esc(l.why)}</dd>` : ""}${l.result ? `<dt>Resultaat</dt><dd>${esc(l.result)}</dd>` : ""}</dl></article>`;
}
function setBars(root) {
  $$("[data-w]", root).forEach((el) => (el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w))) + "%"));
}

function shotsHtml(list, canDelete) {
  return list
    .map((f) => {
      const url = `/api/files/${encodeURIComponent(f.id)}`;
      const inner = f.content_type.startsWith("image/")
        ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(f.name)}" loading="lazy"></a>`
        : `<a href="${url}" target="_blank" rel="noopener">${esc(f.name)}</a>`;
      const del = canDelete(f) ? `<button class="x" type="button" data-del-file="${esc(f.id)}" aria-label="Verwijder ${esc(f.name)}">×</button>` : "";
      return `<div class="shot">${inner}${del}</div>`;
    })
    .join("");
}
const canDeleteFile = (f) => S.me.admin || f.created_by === S.me.key;

const canDeleteOwn = (createdBy) => S.me.admin || createdBy === S.me.key;
function commentsHtml(type, id) {
  const list = commentsFor(type, id)
    .map(
      (c) => `<div class="cmt">${whoChip(c.created_by)}<div><b>${esc(pName(c.created_by))}</b> <span class="small-muted">${esc(fmt(c.created_at))}</span>${
        canDeleteOwn(c.created_by) ? ` <button class="linkbtn" type="button" data-del-comment="${c.id}">Verwijderen</button>` : ""
      }<p>${esc(c.text)}</p></div></div>`,
    )
    .join("");
  const fid = `c-${type}-${esc(id)}`;
  return `<div class="comments">${list}</div>
  <form class="cmt-form" data-comment="${esc(type)}" data-target="${esc(id)}">
    <textarea id="${fid}" rows="1" placeholder="Schrijf een reactie" aria-label="Reactie"></textarea>
    <button class="btn small" type="submit">Reageren</button>
  </form>`;
}

// ---------- render ----------
function render() {
  if (!S) return;
  $("#me").textContent = `ingelogd als ${S.me.name}`;
  $("#admBtn").hidden = !S.me.admin;
  $("#headline").textContent = S.meta.headline || "Get Creyo, waar we staan";
  $("#goal").textContent = S.meta.goal || "";
  const openItems = S.items.filter((i) => i.status !== "done");
  $("#n-taken").textContent = String(openItems.length);
  const newFb = S.feedback.filter((f) => f.status === "new").length;
  $("#n-feedback").textContent = newFb ? `${newFb} nieuw` : "";
  renderOverview();
  renderTasks();
  renderFeedback();
  renderLog();
  if (openItemId) renderDrawer();
}

function renderOverview() {
  const total = S.items.length;
  const done = S.items.filter((i) => i.status === "done").length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const perPerson = S.people
    .map((p) => {
      const n = S.items.filter((i) => i.owner === p.key && i.status !== "done").length;
      return `<div class="person">${whoChip(p.key)}<span class="nm">${esc(p.name)}</span><b>${n} open</b></div>`;
    })
    .join("");
  const top = S.items
    .filter((i) => i.priority === 1 && i.status !== "done")
    .slice(0, 5)
    .map((i) => `<div><span class="pill ${i.status === "busy" ? "p-busy" : "p-high"}">${esc(i.id)}</span> ${esc(i.title)}</div>`)
    .join("") || `<div class="small-muted">Niets met hoogste prioriteit open.</div>`;
  const last = S.log[0];
  const lastHtml = last
    ? `<div>${esc(fmtDate(last.date))}: ${esc(last.title)}</div><div class="act left"><button class="btn small" type="button" data-go="logboek">Naar het logboek</button></div>`
    : `<div class="small-muted">Nog geen regels in het logboek.</div>`;
  $("#ov-cards").innerHTML = `
    <div class="card"><div class="lbl">Voortgang</div><div class="big">${done} van ${total}</div><div class="bar"><i data-w="${pct}"></i></div><div class="small-muted">taken klaar</div></div>
    <div class="card"><div class="lbl">Open per persoon</div><div class="stack">${perPerson}</div></div>
    <div class="card"><div class="lbl">Hoogste prioriteit</div><div class="stack">${top}</div></div>
    <div class="card"><div class="lbl">Laatste in het logboek</div>${lastHtml}</div>`;
  $("#ov-phases").innerHTML =
    S.phases
      .map((p) => {
        const its = S.items.filter((i) => i.phase_id === p.id);
        const d = its.filter((i) => i.status === "done").length;
        const w = its.length ? Math.round((d / its.length) * 100) : 0;
        const busy = its.filter((i) => i.status === "busy").length;
        return `<button class="card phase-card" type="button" data-phase="${esc(p.id)}" aria-label="Fase ${esc(p.id)}, ${esc(p.name)}: open de taken en het logboek">
          <span class="lbl">${esc(p.id)} · ${esc(p.name)}</span><span class="big mid">${d} / ${its.length}</span><span class="bar"><i data-w="${w}"></i></span>
          ${p.note ? `<span class="small-muted">${esc(p.note)}</span>` : ""}
          <span class="more">${busy ? `${busy} bezig · ` : ""}Bekijk taken en logboek →</span></button>`;
      })
      .join("") || `<div class="empty">Nog geen fasen. Plak de eerste update van Claude via Beheer.</div>`;
  setBars($("#v-overzicht"));
}

function renderTasks() {
  const chips = [["all", "Alles"], ...S.people.map((p) => [`p:${p.key}`, p.name]), ["open", "Open"], ["done", "Klaar"]];
  $("#filters").innerHTML = chips.map(([k, l]) => `<button class="chip" type="button" data-filter="${esc(k)}" aria-pressed="${filter === k}">${esc(l)}</button>`).join("");
  const match = (i) =>
    filter === "all" ? true : filter === "open" ? i.status !== "done" : filter === "done" ? i.status === "done" : filter.startsWith("p:") ? i.owner === filter.slice(2) : true;
  const row = (i) => `<button class="row" type="button" data-item="${esc(i.id)}">
      <span class="id">${esc(i.id)}</span>
      <span class="t"><b>${esc(i.title)}</b><small>${esc(i.next || i.why || "")}</small></span>
      <span class="r">${i.priority === 1 && i.status !== "done" ? '<span class="pill p-high">hoog</span>' : ""}${pill(STATUS, i.status)}${i.owner ? whoChip(i.owner) : ""}</span>
    </button>`;
  const groups = [...S.phases.map((p) => ({ id: p.id, name: p.name })), { id: null, name: "Zonder fase" }];
  const html = groups
    .map((g) => {
      const its = S.items.filter((i) => (i.phase_id || null) === g.id && match(i));
      if (!its.length) return "";
      const head = g.id
        ? `<button class="link-h" type="button" data-phase="${esc(g.id)}"><h2>${esc(g.id)} · ${esc(g.name)}</h2></button>`
        : `<h2>${esc(g.name)}</h2>`;
      return `<div class="phase-h">${head}<span class="small-muted">${its.length}</span></div><div class="list">${its.map(row).join("")}</div>`;
    })
    .join("");
  $("#tasks").innerHTML = html || `<div class="empty">Geen taken voor dit filter.</div>`;
}

function renderFeedback() {
  const opts = [...S.people.map((p) => `<option value="${esc(p.key)}">${esc(p.name)}</option>`), `<option value="">Weet ik niet</option>`].join("");
  const sel = $("#fbFor");
  const keep = sel.value;
  sel.innerHTML = opts;
  if (sel.dataset.init && $$("option", sel).some((o) => o.value === keep)) sel.value = keep;
  else {
    const other = S.people.find((p) => p.key !== S.me.key);
    sel.value = other ? other.key : "";
    sel.dataset.init = "1";
  }
  $("#fbPending").innerHTML = pendingFiles
    .map((f, n) => `<div class="shot">${f.url ? `<img src="${f.url}" alt="${esc(f.file.name)}">` : `<a>${esc(f.file.name)}</a>`}<button class="x" type="button" data-unpend="${n}" aria-label="Verwijder ${esc(f.file.name)}">×</button></div>`)
    .join("");
  $("#fbList").innerHTML =
    S.feedback
      .map((f) => {
        const del = canDeleteOwn(f.created_by) ? `<button class="btn small danger" type="button" data-del-fb="${f.id}">Verwijderen</button>` : "";
        const admin = S.me.admin
          ? `<div class="act left">
              <button class="btn small" type="button" data-fb-status="converted" data-fb="${f.id}">Omgezet naar taak</button>
              <button class="btn small" type="button" data-fb-status="closed" data-fb="${f.id}">Afsluiten</button>
              ${f.status !== "new" ? `<button class="btn small" type="button" data-fb-status="new" data-fb="${f.id}">Weer open</button>` : ""}
              ${del}
            </div>`
          : del ? `<div class="act left">${del}</div>` : "";
        return `<div class="fb" id="fb-${f.id}">
          <div class="fb-h">${whoChip(f.created_by)}<b>${esc(pName(f.created_by))}</b><span class="small-muted">${esc(fmt(f.created_at))}${f.for_owner ? " · voor " + esc(pName(f.for_owner)) : ""}</span>${pill(FB_STATUS, f.status)}${f.item_id ? `<span class="pill p-open">${esc(f.item_id)}</span>` : ""}</div>
          <p>${esc(f.text)}</p>
          <div class="shots">${shotsHtml(filesFor("feedback", f.id), canDeleteFile)}</div>

          ${admin}
          ${commentsHtml("feedback", f.id)}
        </div>`;
      })
      .join("") || `<div class="empty">Nog geen feedback.</div>`;
}

function renderLog() {
  $("#log").innerHTML = S.log.map((l) => logEntryHtml(l, false)).join("") || `<div class="empty">Nog geen regels in het logboek.</div>`;
}

function renderDrawer() {
  if (openItemId) return renderItemDrawer();
  if (openPhaseId) return renderPhaseDrawer();
}

function itemRow(i) {
  const sub = i.status === "wait" && i.waits_for ? `Wacht op: ${i.waits_for}` : i.next || i.why || "";
  return `<button class="row" type="button" data-item="${esc(i.id)}">
    <span class="id">${esc(i.id)}</span>
    <span class="t"><b>${esc(i.title)}</b><small>${esc(sub)}</small></span>
    <span class="r">${i.priority === 1 && i.status !== "done" ? '<span class="pill p-high">hoog</span>' : ""}${pill(STATUS, i.status)}${i.owner ? whoChip(i.owner) : ""}</span>
  </button>`;
}

function renderPhaseDrawer() {
  const p = S.phases.find((x) => x.id === openPhaseId);
  if (!p) return closeDrawer();
  const its = S.items.filter((i) => i.phase_id === p.id);
  const todo = its.filter((i) => i.status !== "done").sort(byUrgency);
  const done = its.filter((i) => i.status === "done").sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const pct = its.length ? Math.round((done.length / its.length) * 100) : 0;
  const log = logForPhase(p.id);
  $("#dr").setAttribute("aria-label", `Fase ${p.id}`);
  $("#dr").innerHTML = `
    <div class="dr-h"><span class="dr-id">Fase ${esc(p.id)}</span><button class="btn small" type="button" id="drClose">Sluiten</button></div>
    <h1>${esc(p.name)}</h1>
    ${p.note ? `<p class="sub">${esc(p.note)}</p>` : ""}
    <div class="card tight"><div class="big mid">${done.length} van ${its.length} klaar</div><div class="bar"><i data-w="${pct}"></i></div></div>
    <h3>Nog te doen om deze fase af te ronden (${todo.length})</h3>
    <div class="list">${todo.map(itemRow).join("") || `<div class="empty">Alles in deze fase is klaar.</div>`}</div>
    ${done.length ? `<details class="done-list"><summary>Al klaar (${done.length})</summary><div class="list">${done.map(itemRow).join("")}</div></details>` : ""}
    <h3>Logboek van deze fase (${log.length})</h3>
    <div class="log">${log.map((l) => logEntryHtml(l, true)).join("") || `<div class="empty">Nog niets in het logboek voor deze fase.</div>`}</div>`;
  setBars($("#dr"));
}

function historyHtml(id) {
  const list = historyFor(id);
  if (!list.length) return `<div class="small-muted">Nog geen wijzigingen vastgelegd.</div>`;
  return `<ol class="hist">${list
    .map(
      (h) => `<li>${whoChip(h.who)}<div><span class="small-muted">${esc(fmt(h.at))} · ${esc(pName(h.who))}</span>
        <b>${esc(h.what)}</b>${h.reason ? `<p><span class="why-l">Waarom:</span> ${esc(h.reason)}</p>` : ""}</div></li>`,
    )
    .join("")}</ol>`;
}

function renderItemDrawer() {
  const i = S.items.find((x) => x.id === openItemId);
  if (!i) return closeDrawer();
  const cur = { status: i.status, owner: i.owner || "", ...(pendingPatch || {}) };
  const ownerOpts = [`<option value="">Niemand</option>`, ...S.people.map((p) => `<option value="${esc(p.key)}"${cur.owner === p.key ? " selected" : ""}>${esc(p.name)}</option>`)].join("");
  const statusOpts = Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}"${cur.status === k ? " selected" : ""}>${l}</option>`).join("");
  const phase = S.phases.find((p) => p.id === i.phase_id);
  const back = openPhaseId ? `<button class="btn small" type="button" id="drBack">← Fase ${esc(openPhaseId)}</button>` : "";
  $("#dr").setAttribute("aria-label", `Taak ${i.id}`);
  $("#dr").innerHTML = `
    <div class="dr-h"><span class="dr-id">${back || esc(i.id)}${!back && phase ? " · " + esc(phase.name) : ""}</span><button class="btn small" type="button" id="drClose">Sluiten</button></div>
    ${back ? `<div class="dr-id">${esc(i.id)}${phase ? " · " + esc(phase.name) : ""}</div>` : ""}
    <h1>${esc(i.title)}</h1>
    <div class="meta">${pill(STATUS, i.status)}${i.priority === 1 ? '<span class="pill p-high">hoog</span>' : ""}${i.owner ? whoChip(i.owner) + `<span class="small-muted">${esc(pName(i.owner))}</span>` : ""}<span class="small-muted">bijgewerkt ${esc(fmt(i.updated_at))} door ${esc(pName(i.updated_by))}</span></div>
    <dl class="kv">${i.why ? `<dt>Waarom</dt><dd>${esc(i.why)}</dd>` : ""}${i.next ? `<dt>Volgende</dt><dd>${esc(i.next)}</dd>` : ""}${i.waits_for ? `<dt>Wacht op</dt><dd>${esc(i.waits_for)}</dd>` : ""}</dl>
    <div class="sel-row">
      <div><label for="drStatus">Status</label><select id="drStatus">${statusOpts}</select></div>
      <div><label for="drOwner">Toegewezen aan</label><select id="drOwner">${ownerOpts}</select></div>
    </div>
    ${
      pendingPatch
        ? `<div class="why-box">
        <label for="drReason">Waarom verander je dit? Kort en in gewone woorden.</label>
        <textarea id="drReason" rows="2" placeholder="Bijvoorbeeld: getest op de echte site en het werkt"></textarea>
        <div class="act left"><button class="btn pri small" type="button" id="drSave">Opslaan</button><button class="btn small" type="button" id="drCancel">Annuleren</button></div>
      </div>`
        : ""
    }
    <h3>Wat er veranderde en waarom</h3>
    ${historyHtml(i.id)}
    <span class="lbl-like">Screenshots</span>
    <div class="drop" id="drDrop" tabindex="0" role="button" aria-label="Screenshot toevoegen: plakken, slepen of klikken om te kiezen">Plak (Cmd+V of Ctrl+V), sleep, of klik om een screenshot te kiezen</div>
    <input type="file" id="drFile" accept="${FILE_TYPES.join(",")}" multiple hidden>
    <div class="shots">${shotsHtml(filesFor("item", i.id), canDeleteFile)}</div>
    <h3>Reacties</h3>
    ${commentsHtml("item", i.id)}`;
}

// ---------- actions ----------
async function load(quiet) {
  try {
    S = await api("/api/state");
    render();
    if (!quiet) say("");
  } catch (e) {
    say(errText(e), true);
  }
}

function showTab(name) {
  $$(".tab").forEach((b) => {
    const on = b.id === `t-${name}`;
    b.setAttribute("aria-selected", String(on));
    $(`#${b.getAttribute("aria-controls")}`).hidden = !on;
  });
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
}

function showDrawer() {
  renderDrawer();
  $("#ov").hidden = false;
  $("#dr").hidden = false;
  $("#dr").scrollTop = 0;
  ($("#drBack") || $("#drClose")).focus();
}
function openDrawer(id) {
  // An item opened from the phase panel keeps the phase, so "back" works.
  if ($("#dr").hidden) openPhaseId = null;
  openItemId = id;
  pendingPatch = null;
  showDrawer();
}
function openPhase(id) {
  openItemId = null;
  pendingPatch = null;
  openPhaseId = id;
  showDrawer();
}
function closeDrawer() {
  openItemId = null;
  openPhaseId = null;
  pendingPatch = null;
  $("#dr").hidden = true;
  if ($("#adm").hidden) $("#ov").hidden = true;
}

async function patchItem(id, patch) {
  try {
    await api(`/api/items/${encodeURIComponent(id)}`, { method: "PATCH", json: patch });
    pendingPatch = null;
    say("Opgeslagen.");
    await load(true);
  } catch (e) {
    say(errText(e), true);
  }
}

function acceptFile(file) {
  if (!FILE_TYPES.includes(file.type)) return say(ERR_NL.unsupported_type, true), false;
  if (file.size > MAX_FILE) return say(ERR_NL.too_large, true), false;
  return true;
}

async function uploadFile(type, id, file) {
  const name = file.name && file.name !== "image.png" ? file.name : `screenshot-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${(file.type.split("/")[1] || "png").replace("jpeg", "jpg")}`;
  const r = await fetch(`/api/files?target_type=${encodeURIComponent(type)}&target_id=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": file.type, "X-File-Name": name, "X-Creyo": "1" },
    body: file,
    credentials: "same-origin",
  });
  if (!r.ok) {
    let d = null;
    try { d = await r.json(); } catch { /* ignore */ }
    const e = new Error((d && (d.error || d.detail)) || `Fout ${r.status}`);
    throw e;
  }
}

async function addItemFiles(files) {
  const id = openItemId;
  if (!id) return;
  const ok = files.filter(acceptFile);
  if (!ok.length) return;
  say("Uploaden...");
  try {
    for (const f of ok) await uploadFile("item", id, f);
    say(ok.length === 1 ? "Screenshot toegevoegd." : `${ok.length} screenshots toegevoegd.`);
    await load(true);
  } catch (e) {
    say(errText(e), true);
  }
}

function addPending(files) {
  for (const file of files.filter(acceptFile)) pendingFiles.push({ file, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
  renderFeedback();
}

async function sendFeedback(ev) {
  ev.preventDefault();
  const text = $("#fbText").value.trim();
  if (!text) return say(ERR_NL.text_required, true), $("#fbText").focus();
  if (SECRET_HINT.test(text) && secretWarnedFor !== text) {
    secretWarnedFor = text;
    $("#fbWarn").hidden = false;
    return $("#fbText").focus();
  }
  $("#fbWarn").hidden = true;
  const btn = $("#fbSend");
  btn.disabled = true;
  say("Versturen...");
  try {
    const r = await api("/api/feedback", { method: "POST", json: { text, for_owner: $("#fbFor").value || null } });
    for (const p of pendingFiles) await uploadFile("feedback", r.id, p.file);
    pendingFiles.forEach((p) => p.url && URL.revokeObjectURL(p.url));
    pendingFiles = [];
    $("#fbText").value = "";
    say("Feedback verstuurd. Dank je.");
    await load(true);
  } catch (e) {
    say(errText(e), true);
  } finally {
    btn.disabled = false;
  }
}

async function sendComment(form) {
  const ta = $("textarea", form);
  const text = ta.value.trim();
  if (!text) return;
  try {
    await api("/api/comments", { method: "POST", json: { target_type: form.dataset.comment, target_id: form.dataset.target, text } });
    ta.value = "";
    say("Reactie geplaatst.");
    await load(true);
  } catch (e) {
    say(errText(e), true);
  }
}

async function deleteFile(id, btn) {
  if (btn.dataset.sure !== "1") {
    btn.dataset.sure = "1";
    btn.textContent = "Zeker?";
    return;
  }
  try {
    await api(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    say("Verwijderd.");
    await load(true);
  } catch (e) {
    say(errText(e), true);
  }
}

// Two clicks: the first asks "Zeker weten?".
async function removeThing(path, btn, done) {
  if (btn.dataset.sure !== "1") {
    btn.dataset.sure = "1";
    btn.textContent = "Zeker weten? Klik nog een keer";
    return;
  }
  try {
    await api(path, { method: "DELETE" });
    say(done);
    await load(true);
  } catch (e) {
    say(errText(e), true);
  }
}

// ---------- admin ----------
async function openAdmin() {
  $("#adm").hidden = false;
  $("#checkOut").innerHTML = "";
  $("#copyFallback").hidden = true;
  const last = S.meta.last_export_at;
  $("#admLast").textContent = last ? `Laatste export naar Claude: ${fmt(last)}.` : "Nog niet eerder geëxporteerd.";
  $("#copyBtn").focus();
  loadVersions();
}
function closeAdmin() {
  $("#adm").hidden = true;
  if ($("#dr").hidden) $("#ov").hidden = true;
}

async function copyForClaude() {
  const btn = $("#copyBtn");
  btn.disabled = true;
  try {
    const data = await api("/api/admin/export");
    const text = "Update uit de Creyo projecttool:\n```json\n" + JSON.stringify(data, null, 2) + "\n```";
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      const ta = $("#copyFallback");
      ta.hidden = false;
      ta.value = text;
      ta.focus();
      ta.select();
    }
    await api("/api/admin/export/done", { method: "POST", json: { exported_at: data.exported_at } });
    S.meta.last_export_at = data.exported_at;
    $("#admLast").textContent = copied
      ? `Gekopieerd. Plak het in de chat met Claude. (${data.changes.length} wijzigingen, ${data.open_feedback.length} open feedback)`
      : "Kopiëren lukte niet automatisch. De tekst staat hieronder geselecteerd: kopieer hem met Cmd+C of Ctrl+C.";
  } catch (e) {
    say(errText(e), true);
  } finally {
    btn.disabled = false;
  }
}

function parseUpdate() {
  let raw = $("#fromClaude").value.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  return JSON.parse(raw);
}

function showCheck(lines, isErr) {
  const out = $("#checkOut");
  out.classList.toggle("err", !!isErr);
  out.innerHTML = `<b>${isErr ? "Dit klopt niet:" : "Dit gaat er veranderen:"}</b><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
}

async function checkUpdate() {
  $("#applyBtn").disabled = true;
  checkedText = null;
  let payload;
  try {
    payload = parseUpdate();
  } catch {
    return showCheck(["Dit is geen geldige JSON. Kopieer het hele blok van Claude, inclusief de accolades."], true);
  }
  try {
    const r = await api("/api/admin/check", { method: "POST", json: { payload } });
    showCheck(r.summary, false);
    checkedText = $("#fromClaude").value;
    $("#applyBtn").disabled = false;
  } catch (e) {
    showCheck(Array.isArray(e.data?.detail) ? e.data.detail : [errText(e)], true);
  }
}

async function applyUpdate() {
  if ($("#fromClaude").value !== checkedText) {
    $("#applyBtn").disabled = true;
    return showCheck(["De tekst is gewijzigd na het controleren. Klik eerst opnieuw op Controleren."], true);
  }
  $("#applyBtn").disabled = true;
  try {
    const r = await api("/api/admin/apply", { method: "POST", json: { payload: parseUpdate() } });
    showCheck(["Toegepast.", ...r.summary], false);
    $("#fromClaude").value = "";
    checkedText = null;
    await load(true);
    loadVersions();
  } catch (e) {
    showCheck(Array.isArray(e.data?.detail) ? e.data.detail : [errText(e)], true);
  }
}

async function loadVersions() {
  try {
    const r = await api("/api/admin/versions");
    $("#versions").innerHTML =
      r.versions
        .map((v) => `<div class="ver"><div>Versie ${v.id}<small>${esc(fmt(v.created_at))} · ${esc(pName(v.created_by))} · ${esc(v.note)}</small></div><button class="btn small" type="button" data-restore="${v.id}">Terugzetten</button></div>`)
        .join("") || `<div class="small-muted">Nog geen versies. Er komt een versie bij elke update die je toepast.</div>`;
  } catch (e) {
    $("#versions").textContent = errText(e);
  }
}

async function restoreVersion(id, btn) {
  if (btn.dataset.sure !== "1") {
    btn.dataset.sure = "1";
    btn.textContent = "Zeker weten?";
    return;
  }
  try {
    await api(`/api/admin/versions/${id}/restore`, { method: "POST", json: {} });
    showCheck([`Teruggezet naar de stand van vóór versie ${id}.`], false);
    await load(true);
    loadVersions();
  } catch (e) {
    showCheck([errText(e)], true);
  }
}

// ---------- events ----------
function filesFromEvent(ev) {
  const dt = ev.clipboardData || ev.dataTransfer;
  if (!dt) return [];
  const out = [];
  for (const it of dt.items || []) if (it.kind === "file") { const f = it.getAsFile(); if (f) out.push(f); }
  if (!out.length && dt.files) out.push(...dt.files);
  return out;
}

function wireDrop(zoneSel, inputSel, onFiles) {
  document.addEventListener("click", (e) => { if (e.target.closest(zoneSel)) $(inputSel)?.click(); });
  document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(zoneSel)) { e.preventDefault(); $(inputSel)?.click(); } });
  document.addEventListener("change", (e) => { if (e.target.matches?.(inputSel)) { onFiles(Array.from(e.target.files || [])); e.target.value = ""; } });
  document.addEventListener("dragover", (e) => { const z = e.target.closest?.(zoneSel); if (z) { e.preventDefault(); z.classList.add("over"); } });
  document.addEventListener("dragleave", (e) => { const z = e.target.closest?.(zoneSel); if (z) z.classList.remove("over"); });
  document.addEventListener("drop", (e) => { const z = e.target.closest?.(zoneSel); if (z) { e.preventDefault(); z.classList.remove("over"); onFiles(filesFromEvent(e)); } });
}

document.addEventListener("DOMContentLoaded", () => {
  $$(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.id.slice(2))));
  const start = (location.hash || "#overzicht").slice(1);
  if (["overzicht", "taken", "feedback", "logboek"].includes(start)) showTab(start);

  document.addEventListener("click", (e) => {
    const t = e.target;
    const go = t.closest("[data-go]"); if (go) return showTab(go.dataset.go);
    const chip = t.closest("[data-filter]"); if (chip) { filter = chip.dataset.filter; return renderTasks(); }
    const row = t.closest("[data-item]"); if (row) return openDrawer(row.dataset.item);
    const ph = t.closest("[data-phase]"); if (ph) return openPhase(ph.dataset.phase);
    if (t.closest("#drClose")) return closeDrawer();
    if (t.closest("#drBack")) return openPhase(openPhaseId);
    if (t.closest("#drCancel")) { pendingPatch = null; return renderItemDrawer(); }
    if (t.closest("#drSave")) return patchItem(openItemId, { ...pendingPatch, reason: $("#drReason").value.trim() });
    if (t.id === "ov") { closeDrawer(); return closeAdmin(); }
    const unp = t.closest("[data-unpend]"); if (unp) { const p = pendingFiles.splice(Number(unp.dataset.unpend), 1)[0]; if (p?.url) URL.revokeObjectURL(p.url); return renderFeedback(); }
    const del = t.closest("[data-del-file]"); if (del) return deleteFile(del.dataset.delFile, del);
    const dfb = t.closest("[data-del-fb]"); if (dfb) return removeThing(`/api/feedback/${dfb.dataset.delFb}`, dfb, "Feedback verwijderd.");
    const dcm = t.closest("[data-del-comment]"); if (dcm) return removeThing(`/api/comments/${dcm.dataset.delComment}`, dcm, "Reactie verwijderd.");
    const fbs = t.closest("[data-fb-status]");
    if (fbs) return api(`/api/feedback/${fbs.dataset.fb}`, { method: "PATCH", json: { status: fbs.dataset.fbStatus } }).then(() => load(true)).catch((er) => say(errText(er), true));
    const rs = t.closest("[data-restore]"); if (rs) return restoreVersion(Number(rs.dataset.restore), rs);
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "drStatus" || e.target.id === "drOwner") {
      // Nothing is saved yet: first ask why, in plain words.
      const i = S.items.find((x) => x.id === openItemId);
      const reasonSoFar = $("#drReason")?.value || "";
      const next = { ...(pendingPatch || {}) };
      if (e.target.id === "drStatus") next.status = e.target.value;
      else next.owner = e.target.value || null;
      if (next.status === i.status) delete next.status;
      if ("owner" in next && (next.owner || null) === (i.owner || null)) delete next.owner;
      pendingPatch = Object.keys(next).length ? next : null;
      renderItemDrawer();
      if ($("#drReason")) { $("#drReason").value = reasonSoFar; $("#drReason").focus(); }
    }
  });
  document.addEventListener("submit", (e) => {
    const f = e.target;
    if (f.id === "fbForm") return sendFeedback(e);
    if (f.matches("[data-comment]")) { e.preventDefault(); sendComment(f); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (!$("#adm").hidden) closeAdmin(); else if (!$("#dr").hidden) closeDrawer(); }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-phase]") && e.target.tagName !== "BUTTON") { e.preventDefault(); openPhase(e.target.dataset.phase); }
  });
  document.addEventListener("paste", (e) => {
    const files = filesFromEvent(e);
    if (!files.length) return;
    if (!$("#dr").hidden && openItemId) { e.preventDefault(); return addItemFiles(files); }
    if (!$("#v-feedback").hidden) { e.preventDefault(); return addPending(files); }
  });
  wireDrop("#fbDrop", "#fbFile", addPending);
  wireDrop("#drDrop", "#drFile", addItemFiles);

  $("#admBtn").addEventListener("click", openAdmin);
  $("#admClose").addEventListener("click", closeAdmin);
  $("#copyBtn").addEventListener("click", copyForClaude);
  $("#checkBtn").addEventListener("click", checkUpdate);
  $("#applyBtn").addEventListener("click", applyUpdate);
  $("#fromClaude").addEventListener("input", () => { if ($("#fromClaude").value !== checkedText) $("#applyBtn").disabled = true; });

  load();
  // Keep everyone in step without a manual refresh.
  // Skipped while someone is typing or has a panel open, so nothing they wrote is lost.
  setInterval(() => {
    const typing = document.activeElement && document.activeElement.matches("textarea, input, select");
    const drafts = $$("textarea").some((t) => t.value.trim() && t.id !== "copyFallback");
    if (document.visibilityState === "visible" && $("#adm").hidden && $("#dr").hidden && !typing && !drafts && !pendingFiles.length) load(true);
  }, 60000);
});
