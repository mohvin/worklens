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
    score: float = Field(description="How different the two frames are, 0..1 (pixel-diff)")
    method: Literal["pixel-diff"] = "pixel-diff"
    changed_fraction: float = Field(default=0.0, description="Fraction of the screen that changed at this boundary, 0..1")
    change_box: list[int] | None = Field(default=None, description="x1,y1,x2,y2 of the UI element that changed, from SAM 3.1; None for a full-screen change")


class Region(BaseModel):
    """A UI region SAM 3.1 segmented on a frame."""

    frame: int
    kind: Literal["changed element", "screen change"] = Field(description="changed element: SAM-refined box of what changed; screen change: most of the screen changed")
    x1: int
    y1: int
    x2: int
    y2: int
    confidence: float


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

    stage: Literal["label", "segment", "recommend"]
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
    avg_duration: float = 0.0
    share: float = Field(default=0.0, description="Fraction of the recording spent on this node, 0..1")
    is_wait: bool = Field(default=False, description="The action is waiting on the system, not working")


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
    node_ids: list[str] = Field(default_factory=list, description="Graph nodes to highlight")
    seconds: float = Field(default=0.0, description="Time attributable to the finding")
    share: float = Field(default=0.0, description="seconds / total recording time")


class Summary(BaseModel):
    total_duration: float = 0.0
    steps: int = 0
    labelled_steps: int = 0
    applications: list[str] = Field(default_factory=list)
    app_switches: int = 0
    loops: int = 0
    wait_duration: float = 0.0
    longest_step_index: int | None = None


class Run(BaseModel):
    id: str
    source: str = Field(description="Recording file name")
    duration: float = 0.0
    fps_sampled: float = 1.0
    frame_width: int = Field(default=0, description="Pixel size of the sampled frames; region boxes use this space")
    frame_height: int = 0
    status: Literal["created", "sampled", "detected", "labelled", "built", "failed"] = "created"
    frames: list[Frame] = Field(default_factory=list)
    boundaries: list[Boundary] = Field(default_factory=list)
    regions: list[Region] = Field(default_factory=list, description="What changed at each boundary, segmented by SAM 3.1")
    steps: list[Step] = Field(default_factory=list)
    graph: Graph = Field(default_factory=Graph)
    summary: Summary = Field(default_factory=Summary)
    findings: list[Finding] = Field(default_factory=list)
    model_calls: list[ModelCall] = Field(default_factory=list)

    @property
    def total_cost_usd(self) -> float:
        return round(sum(c.cost_usd for c in self.model_calls), 6)


# ---- a process: several recordings, one per role, joined by handoffs ----


class Recording(BaseModel):
    """One recording inside a process, in handoff order."""

    index: int
    run_id: str
    role: str = Field(description="Who recorded it, as typed at upload: 'AP clerk', 'Approver'")
    source: str
    duration: float
    steps: int
    findings: int


class Ref(BaseModel):
    """A step in one of the process's recordings."""

    rec: int
    step: int
    node_id: str = ""


class FrameRef(BaseModel):
    rec: int
    frame: int


class Handoff(BaseModel):
    """Where one role's recording ends and the next one begins."""

    from_ref: Ref
    to_ref: Ref
    via: str = Field(description="Application the work was handed over in, e.g. Mail")
    object: str = Field(default="", description="A value seen on both sides, e.g. an invoice number")
    matched: bool = Field(default=False, description="True when the same values were seen on both sides; False when only the order of recordings joins them")


class ProcessFinding(BaseModel):
    rule: Literal["cross-check", "cross-rekey", "handoff-detour"]
    title: str
    detail: str
    severity: Literal["low", "medium", "high"]
    refs: list[Ref]
    evidence: list[FrameRef] = Field(default_factory=list)
    seconds: float = 0.0
    share: float = Field(default=0.0, description="seconds / total time of all recordings")


class ProcessSummary(BaseModel):
    total_duration: float = 0.0
    wait_duration: float = 0.0
    steps: int = 0
    applications: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    app_switches: int = 0
    loops: int = 0
    handoffs: int = 0
    run_findings: int = 0


class Process(BaseModel):
    id: str
    name: str
    status: Literal["created", "building", "built", "failed"] = "created"
    recordings: list[Recording] = Field(default_factory=list)
    handoffs: list[Handoff] = Field(default_factory=list)
    findings: list[ProcessFinding] = Field(default_factory=list, description="Findings across roles; each recording keeps its own findings in its Run")
    summary: ProcessSummary = Field(default_factory=ProcessSummary)


