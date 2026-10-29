// WorkLens Recorder — popup. Reads state from the background worker and
// renders one of the screens; every button is a command to the worker.

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const mb = (b) => `${(b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0)} MB`;
const COLORS = ["var(--app-0)", "var(--app-1)", "var(--app-2)", "var(--app-3)", "var(--app-4)", "var(--app-5)"];

let state = null, processes = [], uploadStartedAt = 0;

async function loadProcesses(base) {
  try {
    const r = await fetch(`${base}/api/processes`, { cache: "no-store" });
    const j = await r.json();
    processes = (j.processes ?? []).filter((p) => p.status !== "failed");
  } catch { processes = []; }
  const sel = $("process");
  const keep = sel.value;
  sel.innerHTML = `<option value="">Standalone recording</option>` + processes.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("") + `<option value="new">New process…</option>`;
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : (state?.processId && processes.some((p) => p.id === state.processId) ? state.processId : "");
  onProcessChange();
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function onProcessChange() {
  const v = $("process").value;
  $("newname-field").hidden = v !== "new";
  $("process-help").textContent = v === "" ? "Upload the first role, then the next one into the same process; the map merges once all are built."
    : v === "new" ? "The process is created when you stop. Later roles pick it from this list."
    : "This recording joins the process as the next role in handoff order.";
}

function show(id) { for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id; for (const c of document.querySelectorAll(".chip")) c.hidden = true; }

function render(s) {
  state = s;
  const hostname = (() => { try { return new URL(s.base).host; } catch { return s.base; } })();
  $("ws").textContent = hostname;
  $("link-open").href = s.base;
  $("base").value = s.base;
  if (s.phase === "idle") {
    show("s-idle");
    if (document.activeElement !== $("role")) $("role").value = s.role || $("role").value;
    $("idle-err").hidden = true;
  } else if (s.phase === "recording" || s.phase === "paused") {
    show("s-rec"); $(s.phase === "recording" ? "chip-rec" : "chip-paused").hidden = false;
    $("clock").textContent = mmss(s.elapsed);
    $("who").textContent = [s.role, s.processName || s.newProcessName || (s.processId ? processes.find((p) => p.id === s.processId)?.name : "")].filter(Boolean).join(" · ") || "Standalone recording";
    $("btn-pause").hidden = s.phase !== "recording"; $("btn-resume").hidden = s.phase !== "paused";
    renderTabLog(s);
  } else if (s.phase === "stopping" || s.phase === "uploading") {
    show("s-up"); $("chip-send").hidden = false;
    const u = s.upload; const name = s.run?.source || "recording.webm";
    $("up-name").textContent = s.phase === "stopping" ? "Finishing the file…" : name;
    $("up-pct").textContent = `${u.pct || 0}%`; $("up-bar").style.width = `${u.pct || 0}%`;
    $("up-bytes").textContent = u.total ? `${mb(u.loaded)} of ${mb(u.total)}` : "";
    if (u.pct > 0 && u.pct < 100) { if (!uploadStartedAt) uploadStartedAt = Date.now(); const rate = u.loaded / Math.max(1, Date.now() - uploadStartedAt); $("up-left").textContent = `about ${Math.max(1, Math.round((u.total - u.loaded) / rate / 1000))} s left`; } else $("up-left").textContent = "";
    const apps = new Set(s.tabLog.map((e) => e.host).filter(Boolean)).size;
    $("st-rec-t").textContent = `Recorded ${mmss(s.elapsed)} · ${apps} site${apps === 1 ? "" : "s"} · ${Math.max(0, s.tabLog.length - 1)} switches`;
    $("st-log-t").textContent = `Tab log attached (${s.tabLog.length} entr${s.tabLog.length === 1 ? "y" : "ies"})`;
    $("st-rec").className = "row done"; $("st-log").className = "row done";
  } else if (s.phase === "done") {
    show("s-done"); $("chip-done").hidden = false; uploadStartedAt = 0;
    $("done-name").textContent = s.run?.source || "";
    $("done-meta").textContent = `run ${s.run?.id || ""} · ${mmss(s.elapsed)} · ${mb(s.run?.size || 0)}`;
    $("done-role").textContent = s.role || "–";
    $("done-process").textContent = s.processName || (s.processId ? processes.find((p) => p.id === s.processId)?.name : "") || "Standalone";
    $("done-open").href = `${s.base}/runs/${s.run?.id || ""}`;
    $("done-next").hidden = !s.processId;
  } else if (s.phase === "error") {
    show("s-err"); $("chip-err").hidden = false; uploadStartedAt = 0;
    $("err-text").textContent = s.error || "Unknown error.";
  }
}

function renderTabLog(s) {
  const box = $("tablog");
  if (!s.tabLog.length) { box.innerHTML = `<div class="empty">Switch tabs as you work; each site shows up here with the time you reached it.</div>`; return; }
  const hosts = [...new Set(s.tabLog.map((e) => e.host))];
  const color = (h) => COLORS[Math.max(0, hosts.indexOf(h)) % COLORS.length];
  const rows = [...s.tabLog].reverse().slice(0, 5);
  box.innerHTML = rows.map((e, i) => `<div class="row${i === 0 ? " now" : ""}"><span class="sw" style="background:${color(e.host)}"></span><div class="t"><b>${esc(e.title || e.host || "this tab")}</b>${e.host ? `<span>${esc(e.host)}</span>` : ""}</div><span class="when">${i === 0 ? "now · " : ""}${mmss(e.t * 1000)}</span></div>`).join("");
  $("k-apps").textContent = String(hosts.filter(Boolean).length);
  $("k-sw").textContent = String(Math.max(0, s.tabLog.length - 1));
  $("k-size").textContent = mb(s.bytes || 0);
}

// ---------- wiring ----------
$("process").addEventListener("change", onProcessChange);
$("btn-start").addEventListener("click", async () => {
  const role = $("role").value.trim(); const pv = $("process").value; const newName = $("newname").value.trim();
  if (pv === "new" && !newName) { $("idle-err").textContent = "Give the new process a name first."; $("idle-err").hidden = false; return; }
  if (pv && !role) { $("idle-err").textContent = "Say who is recording (the role), so the handoff between roles can be named."; $("idle-err").hidden = false; return; }
  $("btn-start").disabled = true;
  const s = await send({ type: "start", role, processId: pv === "new" ? "" : pv, newProcessName: pv === "new" ? newName : "" });
  $("btn-start").disabled = false;
  if (s) render({ ...s, processName: s.processName || (pv && pv !== "new" ? processes.find((p) => p.id === pv)?.name : "") });
  if (s?.phase === "recording") window.close();
});
$("btn-pause").addEventListener("click", async () => render(await send({ type: "pause" })));
$("btn-resume").addEventListener("click", async () => render(await send({ type: "resume" })));
$("btn-stop").addEventListener("click", async () => render(await send({ type: "stop" })));
$("btn-discard").addEventListener("click", async () => render(await send({ type: "discard" })));
$("btn-cancel").addEventListener("click", async () => render(await send({ type: "discard" })));
$("btn-again").addEventListener("click", async () => { render(await send({ type: "reset" })); loadProcesses(state.base); });
$("btn-err-reset").addEventListener("click", async () => { render(await send({ type: "reset" })); loadProcesses(state.base); });
$("link-settings").addEventListener("click", (e) => { e.preventDefault(); $("settings").hidden = !$("settings").hidden; });
$("btn-base").addEventListener("click", async () => { render(await send({ type: "set-base", base: $("base").value.trim() })); $("settings").hidden = true; loadProcesses(state.base); });
$("btn-copy").addEventListener("click", async () => {
  const url = `${state.base}/processes/${state.processId}`;
  try { await navigator.clipboard.writeText(url); $("btn-copy").textContent = "Copied"; } catch { $("btn-copy").textContent = url; }
});

chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === "state") render(msg.state); });

(async () => {
  const s = await send({ type: "get-state" });
  render(s);
  loadProcesses(s.base);
})();
