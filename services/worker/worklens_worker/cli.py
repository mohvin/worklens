"""WorkLens command line.

    worklens run samples/synthetic-invoice.mp4          # all stages
    worklens run recording.mp4 --no-label                # stop before model calls
    worklens run samples/synthetic-invoice.mp4 --cache samples/runs/synthetic-invoice/cache   # replay, $0
    worklens show <run_id>                               # print steps, graph and findings
    worklens export <run_id> --format bpmn               # write run.bpmn (or run.json) next to run.json
    worklens schema                                      # write packages/schema/run.schema.json
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import typer
from dotenv import load_dotenv

from .export import to_bpmn, to_json
from .graph import build
from .models import Run
from .pipeline import run_pipeline, seed_cache
from .rules import run_rules
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
    cache: Path | None = typer.Option(None, exists=True, file_okay=False, help="Seed the model cache from this directory (replay without API calls)"),
    segment: str = typer.Option("auto", help="sam: SAM 3.1 segments what changed at each boundary; none: skip; auto: sam when MODEL_API_KEY is set"),
) -> None:
    """Run the pipeline on a screen recording."""
    _load_env()
    store = _store(runs_dir)
    r, run_dir = store.new_run(video)
    typer.echo(f"run {r.id} -> {run_dir}")
    if cache:
        typer.echo(f"seeded cache with {seed_cache(run_dir, cache)} responses from {cache}")
    r = run_pipeline(
        r, run_dir, video, store, fps=fps, do_label=do_label, workers=workers, segment=segment,
        progress=lambda stage, run, line: typer.echo(line),
    )
    _print_steps(r)
    _print_graph(r)
    _print_findings(r)


@app.command()
def show(run_id: str, runs_dir: Path | None = typer.Option(None)) -> None:
    """Print the steps, graph and findings of a run."""
    r = _store(runs_dir).load(run_id)
    _print_steps(r)
    _print_graph(r)
    _print_findings(r)


@app.command()
def rebuild(run_id: str, runs_dir: Path | None = typer.Option(None)) -> None:
    """Re-run the graph builder and rules on a saved run (no model calls)."""
    store = _store(runs_dir)
    r = run_rules(build(store.load(run_id)))
    store.save(r)
    (store.dir(run_id) / "run.bpmn").write_text(to_bpmn(r))
    _print_graph(r)
    _print_findings(r)


@app.command()
def export(
    run_id: str,
    fmt: str = typer.Option("bpmn", "--format", help="json or bpmn"),
    out: Path | None = typer.Option(None, help="Output file (default: next to run.json)"),
    runs_dir: Path | None = typer.Option(None),
) -> None:
    """Export a run as JSON or BPMN 2.0 XML."""
    store = _store(runs_dir)
    r = store.load(run_id)
    if fmt not in ("json", "bpmn"):
        raise typer.BadParameter("format must be json or bpmn")
    text = to_json(r) if fmt == "json" else to_bpmn(r)
    out = out or store.dir(run_id) / f"run.{fmt}"
    out.write_text(text)
    typer.echo(f"wrote {out}")


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


def _print_graph(r: Run) -> None:
    if not r.graph.nodes:
        return
    typer.echo("\nprocess map")
    for n in r.graph.nodes:
        flag = "  wait" if n.is_wait else ""
        loop = f"  {n.visits}x" if n.visits > 1 else ""
        typer.echo(f"  {n.id:<4} {n.total_duration:6.1f}s {n.share:5.0%}  {n.application:<26} {n.action}{loop}{flag}")
    for e in r.graph.edges:
        typer.echo(f"  {e.source} -> {e.target}" + (f"  x{e.count}" if e.count > 1 else ""))


def _print_findings(r: Run) -> None:
    if not r.findings:
        return
    typer.echo("\nfindings")
    for f in r.findings:
        typer.echo(f"  [{f.severity:<6}] {f.rule:<16} {f.title}")
        typer.echo(f"           {f.detail}")
        typer.echo(f"           steps {f.step_indexes}  frames {f.evidence_frames}")


if __name__ == "__main__":
    app()
