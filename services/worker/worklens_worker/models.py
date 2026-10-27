"""Data contract for a WorkLens run.

Every pipeline stage reads and writes these models, and the JSON export is
exactly `Run.model_dump()`. Keep this file in sync with packages/schema/run.schema.json
(regenerate with `worklens schema`).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Frame(BaseModel):
    index: int = Field(description="Position in the sampled sequence, 0-based")
    t: float = Field(description="Seconds from the start of the recording")
    path: str = Field(description="Path of the JPEG relative to the run directory")
    phash: str = Field(description="Perceptual hash, hex")
    kept: bool = Field(default=True, description="False when dropped as a near-duplicate")


class Boundary(BaseModel):
    """A change of screen state that starts a new step."""

    index: int
    t: float
    frame_before: int = Field(description="Index of the last frame of the previous state")
    frame_after: int = Field(description="Index of the first frame of the new state")
    score: float = Field(description="How different the two frames are, 0..1")
    method: Literal["pixel-diff", "sam-3.1"] = "pixel-diff"


class StepLabel(BaseModel):
    """What Muse Spark says happened in one step."""

    application: str
    action: str
    object: str
    data_fields: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)


class Step(BaseModel):
    index: int
    t_start: float
    t_end: float
    duration: float
    frame_start: int
    frame_end: int
    label: StepLabel | None = None
    label_error: str | None = None


class ModelCall(BaseModel):
    """One request to a Meta model, for the cost log and the replay cache."""

    stage: Literal["label", "segment"]
    model: str
    cache_key: str
    cached: bool
    latency_s: float
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    ok: bool = True
    error: str | None = None


class Node(BaseModel):
    id: str
    application: str
    action: str
    object: str
    visits: int
    total_duration: float
    step_indexes: list[int]


class Edge(BaseModel):
    source: str
    target: str
    count: int


class Graph(BaseModel):
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)


class Finding(BaseModel):
    rule: Literal["long-step", "loop", "app-switch-copy"]
    title: str
    detail: str
    severity: Literal["low", "medium", "high"]
    step_indexes: list[int]
    evidence_frames: list[int]


class Run(BaseModel):
    id: str
    source: str = Field(description="Recording file name")
    duration: float = 0.0
    fps_sampled: float = 1.0
    status: Literal["created", "sampled", "detected", "labelled", "built", "failed"] = "created"
    frames: list[Frame] = Field(default_factory=list)
    boundaries: list[Boundary] = Field(default_factory=list)
    steps: list[Step] = Field(default_factory=list)
    graph: Graph = Field(default_factory=Graph)
    findings: list[Finding] = Field(default_factory=list)
    model_calls: list[ModelCall] = Field(default_factory=list)

    @property
    def total_cost_usd(self) -> float:
        return round(sum(c.cost_usd for c in self.model_calls), 6)
