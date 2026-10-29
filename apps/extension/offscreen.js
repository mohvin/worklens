// WorkLens Recorder — offscreen page.
//
// Holds the screen capture (MediaRecorder on the stream the user picked) and,
// after Stop, uploads the file to the one-off signed URL the background
// worker gets from WorkLens. Reports elapsed time, size and upload progress.

let stream = null, recorder = null, chunks = [], blob = null;
let recStart = 0, pausedAt = 0, pausedTotal = 0, ticker = null, bytes = 0;

const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});
const elapsed = () => (recStart ? (pausedAt ? pausedAt : Date.now()) - recStart - pausedTotal : 0);

async function start(streamId) {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: streamId, maxWidth: 1920, maxHeight: 1200, maxFrameRate: 10 } },
  });
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
  recorder = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 2_500_000 });
  chunks = []; bytes = 0; blob = null; pausedAt = 0; pausedTotal = 0;
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) { chunks.push(e.data); bytes += e.data.size; } };
  recorder.onstop = () => {
    blob = new Blob(chunks, { type: "video/webm" });
    clearInterval(ticker); ticker = null;
    stream?.getTracks().forEach((t) => t.stop());
    send({ type: "os-stopped", size: blob.size, type: "video/webm" });
  };
  stream.getVideoTracks()[0].addEventListener("ended", () => send({ type: "os-ended" }));
  recorder.start(1000);
  recStart = Date.now();
  ticker = setInterval(() => send({ type: "os-tick", elapsed: elapsed(), bytes }), 1000);
}

function pause() { if (recorder?.state === "recording") { recorder.pause(); pausedAt = Date.now(); } }
function resume() { if (recorder?.state === "paused") { recorder.resume(); pausedTotal += Date.now() - pausedAt; pausedAt = 0; } }
function stop() { if (recorder && recorder.state !== "inactive") recorder.stop(); else send({ type: "os-stopped", size: blob?.size ?? 0, type: "video/webm" }); }
function discard() { clearInterval(ticker); ticker = null; try { if (recorder && recorder.state !== "inactive") { recorder.onstop = null; recorder.stop(); } } catch {} stream?.getTracks().forEach((t) => t.stop()); chunks = []; blob = null; }

function upload(uploadUrl, contentType) {
  if (!blob) return send({ type: "os-error", message: "Nothing was recorded." });
  const xhr = new XMLHttpRequest();
  xhr.open("PUT", uploadUrl);
  xhr.setRequestHeader("Content-Type", contentType || "video/webm");
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) send({ type: "os-progress", pct: Math.round((e.loaded / e.total) * 100), loaded: e.loaded, total: e.total }); };
  xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? send({ type: "os-uploaded" }) : send({ type: "os-error", message: `Upload failed (${xhr.status}).` }));
  xhr.onerror = () => send({ type: "os-error", message: "Upload failed: network error." });
  xhr.send(blob);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== "offscreen") return;
  (async () => {
    try {
      switch (msg.type) {
        case "os-start": await start(msg.streamId); break;
        case "os-pause": pause(); break;
        case "os-resume": resume(); break;
        case "os-stop": stop(); break;
        case "os-discard": discard(); break;
        case "os-upload": upload(msg.uploadUrl, msg.contentType); break;
      }
    } catch (e) {
      send({ type: "os-error", message: e?.message || String(e) });
    }
  })();
});