# ---- recommendations: fix the process (rules) and apply AI (model-classified, rule-costed) ----

Mechanism = Literal[
    "document_extraction", "lookup_validation", "prefill", "drafting", "in_app_approval",
    "notification", "straight_through", "remove_step", "merge_steps", "reorder",
]
Disposition = Literal["keep", "automate", "assist", "remove"]


class StepSaving(BaseModel):
    """How much of one step a recommendation takes away, after overlaps with higher-value items."""

    ref: Ref
    seconds_before: float
    seconds_raw: float = Field(description="What this item alone would save on the step")
    seconds_counted: float = Field(description="What is counted after earlier items took their share")


class Recommendation(BaseModel):
    id: str
    path: Literal["fix", "ai"]
    kind: Literal["remove", "merge", "move", "automate", "assist", "keep_human"]
    mechanism: Mechanism | None = None
    title: str
    detail: str = Field(description="What to change")
    rationale: str = Field(description="Why, with the evidence")
    refs: list[Ref] = Field(default_factory=list, description="Steps the recommendation applies to")
    finding_keys: list[str] = Field(default_factory=list, description="Findings it resolves: 'r0:f1' (run 0, finding 1) or 'p:f0' (process)")
    evidence: list[FrameRef] = Field(default_factory=list)
    seconds_saved: float = Field(default=0.0, description="Counted saving after overlaps, per run of the process")
    seconds_raw: float = Field(default=0.0, description="Saving before overlaps")
    potential_seconds: float = Field(default=0.0, description="Upper bound when the saving is not counted (low confidence)")
    method: str = Field(default="", description="How the number was made, e.g. '(C3 8 s + C5 17 s) x 0.8 = 20 s'")
    share_saved: float = 0.0
    confidence: Literal["high", "medium", "low"] = "medium"
    factor: float | None = Field(default=None, description="Automation factor applied to the steps' durations")
    savings: list[StepSaving] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    stays_human: str | None = None
    guardrail: str | None = None
    data_needed: list[str] = Field(default_factory=list)
    status: Literal["proposed", "accepted", "rejected", "done"] = "proposed"
    decided_by: str | None = None
    decided_at: str | None = None
    note: str | None = None
    source: Literal["rule", "model"] = "rule"
    model: str | None = None
    prompt_version: str | None = None


class TargetStep(BaseModel):
    ref: Ref
    application: str
    action: str
    disposition: Disposition = "keep"
    recommendation_ids: list[str] = Field(default_factory=list)
    seconds_before: float
    seconds_after: float


class Target(BaseModel):
    applied: Literal["proposed", "accepted"] = Field(default="proposed", description="proposed: every item not rejected; accepted: accepted and done only")
    steps: list[TargetStep] = Field(default_factory=list)
    seconds_before: float = 0.0
    seconds_after: float = 0.0
    steps_before: int = 0
    steps_after: int = 0
    app_switches_before: int = 0
    app_switches_after: int = 0
    handoffs_before: int = 0
    handoffs_after: int = 0
    handoff_in_app: bool = False
    human_decisions_kept: int = 0


class AIClassification(BaseModel):
    """What the model said about one screen; kept so the numbers can be recomputed without a new call."""

    key: str = Field(description="r<rec>:<node id>")
    disposition: Literal["automate", "assist", "keep_human"]
    mechanism: Mechanism | None = None
    rationale: str = ""
    stays_human: str = ""
    guardrail: str = ""
    data_needed: list[str] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"] = "medium"


class RecommendationsSummary(BaseModel):
    total_seconds: float = 0.0
    fix_seconds: float = 0.0
    ai_seconds: float = 0.0
    counted_seconds: float = 0.0
    share: float = 0.0
    proposed: int = 0
    accepted: int = 0
    rejected: int = 0
    done: int = 0
    ai_unavailable: str | None = Field(default=None, description="Why the AI path has no model items, when it has none")


class Recommendations(BaseModel):
    version: str = "rec-v1"
    generated_at: str
    rules_version: str = "v3"
    model: str | None = None
    prompt_version: str | None = None
    factors: dict[str, float] = Field(default_factory=dict)
    items: list[Recommendation] = Field(default_factory=list)
    classification: list[AIClassification] = Field(default_factory=list)
    target: Target = Field(default_factory=Target)
    target_accepted: Target = Field(default_factory=Target)
    summary: RecommendationsSummary = Field(default_factory=RecommendationsSummary)
