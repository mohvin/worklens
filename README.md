# WorkLens

**Record how work actually happens. WorkLens watches the screen and hands you the process, the timings and where it breaks.**

Process mining today needs system logs. Most work happens on screens nobody logs: mail, PDFs, an ERP form, a spreadsheet. WorkLens takes a screen recording of someone doing a task and turns it into a process map with step durations and bottlenecks, using Meta's models to understand what is on screen.

Built for the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon), Oct 26 to Nov 4 2026, Startup track, by [PurpleAI Labs](https://purplelab.ai). All code in this repository was written during the hackathon window.

## How it works

```
recording.mp4
   │  1. sample      ffmpeg, 1 frame/s, perceptual-hash + pixel de-dupe (60-80% of frames dropped)
   ▼
frames/
   │  2. detect      step boundaries by pixel-diff; at each one, Meta SAM 3.1 is prompted with the changed area
   │                 and returns the exact UI element that changed (the dialog, the form, the opened email)
   ▼
steps
   │  3. label       Meta Muse Spark reads the first, last and next frame of each step
   ▼                  and returns {application, action, object, data_fields, confidence} as strict JSON
labelled steps
   │  4. build       deterministic, no model: same screen merged into one node, visits counted,
   │                 durations summed, transitions become edges
   │  5. rules       three rules, no model: long step (>20% of the run), loop (screen seen again),
   │                 app switch with the same values on both sides (hand re-keying)
   ▼
process map + findings with evidence frames + JSON / BPMN 2.0 export
```

### Which Meta model does what

| Model | Stage | Role |
| --- | --- | --- |
| **Muse Spark 1.3** (multimodal) | label | Looks at three frames per step, plus the SAM close-up of what changed, and names the application, action, object and data fields. Strict JSON schema, temperature 0, low reasoning effort, one retry with a bigger token budget. |
| **SAM 3.1** | detect | At every step boundary, pixel-diff locates where the new frame differs; SAM 3.1 is prompted with that box (visual prompt) and returns the precise UI element that changed. The element's box is stored on the boundary, cropped as an extra image for Muse Spark, and outlined in the UI with a close-up. A change covering half the screen is a screen switch and needs no call. We tried SAM with noun-phrase prompts first ("input field", "button", "table row"): it works on forms but finds nothing on a real Gmail screen except icons (`scripts/sam_sweep.py`), so the visual-prompt design is the one that ships. |

Every model call is cached on disk, keyed by the prompt and a perceptual fingerprint of the frames (so the cache survives re-extracting the video on another machine), and recorded with tokens, latency and cost in `run.json`. A complete run of the sample recording is checked in under `samples/runs/synthetic-invoice/`, so the pipeline and the UI can be replayed with zero API calls:

```bash
worklens run samples/synthetic-invoice.mp4 --cache samples/runs/synthetic-invoice/cache   # 12 cached, $0.0000
```

## Run it

Requirements: Python 3.11+, ffmpeg.

```bash
cp .env.example .env            # add MODEL_API_KEY (Meta Model API); OPENROUTER_API_KEY works as a fallback
pip install -e services/worker
python samples/make_synthetic.py            # builds samples/synthetic-invoice.mp4 (no real data)
worklens run samples/synthetic-invoice.mp4  # 11 SAM calls + 12 Muse Spark calls
```

Output for the synthetic recording (95 s, 12 steps, one long wait, one loop back to Mail):

```
 0    0.0s   4.0s  Mail                     select invoice email            INV-20481
 1    4.0s   2.0s  Mail                     open invoice email              INV-20481
 2    6.0s   6.0s  Mail                     open attachment                 invoice-20481.pdf
 3   12.0s   8.0s  PDF Viewer               read invoice PDF                INV-20481
 4   20.0s  21.0s  ERP - Accounts Payable   wait for invoice form to load   invoice form
 5   41.0s  17.0s  ERP - Accounts Payable   fill invoice form               INV-20481
 6   58.0s   9.0s  Sheets                   check PO in register            PO-7731
 7   67.0s  13.0s  ERP - Accounts Payable   fill invoice form and submit    INV-20481
 8   80.0s   3.0s  Mail                     select invoice email            INV-20481
 9   83.0s   2.0s  Mail                     click Reply                     Invoice INV-20481
10   85.0s   6.0s  Mail                     send approval reply             Invoice INV-20481
11   91.0s   4.0s  Mail                     verify approval reply           Invoice INV-20481
```

Then the graph and the findings, from the same run (no model calls; `worklens rebuild <run_id>` recomputes them):

```
process map
  n1      7.0s    7%  Mail                       select invoice email  2x
  n2      2.0s    2%  Mail                       open invoice email
  n3      6.0s    6%  Mail                       open attachment
  n4      8.0s    8%  PDF Viewer                 read invoice PDF
  n5     21.0s   22%  ERP - Accounts Payable     wait for invoice form to load  wait
  n6     17.0s   18%  ERP - Accounts Payable     fill invoice form
  n7      9.0s    9%  Sheets                     check PO in register
  n8     13.0s   14%  ERP - Accounts Payable     fill invoice form and submit
  n9      2.0s    2%  Mail                       click Reply
  n10     6.0s    6%  Mail                       send approval reply
  n11     4.0s    4%  Mail                       verify approval reply
  n1 -> n2 ... n8 -> n1  (the loop)  n1 -> n9 ...

findings
  [high  ] app-switch-copy  Values re-keyed from PDF Viewer into ERP - Accounts Payable
           1 switch with the same values on both screens (4,250.00, Acme Supplies, INV-20481, PO-7731).
           17 s spent keying data that already exists in PDF Viewer.
  [high  ] loop             Back to Mail 2 times
           The user left Mail and came back 1 time; the return trip cost 15 s (16%).
           Detour via PDF Viewer -> ERP - Accounts Payable -> Sheets -> ERP - Accounts Payable.
  [medium] long-step        21 s waiting on ERP - Accounts Payable
           Step 4 took 21 s, 22% of the recording. The user was waiting for the system, not working.
  [medium] app-switch-copy  Values cross-checked by hand between ERP - Accounts Payable and Sheets
```

Every finding carries `step_indexes`, `evidence_frames` (frame numbers to show as thumbnails) and `node_ids` (graph nodes to highlight), so the findings view is a pure render of `run.json`.

```bash
worklens run recording.mp4 --no-label     # sampling and detection only, no model calls
worklens show <run_id>                    # steps, process map, findings
worklens export <run_id> --format bpmn    # BPMN 2.0 XML with diagram layout; opens in bpmn.io with no warnings
worklens export <run_id> --format json    # the Run, validated by packages/schema/run.schema.json
```

### The findings view

```bash
cd apps/web && npm install && npm run dev     # http://localhost:3000, reads ./runs
```

The deployed site serves the checked-in replay run with no backend (`scripts/sync-samples.mjs` bundles `samples/runs/*` at build time) and, when configured, accepts uploads: the browser puts the recording in Supabase storage, a Modal CPU container runs the pipeline and writes progress to the run record, and the page polls until the findings view is ready. See `docs/deploy.md`.

One page per run: the recording as a timeline strip (colour = application, hatched = waiting, braces = findings), the process map with the loop drawn as a back-edge, the frames behind any box you click, and the top 3 findings with their evidence frames. Download BPMN / JSON from the header.

Tests: `cd services/worker && pytest` (25 tests, all offline: the graph, rules and export tests use the cached labels in `tests/fixtures`).

## Layout

```
apps/web/            Next.js 15: upload, run progress, findings view (timeline, process map, evidence frames, findings, export)
services/worker/     pipeline: sample -> detect (SAM 3.1) -> label (Muse Spark) -> build -> rules -> export; modal_app.py hosts it
packages/schema/     run.schema.json, the contract for the export (worklens schema)
samples/             synthetic recording generator and samples/runs/, the checked-in replay run (frames, labels, model cache)
docs/                deploy.md (Vercel + Supabase + Modal)
```

## Licence

MIT. Copyright 2026 PurpleAI Labs Ltd.
