# WorkLens Recorder — Chrome extension

Record a task from the browser and send it straight to WorkLens, with the role and
process already set. No file handling for the person doing the work.

```
Record → work as usual (any tab, any desktop app) → Stop → the recording is uploaded
to your WorkLens workspace → the process map is built → Open in WorkLens
```

What it adds beyond the upload form on the site:

* **Tab log.** Every tab switch during the recording is logged (site, title, seconds from
  start) and stored with the run (`runs.tab_log`), so the pipeline can tie each step to the
  application that was on screen without asking the model.
* **Pause.** Paused time is cut from the recording, for anything personal.
* **Handoff nudge.** When the recording belongs to a process, the done screen copies the
  process link for the next role.

## Install (unpacked)

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose this
   folder (`apps/extension`).
2. Pin the WorkLens icon. The default workspace is https://worklens-iota.vercel.app; change it
   under *Workspace* at the bottom of the popup (a local `npm run dev` on port 3000 works too).
3. Click **Start recording**. Chrome shows its own picker: the entire screen (desktop apps
   included), a window or the current tab. Shortcut: Alt+Shift+R to start or stop.

## How it is built

| File | Role |
| --- | --- |
| `background.js` | Service worker: state machine (idle → recording ⇄ paused → uploading → done), tab log, badge, and the three API calls (`POST /api/runs`, `PUT` to the signed upload URL via the offscreen page, `POST /api/runs/:id/start`, plus `POST /api/runs/:id/tablog`). |
| `offscreen.js` | Offscreen document that owns the `MediaRecorder` on the stream the user picked (VP9 WebM, 10 fps, ~2.5 Mbit/s) and uploads the file with progress. A service worker cannot hold a media stream, hence the offscreen page. |
| `popup.*` | The four screens: Ready, Recording, Sending, Run started. Reads state from the worker; every button is a command. |

Permissions: `desktopCapture` (the picker), `offscreen`, `tabs` (titles and URLs for the log), `storage`;
host access to the WorkLens site and Supabase storage for the upload.

Not in the Chrome Web Store (hackathon build); load it unpacked.
