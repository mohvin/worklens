// WorkLens Recorder — background service worker.
//
// Owns the recording state, the tab log and the toolbar badge. The screen
// capture itself lives in the offscreen page (offscreen.js), because a service
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
async function setState(patch) {
  const s = await getState();
  const next = { ...s, ...patch };
  await chrome.storage.session.set({ state: next });
  await badge(next);
  chrome.runtime.sendMessage({ type: "state", state: next }).catch(() => {});
  return next;
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

// ---------- offscreen page ----------
async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA", "DISPLAY_MEDIA"],
    justification: "Hold the screen capture and upload the recording while the popup is closed.",
  });
}
async function closeOffscreen() { try { if (await chrome.offscreen.hasDocument?.()) await chrome.offscreen.closeDocument(); } catch {} }
const toOffscreen = (msg) => chrome.runtime.sendMessage({ target: "offscreen", ...msg }).catch(() => {});

// ---------- tab log: which site is on screen, and when ----------
function host(url) { try { const u = new URL(url); return u.protocol.startsWith("http") ? u.host.replace(/^www\./, "") : ""; } catch { return ""; } }
async function logActiveTab(reason) {
  const s = await getState();
  if (s.phase !== "recording") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  const entry = { t: Math.round(s.elapsed / 1000), host: host(tab.url || ""), title: (tab.title || "").slice(0, 120), reason };
  const last = s.tabLog[s.tabLog.length - 1];
  if (last && last.host === entry.host && last.title === entry.title) return;
  const tabLog = [...s.tabLog, entry].slice(-500);
  await setState({ tabLog, current: entry });
}
chrome.tabs.onActivated.addListener(() => logActiveTab("switch"));
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
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await ensureOffscreen();
  const streamId = await new Promise((resolve) => chrome.desktopCapture.chooseDesktopMedia(["screen", "window", "tab"], tab, (id) => resolve(id)));
  if (!streamId) { await closeOffscreen(); return setState({ ...INITIAL, base: s.base, role, processId, newProcessName }); }
  await setState({ ...INITIAL, base: s.base, phase: "recording", role, processId, newProcessName, startedAt: Date.now(), tabLog: [], current: null });
  await toOffscreen({ type: "os-start", streamId });
  await logActiveTab("start");
  return getState();
}

async function stop() {
  const s = await getState();
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
async function onStopped({ size, type }) {
  const s = await getState();
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
      case "pause": await toOffscreen({ type: "os-pause" }); return reply(await setState({ phase: "paused" }));
      case "resume": await toOffscreen({ type: "os-resume" }); return reply(await setState({ phase: "recording" }));
      case "stop": return reply(await stop());
      case "discard": return reply(await discard());
      case "reset": { const s = await getState(); return reply(await setState({ ...INITIAL, base: s.base, role: s.role, processId: s.processId })); }
      case "set-base": { await chrome.storage.sync.set({ base: (msg.base || DEFAULT_BASE).replace(/\/$/, "") }); return reply(await getState()); }
      // from the offscreen page
      case "os-tick": return reply(await setState({ elapsed: msg.elapsed, bytes: msg.bytes }));
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
