"""Run directory layout and persistence.

runs/<run_id>/
  run.json        the Run model, rewritten after every stage
  frames/         sampled JPEGs
  cache/          model responses keyed by content hash (replay without API calls)
"""
from __future__ import annotations

import json
import secrets
from pathlib import Path

from .models import Run


class RunStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def new_run(self, source: Path, run_id: str | None = None) -> tuple[Run, Path]:
        run_id = run_id or secrets.token_hex(4)
        run_dir = self.root / run_id
        (run_dir / "frames").mkdir(parents=True)
        (run_dir / "cache").mkdir()
        run = Run(id=run_id, source=source.name)
        self.save(run)
        return run, run_dir

    def dir(self, run_id: str) -> Path:
        return self.root / run_id

    def load(self, run_id: str) -> Run:
        return Run.model_validate_json((self.dir(run_id) / "run.json").read_text())

    def save(self, run: Run) -> None:
        path = self.dir(run.id) / "run.json"
        path.write_text(json.dumps(run.model_dump(), indent=2))
