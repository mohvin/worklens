"""WorkLens hosted worker on Modal.

    cd services/worker
    modal secret create worklens MODEL_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... WORKLENS_WORKER_SECRET=...
    modal deploy modal_app.py            # prints the enqueue URL for the web app (WORKLENS_WORKER_URL)

The web app uploads the recording to Supabase storage (uploads/<id>/<file>),
inserts a runs row, then POSTs {"run_id", "secret"} to the enqueue endpoint.
process_run downloads the file, runs the pipeline, writes progress to the row
after every stage, and publishes run.json, run.bpmn and the needed frames to
the "runs" bucket. CPU only: ffmpeg plus two Meta API clients.
"""
from __future__ import annotations

import os
import tempfile
import traceback
from pathlib import Path

import modal

app = modal.App("worklens")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install(
        "pillow>=10", "imagehash>=4.3", "numpy>=1.26", "httpx>=0.27",
        "python-dotenv>=1.0", "pydantic>=2.7", "typer>=0.12", "fastapi[standard]>=0.115",
    )
    .add_local_python_source("worklens_worker")
)
secrets = [modal.Secret.from_name("worklens")]


@app.function(image=image, secrets=secrets, timeout=3600, cpu=2.0, memory=4096)
def process_run(run_id: str) -> dict:
    from worklens_worker.export import to_bpmn
    from worklens_worker.models import Run
    from worklens_worker.pipeline import frames_to_publish, run_pipeline
    from worklens_worker.store import RunStore
    from worklens_worker.supabase import Supabase

    sb = Supabase.from_env()
    row = sb.get_run(run_id)
    if row is None:
        return {"error": "no such run"}
    log: list[str] = []

    def progress(stage: str, run: Run, line: str) -> None:
        log.append(line)
        next_status = {"sampling": "detecting", "detecting": "labelling", "labelling": "building", "building": "building"}[stage]
        sb.update_run(
            run_id,
            status=next_status,
            progress={
                "frames": len(run.frames), "kept": sum(1 for f in run.frames if f.kept),
                "boundaries": len(run.boundaries), "steps": len(run.steps),
                "labelled": sum(1 for s in run.steps if s.label), "calls": len(run.model_calls),
                "log": log,
            },
            cost_usd=run.total_cost_usd,
        )

    try:
        sb.update_run(run_id, status="sampling", error=None)
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / row["source"]
            video.write_bytes(sb.download("uploads", f"{run_id}/{row['source']}"))
            store = RunStore(Path(tmp) / "runs")
            run, run_dir = store.new_run(video, run_id=run_id)
            run = run_pipeline(run, run_dir, video, store, progress=progress)

            publish = frames_to_publish(run)
            for i in publish:
                f = run.frames[i]
                sb.upload("runs", f"{run_id}/{f.path}", (run_dir / f.path).read_bytes(), "image/jpeg")
            sb.upload("runs", f"{run_id}/run.bpmn", to_bpmn(run).encode(), "application/xml")
            sb.update_run(
                run_id,
                status="built",
                run_json=run.model_dump(),
                cost_usd=run.total_cost_usd,
                progress={
                    "frames": len(run.frames), "kept": sum(1 for f in run.frames if f.kept),
                    "boundaries": len(run.boundaries), "steps": len(run.steps),
                    "labelled": sum(1 for s in run.steps if s.label), "calls": len(run.model_calls),
                    "frames_available": publish, "log": log,
                },
            )
            if row.get("process_id"):
                build_process_job.spawn(row["process_id"])
            return {"ok": True, "steps": len(run.steps), "findings": len(run.findings)}
    except Exception as e:  # noqa: BLE001 - report every failure on the run record
        sb.update_run(run_id, status="failed", error=f"{type(e).__name__}: {e}"[:1000], progress={"log": log + [traceback.format_exc()[-2000:]]})
        return {"error": str(e)}


@app.function(image=image, secrets=secrets, timeout=600)
def build_process_job(process_id: str) -> dict:
    """Merge the built runs of a process (in position order) into process_json. Deterministic, no model calls."""
    from worklens_worker.export import to_process_bpmn
    from worklens_worker.models import Run
    from worklens_worker.process import build_process
    from worklens_worker.supabase import Supabase

    sb = Supabase.from_env()
    row = sb.get_process(process_id)
    if row is None:
        return {"error": "no such process"}
    try:
        sb.update_process(process_id, status="building", error=None)
        rows = [r for r in sb.list_runs(process_id) if r.get("status") == "built" and r.get("run_json")]
        if not rows:
            raise RuntimeError("no built recordings in this process yet")
        runs = [Run.model_validate(r["run_json"]) for r in rows]
        roles = [r.get("role") or f"Recording {i + 1}" for i, r in enumerate(rows)]
        proc = build_process(process_id, row["name"], runs, roles)
        sb.upload("runs", f"processes/{process_id}/process.bpmn", to_process_bpmn(proc, runs).encode(), "application/xml")
        sb.update_process(process_id, status="built", process_json=proc.model_dump())
        return {"ok": True, "recordings": len(runs), "findings": len(proc.findings)}
    except Exception as e:  # noqa: BLE001
        sb.update_process(process_id, status="failed", error=f"{type(e).__name__}: {e}"[:1000])
        return {"error": str(e)}


@app.function(image=image, secrets=secrets)
@modal.fastapi_endpoint(method="POST")
def enqueue(body: dict) -> dict:
    """POST {"run_id": "...", "secret": "..."} to process a recording, or {"process_id": "...", "secret": "..."} to merge a process."""
    if not body.get("secret") or body["secret"] != os.environ.get("WORKLENS_WORKER_SECRET"):
        return {"error": "unauthorised"}
    process_id = str(body.get("process_id", ""))
    if process_id:
        call = build_process_job.spawn(process_id)
        return {"ok": True, "call_id": call.object_id}
    run_id = str(body.get("run_id", ""))
    if not run_id:
        return {"error": "run_id or process_id required"}
    call = process_run.spawn(run_id)
    return {"ok": True, "call_id": call.object_id}
