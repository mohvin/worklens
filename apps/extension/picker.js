// Tiny extension page whose only job is to own Chrome's screen picker.
// desktopCapture.chooseDesktopMedia needs a visible extension page to attach the
// picker to; called from the service worker it returns nothing. No targetTab, so
// the stream id is usable by the extension's own offscreen page.
chrome.desktopCapture.chooseDesktopMedia(["screen", "window", "tab"], (streamId) => {
  chrome.runtime.sendMessage({ type: "picked", streamId: streamId || "" }).catch(() => {}).finally(() => window.close());
});
