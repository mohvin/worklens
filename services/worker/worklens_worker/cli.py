"""WorkLens command line.

    worklens run samples/synthetic-invoice.mp4          # all stages
    worklens run recording.mp4 --no-label                # stop before model calls
    worklens show <run_id>                               # print the steps
    worklens schema                                      # write packages/schema/run.schema.json
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import typer
from dotenv import load_dotenv

from .detect import detect
from .label import label
from .llm import LLMClient, LLMConfig
from .models import Run
from .sample import kept_frames, sample
from .store import RunStore

app = typer.Typer(add_completion=False, no_args_is_help=True)

REPO_ROOT = Path(__file__).resolve().parents[3]


def _store(runs_dir: Path | None) -> RunStore:
    return RunStore(runs_dir or Path(os.environ.get("WORKLENS_RUNS_DIR", REPO_ROOT / "runs")))


def _load_env() -> None:
    load_dotenv(REPO_ROOT / ".env")


@app.command()
def run(
    video: Path = typer.Argument(..., exists=True, readable=True),
    runs_dir: Path | None = typer.Option(None, help="Where run directories go (default: ./runs)"),
    fps: float = typer.Option(1.0, help="Frames sampled per second"),
    do_label: bool = typer.Option(True, "--label/--no-label", help="Call the Meta model to label steps"),
    workers: int = typer.Option(4, help="Parallel model calls"),
) -> None:
    """Run the pipeline on a screen recording."""
    _load_env()
    store = _store(runs_dir)
    r, run_dir = store.new_run(video)
    typer.echo(f"run {r.id} -> {run_dir}")

    r = sample(r, run_dir, video, fps=fps)
    store.save(r)
    typer.echo(f"sampled {len(r.frames)} frames, kept {len(kept_frames(r))} after de-dupe ({r.duration:.0f}s)")

    r = detect(r, run_dir)
    store.save(r)
    typer.echo(f"detected {len(r.boundaries)} boundaries -> {len(r.steps)} steps")

    if do_label:
        client = LLMClient(LLMConfig.from_env(), run_dir / "cache")
        r = label(r, run_dir, client, workers=workers)
        store.save(r)
        ok = sum(1 for s in r.steps if s.label)
        fresh = [c for c in r.model_calls if not c.cached]
        typer.echo(
            f"labelled {ok}/{len(r.steps)} steps with {client.cfg.model}: "
            f"{len(fresh)} API calls, {len(r.model_calls) - len(fresh)} cached, ${r.total_cost_usd:.4f}"
        )
    _print_steps(r)


@app.command()
def show(run_id: str, runs_dir: Path | None = typer.Option(None)) -> None:
    """Print the steps of a run."""
    _print_steps(_store(runs_dir).load(run_id))


@app.command()
def schema() -> None:
    """Write the JSON schema of a Run to packages/schema/run.schema.json."""
    out = REPO_ROOT / "packages" / "schema" / "run.schema.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(Run.model_json_schema(), indent=2))
    typer.echo(f"wrote {out}")


def _print_steps(r: Run) -> None:
    for s in r.steps:
        if s.label:
            lab = f"{s.label.application:<32} {s.label.action:<36} {s.label.object}  ({s.label.confidence:.2f})"
        else:
            lab = f"[unlabelled] {s.label_error or ''}"
        typer.echo(f"{s.index:2d} {s.t_start:6.1f}s {s.duration:5.1f}s  {lab}")


if __name__ == "__main__":
    app()
