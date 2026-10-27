# Replay runs

A complete WorkLens run checked in so the findings view and the demo work with zero API calls.

```
synthetic-invoice/
  run.json     the Run (steps, labels, graph, findings, model-call log) for samples/synthetic-invoice.mp4
  run.bpmn     the BPMN 2.0 export
  frames/      only the frames the page shows: kept after de-dupe, plus evidence frames
  cache/       Muse Spark responses keyed by content hash; copy into runs/<id>/cache to replay
```

To replay the labelling without spending credits, run the pipeline with the cache in place:

```bash
worklens run samples/synthetic-invoice.mp4 --cache samples/runs/synthetic-invoice/cache
```

Every step is served from the cache (`12 cached, $0.0000` in the output). The cache key covers the frame bytes and the prompt, so a change to either triggers a real call for that step only.

The web app bundles this directory at build time (`apps/web/scripts/sync-samples.mjs`), which is what the deployed demo serves.
