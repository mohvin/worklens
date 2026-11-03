// Recorder window. Owns Chrome's screen picker AND the MediaRecorder (offscreen.js,
// loaded in this page): a desktop stream id can only be consumed by the frame that
// asked for it, so picking and recording live in the same page. The background
// worker minimises this window once the capture runs and closes it when done.
chrome.desktopCapture.chooseDesktopMedia(["screen", "window", "tab"], (streamId) => {
  if (!streamId) { chrome.runtime.sendMessage({ type: "picked", streamId: "" }).catch(() => {}); return; }
  document.getElementById("h").textContent = "Recording";
  document.getElementById("p").innerHTML = "Keep this window open (it minimises itself). Stop from the WorkLens icon or <b>Alt+Shift+R</b>.";
  chrome.runtime.sendMessage({ type: "picked", streamId }).catch(() => {});
});
