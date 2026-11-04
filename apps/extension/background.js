// WorkLens Recorder — background service worker.
//
// Owns the recording state, the tab log and the toolbar badge. The screen
// capture itself lives in the recorder window (picker.html + offscreen.js), because a service
// worker cannot hold a media stream. The popup only reads state and sends
// commands. Nothing here talks to the recording; the offscreen page reports
// elapsed time, size and upload progress back through messages.
//
// Phases: idle → recording ⇄ paused → stopping → uploading → done | error

const DEFAULT_BASE = "https://worklens-iota.vercel.app";

const INITIAL = {
  phase: "idle", role: "", processId: "", processName: "", newProcessName: "",
  startedAt: 0, elapsed: 0, bytes: 0, tabLog: [], current: null,
  upload: { pct: 0, loaded: 0, total: 0 }, run: null, error: null, base: DEFAULT_BASE,
};

async function getState() {
  const { state } = await chrome.storage.session.get("state");
  const { base } = await chrome.storage.sync.get("base");
  return { ...INITIAL, ...(state ?? {}), base: base || DEFAULT_BASE };
}
// Writes are serialised: without this a 1-second tick could read "recording" and write it
// back over "stopping", which made the stream-ended event trigger a second stop (two uploads).
let _chain = Promise.resolve();
function setState(patch) {
  const run = _chain.then(async () => {
    const s = await getState();
    const next = { ...s, ...(typeof patch === "function" ? patch(s) : patch) };
    await chrome.storage.session.set({ state: next });
    await badge(next);
    chrome.runtime.sendMessage({ type: "state", state: next }).catch(() => {});
    return next;
  });
  _chain = run.catch(() => {});
  return run;
}

// ---------- badge ----------
const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
async function badge(s) {
  const set = (text, color) => Promise.all([chrome.action.setBadgeText({ text }), color ? chrome.action.setBadgeBackgroundColor({ color }) : Promise.resolve()]);
  if (s.phase === "recording") return set(mmss(s.elapsed), "#c0392b");
  if (s.phase === "paused") return set("II", "#7b8594");
  if (s.phase === "stopping" || s.phase === "uploading") return set(`${s.upload.pct || 0}%`, "#1d5fd1");
  if (s.phase === "done") return set("✓", "#1b7f4b");
  if (s.phase === "error") return set("!", "#c0392b");
  return set("", null);
}

// ---------- recorder window ----------
// picker.html owns both Chrome's picker and the MediaRecorder (see picker.js). The
// messages keep their "offscreen" target name; the page that answers is the window.
async function closeOffscreen() {
  const s = await getState();
  if (s.recorderWindowId) { try { await chrome.windows.remove(s.recorderWindowId); } catch {} await setState({ recorderWindowId: null }); }
}
const toOffscreen = (msg) => chrome.runtime.sendMessage({ target: "offscreen", ...msg }).catch(() => {});

// ---------- tab log: which site is on screen, and when ----------
function host(url) { try { const u = new URL(url); return u.protocol.startsWith("http") ? u.host.replace(/^www\./, "") : ""; } catch { return ""; } }
async function logActiveTab(reason) {
  const s = await getState();
  if (s.phase !== "recording") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || (tab.url || "").startsWith("chrome-extension://")) return;   // never log the recorder window itself
  const entry = { t: Math.round(s.elapsed / 1000), host: host(tab.url || ""), title: (tab.title || "").slice(0, 120), reason };
  const last = s.tabLog[s.tabLog.length - 1];
  if (last && last.host === entry.host && last.title === entry.title) return;
  const tabLog = [...s.tabLog, entry].slice(-500);
  await setState({ tabLog, current: entry });
}
chrome.tabs.onActivated.addListener(() => logActiveTab("switch"));
// picker window closed without a choice -> back to idle, keeping what was typed
// recorder window closed by the person
chrome.windows.onRemoved.addListener(async (id) => {
  const s = await getState();
  if (s.recorderWindowId !== id) return;
  if (s.phase === "picking") await setState({ ...INITIAL, base: s.base, role: s.role, processId: s.processId, newProcessName: s.newProcessName });
  else if (s.phase === "recording" || s.phase === "paused" || s.phase === "stopping" || s.phase === "uploading") await setState({ phase: "error", error: "The recorder window was closed, so the recording was lost. Start again and leave that window minimised.", recorderWindowId: null });
  else await setState({ recorderWindowId: null });
});
chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (tab.active && (info.title || info.url)) logActiveTab("navigate"); });
chrome.windows.onFocusChanged.addListener((id) => { if (id !== chrome.windows.WINDOW_ID_NONE) logActiveTab("window"); });

