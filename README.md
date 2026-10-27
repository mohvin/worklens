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
   │  2. detect      step boundaries: pixel-diff on all frames (SAM 3.1 region-change detector: in progress)
   ▼
steps
   │  3. label       Meta Muse Spark reads the first, last and next frame of each step
   ▼                  and returns {application, action, object, data_fields, confidence} as strict JSON
labelled steps
   │  4. build       deterministic: merge repeats, order, sum durations        (next)
   │  5. rules       long step, loop, app-switch with copy-paste               (next)
   ▼
process map + findings + JSON / BPMN export                                    (next)
```

### Which Meta model does what

| Model | Stage | Role |
| --- | --- | --- |
| **Muse Spark 1.3** (multimodal) | label | Looks at three frames per step and names the application, action, object and data fields. Strict JSON schema, temperature 0, low reasoning effort, one retry with a bigger token budget. |
| **SAM 3.1** | detect | Segments each kept frame into UI regions; a change in the region set marks a step boundary. Adapter is stubbed in `detect.py` pending Meta Model API access; the pixel-diff detector is the shipped fallback. |

Every model call is cached on disk by content hash, so a run can be replayed with zero API calls, and recorded with tokens, latency and cost in `run.json`.

## Run it

Requirements: Python 3.11+, ffmpeg.

```bash
cp .env.example .env            # add your key (OpenRouter or Meta Model API)
pip install -e services/worker
python samples/make_synthetic.py            # builds samples/synthetic-invoice.mp4 (no real data)
worklens run samples/synthetic-invoice.mp4  # ~12 model calls, about $0.09
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

`worklens run recording.mp4 --no-label` runs sampling and detection only. Tests: `cd services/worker && pytest`.

## Layout

```
apps/web/            Next.js UI (next)
services/worker/     pipeline: sample -> detect -> label -> build -> rules -> export
packages/schema/     run.schema.json, the contract for the export (worklens schema)
samples/             synthetic recording generator; no real data
docs/                architecture and judging notes
```

## Licence

MIT. Copyright 2026 PurpleAI Labs Ltd.
