# WorkLens web

The findings view: timeline strip, process map, evidence frames and findings, rendered straight from a worker run (`runs/<id>/run.json` and `frames/`).

```bash
npm install
npm run dev            # http://localhost:3000, reads ../../runs by default
WORKLENS_RUNS_DIR=/path/to/runs npm run dev
```

Routes

- `/` lists runs; `/runs/<id>` is the findings view
- `/api/runs/<id>/frames/<file>` serves a sampled frame
- `/api/runs/<id>/export?format=bpmn|json` downloads the run

No database yet: the page is a pure render of `run.json`, which is the contract in `packages/schema/run.schema.json`.