// ---------- API ----------
async function api(base, path, body) {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${path} returned ${r.status}`);
  return j;
}

// ---------- commands from the popup ----------
async function start({ role, processId, newProcessName }) {
  const s = await getState();
  if (s.phase !== "idle" && s.phase !== "done" && s.phase !== "error") return s;
  await closeOffscreen();
  await setState({ ...INITIAL, base: s.base, phase: "picking", role, processId, newProcessName });
  try {
    // a popup window large enough for Chrome's picker sheet; it records and is minimised once the capture runs
    const win = await chrome.windows.create({ url: chrome.runtime.getURL("picker.html"), type: "popup", width: 980, height: 720, focused: true });
    await setState({ recorderWindowId: win.id });
  } catch (e) {
    return setState({ ...INITIAL, base: s.base, role, processId, newProcessName, phase: "error", error: `Could not open the recorder window: ${e.message}` });
  }
  return getState();
}

// The recorder window reports the chosen stream (or "" when the person cancelled).
async function picked(streamId) {
  const s = await getState();
  if (s.phase !== "picking") return s;
  if (!streamId) { await closeOffscreen(); return setState({ ...INITIAL, base: s.base, role: s.role, processId: s.processId, newProcessName: s.newProcessName }); }
  await setState({ phase: "recording", startedAt: Date.now(), tabLog: [], current: null });
  await toOffscreen({ type: "os-start", streamId });
  try { if (s.recorderWindowId) await chrome.windows.update(s.recorderWindowId, { state: "minimized" }); } catch {}
  setTimeout(() => logActiveTab("start"), 600);   // once focus is back on the working window
  return getState();
}

async function stop() {
  const s = await getState();
  // "stopping" again = the first os-stop did not land (or the recorder never answered): ask once more
  if (s.phase === "stopping") { await toOffscreen({ type: "os-stop" }); return s; }
  if (s.phase !== "recording" && s.phase !== "paused") return s;
  await setState({ phase: "stopping" });
  await toOffscreen({ type: "os-stop" });
  return getState();
}

async function discard() {
  await toOffscreen({ type: "os-discard" });
  await closeOffscreen();
  const s = await getState();
  return setState({ ...INITIAL, base: s.base, role: s.role, processId: s.processId, newProcessName: s.newProcessName });
}

const slug = (t) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// The offscreen page has the file: create the run, hand it the signed URL.
async function onStopped({ size, contentType }) {
  const type = contentType || "video/webm";
  // claim the transition atomically: a second os-stopped (or a late one) does nothing
  const s = await setState((cur) => (cur.phase === "stopping" ? { phase: "creating" } : {}));
  if (s.phase !== "creating") return;
  try {
    let processId = s.processId, processName = s.processName;
    if (!processId && s.newProcessName) {
      const p = await api(s.base, "/api/processes", { name: s.newProcessName });
      processId = p.id; processName = p.name;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const filename = `${slug(processName || s.newProcessName) || "task"}${s.role ? "-" + slug(s.role) : ""}-${stamp}.webm`;
    const run = await api(s.base, "/api/runs", { filename, size, type, process_id: processId || undefined, role: s.role || undefined });
    await setState({ phase: "uploading", processId, processName, run: { id: run.id, source: filename, size }, upload: { pct: 0, loaded: 0, total: size } });
    await toOffscreen({ type: "os-upload", uploadUrl: run.uploadUrl, contentType: run.contentType || type });
  } catch (e) {
    await setState({ phase: "error", error: e.message || String(e) });
    await closeOffscreen();
  }
}

async function onUploaded() {
  const s = await getState();
  try {
    await api(s.base, `/api/runs/${s.run.id}/tablog`, { entries: s.tabLog });
  } catch { /* the log is a bonus; the run still goes ahead */ }
  try {
    await api(s.base, `/api/runs/${s.run.id}/start`);
    await setState({ phase: "done", upload: { ...s.upload, pct: 100 } });
  } catch (e) {
    await setState({ phase: "error", error: e.message || String(e) });
  }
  await closeOffscreen();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target === "offscreen") return false;
  (async () => {
    switch (msg?.type) {
      case "get-state": return reply(await getState());
      case "start": return reply(await start(msg));
      case "picked": return reply(await picked(msg.streamId));
      case "pause": await toOffscreen({ type: "os-pause" }); return reply(await setState({ phase: "paused" }));
      case "resume": await toOffscreen({ type: "os-resume" }); return reply(await setState({ phase: "recording" }));
      case "stop": return reply(await stop());
      case "discard": return reply(await discard());
      case "reset": { const s = await getState(); return reply(await setState({ ...INITIAL, base: s.base, role: s.role, processId: s.processId })); }
      case "set-base": { await chrome.storage.sync.set({ base: (msg.base || DEFAULT_BASE).replace(/\/$/, "") }); return reply(await getState()); }
      // from the offscreen page
      case "os-tick": return reply(await setState((cur) => (cur.phase === "recording" || cur.phase === "paused" ? { elapsed: msg.elapsed, bytes: msg.bytes } : {})));
      case "os-stopped": await onStopped(msg); return reply(true);
      case "os-progress": return reply(await setState({ upload: { pct: msg.pct, loaded: msg.loaded, total: msg.total } }));
      case "os-uploaded": await onUploaded(); return reply(true);
      case "os-ended": { const s = await getState(); if (s.phase === "recording" || s.phase === "paused") await stop(); return reply(true); }
      case "os-error": await setState({ phase: "error", error: msg.message }); await closeOffscreen(); return reply(true);
      default: return reply(null);
    }
  })();
  return true;
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "toggle-recording") return;
  const s = await getState();
  if (s.phase === "recording" || s.phase === "paused") await stop();
  else if (s.phase === "idle" || s.phase === "done") await start({ role: s.role, processId: s.processId, newProcessName: "" });
});

chrome.runtime.onStartup?.addListener(() => chrome.storage.session.remove("state"));
