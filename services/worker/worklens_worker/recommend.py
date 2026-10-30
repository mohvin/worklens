"""Stage 7: recommendations. Path 1 fixes the process; path 2 applies AI.

Deterministic first, model second:

* The fix catalogue turns findings into fixes (rule -> fix -> saving from the
  measured durations -> confidence). No model.
* The AI path asks Muse Spark to classify each screen as automate / assist /
  keep_human with a mechanism from a fixed menu and a rationale (strict JSON).
  The model never produces a number: savings are computed here from the step
  durations and the mechanism's factor. A decision step is never automated.
  If the model is unavailable or answers badly, the fix path still ships and
  the AI path says why it is empty.
* Overlaps are counted once: items are ranked by raw value and each takes
  only what earlier items left on a step. The target process applies them.

Everything points at steps (Ref) and findings, carries a status for review,
and records the model and prompt version that produced it.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from .graph import is_wait, normalise
from .llm import LLMClient, LLMConfig
from .models import (
    AIClassification, Finding, FrameRef, Process, ProcessFinding, Recommendation, Recommendations,
    RecommendationsSummary, Ref, Run, Step, StepSaving, Target, TargetStep,
)

PROMPT_VERSION = "rec-v1"
RULES_VERSION = "v3"

# Automation factors: the share of a step's duration a mechanism removes. Documented assumptions, shown in the UI.
FACTORS: dict[str, float] = {
    "document_extraction": 0.8, "lookup_validation": 0.9, "straight_through": 0.95,
    "prefill": 0.6, "drafting": 0.5, "notification": 0.3, "in_app_approval": 1.0,
    "remove_step": 1.0, "merge_steps": 1.0, "reorder": 0.0,
}
MECHANISMS = tuple(FACTORS.keys())
DECISION_RE = re.compile(r"\b(approve|approves|approval|reject|decide|decision|authori[sz]e|sign off|sign)\b", re.I)
SEV = {"high": 0, "medium": 1, "low": 2}


def recommend_client(cache_dir) -> LLMClient | None:
    """The model client for the AI path: same provider as labelling, a bigger answer budget (one call covers every screen)."""
    try:
        cfg = LLMConfig.from_env()
    except RuntimeError:
        return None
    cfg.max_tokens = max(cfg.max_tokens, 8000)
    cfg.timeout_s = max(cfg.timeout_s, 180.0)
    return LLMClient(cfg, cache_dir, stage="recommend")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _fmt(s: float) -> str:
    return f"{s / 60:.1f} min" if s >= 90 else f"{s:.0f} s"


def _initial(role: str) -> str:
    return "".join(w[0] for w in role.split()).upper() or "R"


def _label(roles: list[str], r: Ref) -> str:
    return f"{_initial(roles[r.rec])}{r.step}" if len(roles) > 1 else f"step {r.step}"


def _node_for(run: Run, step_index: int) -> str:
    for n in run.graph.nodes:
        if step_index in n.step_indexes:
            return n.id
    return ""


def _ref(runs: list[Run], rec: int, step_index: int) -> Ref:
    return Ref(rec=rec, step=step_index, node_id=_node_for(runs[rec], step_index))


def _step(runs: list[Run], r: Ref) -> Step:
    return runs[r.rec].steps[r.step]


def _app(step: Step) -> str:
    return step.label.application if step.label else "Unknown"


def _visits(f: Finding) -> int:
    m = re.search(r"(\d+) times", f.title)
    return int(m.group(1)) if m else 2


# ------------------------------------------------------------ fix catalogue


def fix_catalogue(runs: list[Run], roles: list[str], process: Process | None) -> list[Recommendation]:
    out: list[Recommendation] = []
    for rec, run in enumerate(runs):
        for i, f in enumerate(run.findings):
            item = _fix_for_run_finding(runs, roles, rec, i, f)
            if item:
                out.append(item)
    if process:
        for i, f in enumerate(process.findings):
            item = _fix_for_process_finding(runs, roles, i, f)
            if item:
                out.append(item)
    return out


def _fix_for_run_finding(runs: list[Run], roles: list[str], rec: int, idx: int, f: Finding) -> Recommendation | None:
    run = runs[rec]
    refs = [_ref(runs, rec, s) for s in f.step_indexes if s < len(run.steps)]
    key = f"r{rec}:f{idx}"
    who = f" ({roles[rec]})" if len(roles) > 1 else ""
    ev = [FrameRef(rec=rec, frame=x) for x in f.evidence_frames[:3]]
    if f.rule == "long-step":
        s = run.steps[f.step_indexes[0]]
        if not is_wait(s):
            return None  # work that is long is for the AI path
        return Recommendation(
            id=f"fix-{key}", path="fix", kind="move", mechanism="reorder",
            title=f"Open {_app(s)} before the previous step, so it loads while you read",
            detail=f"Start the {_app(s)} screen first and go back to the document while it loads; or ask IT why it takes {_fmt(s.duration)}.",
            rationale=f"{_fmt(s.duration)} of waiting on {_app(s)} at {_label(roles, refs[0])}{who}, {f.share:.0%} of that recording. Reordering may hide the wait; the real fix is the system's load time, which this recording cannot prove.",
            refs=refs, finding_keys=[key], evidence=ev, seconds_raw=0.0, potential_seconds=round(s.duration, 3),
            method=f"{_label(roles, refs[0])} wait {s.duration:.0f} s: potential, not counted", confidence="low",
            depends_on=[f"{_app(s)} load time measured on more recordings"],
        )
    if f.rule == "loop":
        # the cost is the return trip: take steps from the end until they add up to the finding's seconds
        tail: list[Ref] = []
        acc = 0.0
        for r in reversed(refs):
            if acc >= f.seconds - 1e-6:
                break
            tail.insert(0, r)
            acc += _step(runs, r).duration
        refs = tail or refs
        return Recommendation(
            id=f"fix-{key}", path="fix", kind="merge", mechanism="merge_steps",
            title=f"Finish in {_app(run.steps[f.step_indexes[0]])} before moving on: one visit instead of {_visits(f)}",
            detail="Batch what is done in the same application so it is visited once per task; the return trip is the cost.",
            rationale=f.detail, refs=refs, finding_keys=[key], evidence=ev, seconds_raw=round(f.seconds, 3),
            method=f"return trip {f.seconds:.0f} s across {', '.join(_label(roles, r) for r in refs[:6])}{'…' if len(refs) > 6 else ''}",
            confidence="medium", depends_on=["the task order allows finishing the first application in one go"],
        )
    if f.rule == "app-switch-copy":
        checking = "cross-checked" in f.title
        if not checking:
            return None  # keying across applications is the AI path (document extraction / prefill)
        apps = re.findall(r"between (.+) and (.+)$", f.title)
        src, dst = apps[0] if apps else ("the source", "the target")
        later = [r for r in refs if normalise(_app(_step(runs, r))) == normalise(dst)]
        return Recommendation(
            id=f"fix-{key}", path="fix", kind="remove", mechanism="lookup_validation",
            title=f"Show the {dst} value inside {src}, so nobody checks it by hand",
            detail=f"Surface the checked value where the work happens (a lookup or a linked field), so the switch to {dst} is not needed.",
            rationale=f.detail, refs=refs, finding_keys=[key], evidence=ev,
            seconds_raw=round(sum(_step(runs, r).duration for r in later) or f.seconds, 3),
            method=" + ".join(f"{_label(roles, r)} {_step(runs, r).duration:.0f} s" for r in later) or f"{f.seconds:.0f} s",
            confidence="medium", depends_on=[f"{src} can show or link the {dst} value"],
        )
    return None


def _fix_for_process_finding(runs: list[Run], roles: list[str], idx: int, f: ProcessFinding) -> Recommendation | None:
    key = f"p:f{idx}"
    ev = [FrameRef(rec=e.rec, frame=e.frame) for e in f.evidence[:3]]
    if f.rule == "cross-check":
        later_rec = max(r.rec for r in f.refs)
        later = [r for r in f.refs if r.rec == later_rec]
        app = _app(_step(runs, later[0]))
        return Recommendation(
            id=f"fix-{key}", path="fix", kind="remove", mechanism="remove_step",
            title=f"Drop {roles[later_rec]}'s second check in {app}: show the result where they work",
            detail=f"{roles[later_rec]} repeats a check {roles[min(r.rec for r in f.refs)]} already did. Show the checked status on the record they open, and remove the second check.",
            rationale=f.detail, refs=later, finding_keys=[key], evidence=ev,
            seconds_raw=round(sum(_step(runs, r).duration for r in later), 3),
            method=" + ".join(f"{_label(roles, r)} {_step(runs, r).duration:.0f} s" for r in later),
            confidence="high", depends_on=[f"the first check's result is visible to {roles[later_rec]}"],
        )
    if f.rule == "handoff-detour":
        return Recommendation(
            id=f"fix-{key}", path="fix", kind="remove", mechanism="in_app_approval",
            title="Hand over inside the system of record instead of by email",
            detail="Use an approval task or status change in the system where the work is done; the next role opens the task there. Email leaves the trail and the context behind.",
            rationale=f.detail, refs=f.refs, finding_keys=[key], evidence=ev,
            seconds_raw=round(f.seconds, 3),
            method=" + ".join(f"{_label(roles, r)} {_step(runs, r).duration:.0f} s" for r in f.refs),
            confidence="high", depends_on=["the system of record supports an approval task or workflow"],
        )
    if f.rule == "cross-rekey":
        return Recommendation(
            id=f"ai-{key}", path="ai", kind="assist", mechanism="prefill",
            title=f"Pre-fill what {roles[f.refs[0].rec]} types from the earlier role's data",
            detail="Carry the values the earlier role already entered into the later role's form; the later role checks instead of typing.",
            rationale=f.detail, refs=f.refs, finding_keys=[key], evidence=ev,
            seconds_raw=round(f.seconds * FACTORS["prefill"], 3), factor=FACTORS["prefill"],
            method=f"({' + '.join(f'{_label(roles, r)} {_step(runs, r).duration:.0f} s' for r in f.refs)}) x {FACTORS['prefill']}",
            confidence="high", stays_human="Checking the pre-filled values before saving.",
            guardrail="Values that differ between roles are flagged, never silently overwritten.",
            data_needed=["the earlier role's saved record"], depends_on=["both roles work on the same record or an integration between the two systems"],
        )
    return None


# --------------------------------------------------------------- AI path


SYSTEM = (
    "You are WorkLens, a process analyst. You are given the screens of a business task as it was actually "
    "performed (one or more roles), with what the user did on each screen, the values seen, and how long it took. "
    "For EACH screen, decide whether an AI or automation could do it (automate), prepare it so the person only "
    "checks (assist), or whether it must stay human (keep_human), and pick ONE mechanism from the menu. "
    "Rules: a decision with financial or legal authority (approve, reject, authorise, sign) is keep_human. "
    "Waiting screens are keep_human with no mechanism. Be concrete in the rationale (name the fields, the document, "
    "the record). State what stays human, a guardrail (a threshold, a review, an exception path) and the data needed. "
    "Never give numbers or time savings; they are computed elsewhere. Return only JSON matching the schema."
)
MENU = (
    "Mechanism menu: document_extraction (read fields from a PDF, image or email into a form); "
    "lookup_validation (look a value up in another system and compare); prefill (carry known values into a form); "
    "drafting (write a message or note for a person to send); in_app_approval (replace an email handoff with a task "
    "in the system of record); notification (tell the next person automatically); straight_through (do the whole "
    "step without a person, only for mechanical steps like opening a record or saving). "
    "keep_human has no mechanism."
)
SCHEMA = {
    "type": "object",
    "properties": {
        "screens": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "disposition": {"type": "string", "enum": ["automate", "assist", "keep_human"]},
                    "mechanism": {"type": "string", "enum": [*MECHANISMS, "none"]},
                    "rationale": {"type": "string"},
                    "stays_human": {"type": "string"},
                    "guardrail": {"type": "string"},
                    "data_needed": {"type": "array", "items": {"type": "string"}},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["key", "disposition", "mechanism", "rationale", "stays_human", "guardrail", "data_needed", "confidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["screens"],
    "additionalProperties": False,
}


def screens_for_model(runs: list[Run], roles: list[str]) -> list[dict]:
    out: list[dict] = []
    for rec, run in enumerate(runs):
        for n in run.graph.nodes:
            steps = [run.steps[i] for i in n.step_indexes]
            fields = []
            for s in steps:
                for f in s.label.data_fields if s.label else []:
                    if f not in fields:
                        fields.append(f)
            out.append({
                "key": f"r{rec}:{n.id}", "role": roles[rec], "application": n.application, "action": n.action,
                "object": n.object, "values_seen": fields[:8], "seconds": round(n.total_duration, 1), "visits": n.visits, "is_wait": n.is_wait,
            })
    return out


def classify_with_model(client: LLMClient, runs: list[Run], roles: list[str], process: Process | None) -> tuple[list[AIClassification], str | None, str | None]:
    """Ask the model once for every screen. Returns (classifications, model name, error)."""
    screens = screens_for_model(runs, roles)
    findings = [f.title for r in runs for f in r.findings] + ([f.title for f in process.findings] if process else [])
    user = (
        f"{MENU}\n\nRoles in handoff order: {' -> '.join(roles)}.\n"
        f"Findings already known: {json.dumps(findings)}\n\nScreens (JSON): {json.dumps(screens)}\n\n"
        "Classify every screen by its key."
    )
    data, call = client.structured(SYSTEM, user, [], SCHEMA, "recommend_screens")
    if data is None:
        return [], client.cfg.model, call.error or "no answer from the model"
    valid_keys = {s["key"] for s in screens}
    out: list[AIClassification] = []
    for item in data.get("screens", []):
        try:
            key = str(item.get("key", ""))
            if key not in valid_keys:
                continue
            disp = item.get("disposition")
            mech = item.get("mechanism")
            mech = mech if mech in MECHANISMS else None
            if disp == "keep_human":
                mech = None
            elif mech is None:
                continue  # automate/assist without a mechanism from the menu is not usable
            node_action = next(s["action"] for s in screens if s["key"] == key)
            if disp == "automate" and DECISION_RE.search(node_action):
                disp = "assist"  # a decision is never automated; the model may prepare it
            if next(s["is_wait"] for s in screens if s["key"] == key):
                disp, mech = "keep_human", None
            out.append(AIClassification(
                key=key, disposition=disp, mechanism=mech, rationale=str(item.get("rationale", ""))[:600],
                stays_human=str(item.get("stays_human", ""))[:300], guardrail=str(item.get("guardrail", ""))[:300],
                data_needed=[str(x)[:120] for x in item.get("data_needed", [])][:6],
                confidence=item.get("confidence") if item.get("confidence") in ("high", "medium", "low") else "medium",
            ))
        except Exception:  # noqa: BLE001 - one bad item never sinks the batch
            continue
    return out, client.cfg.model, None if out else "the model returned no usable screen"


def ai_items(runs: list[Run], roles: list[str], classification: list[AIClassification], model: str | None) -> list[Recommendation]:
    out: list[Recommendation] = []
    for c in classification:
        m = re.match(r"^r(\d+):(.+)$", c.key)
        if not m:
            continue
        rec, node_id = int(m.group(1)), m.group(2)
        if rec >= len(runs):
            continue
        run = runs[rec]
        node = next((n for n in run.graph.nodes if n.id == node_id), None)
        if node is None:
            continue
        refs = [Ref(rec=rec, step=i, node_id=node.id) for i in node.step_indexes]
        who = f"{roles[rec]}: " if len(roles) > 1 else ""
        ev = [FrameRef(rec=rec, frame=run.steps[i].frame_start) for i in node.step_indexes[:3]]
        if c.disposition == "keep_human":
            out.append(Recommendation(
                id=f"ai-{c.key}", path="ai", kind="keep_human", mechanism=None,
                title=f"Keep human: {node.action}", detail=f"{who}{node.application} · {node.action} stays with the person.",
                rationale=c.rationale, refs=refs, evidence=ev, seconds_raw=0.0, method="kept on purpose: 0 s",
                confidence=c.confidence, stays_human=c.stays_human or "The whole step.", guardrail=c.guardrail or None,
                data_needed=c.data_needed, source="model", model=model, prompt_version=PROMPT_VERSION,
            ))
            continue
        factor = FACTORS.get(c.mechanism or "", 0.0)
        dur = sum(run.steps[i].duration for i in node.step_indexes)
        verb = "Automate" if c.disposition == "automate" else "Assist"
        out.append(Recommendation(
            id=f"ai-{c.key}", path="ai", kind="automate" if c.disposition == "automate" else "assist", mechanism=c.mechanism,
            title=f"{verb}: {node.action} ({node.application})",
            detail=f"{who}{(c.mechanism or '').replace('_', ' ')} for '{node.action}' in {node.application}.",
            rationale=c.rationale, refs=refs, evidence=ev, seconds_raw=round(dur * factor, 3), factor=factor,
            method=f"({' + '.join(f'{_label(roles, r)} {run.steps[r.step].duration:.0f} s' for r in refs)}) x {factor}",
            confidence=c.confidence, stays_human=c.stays_human or None, guardrail=c.guardrail or None,
            data_needed=c.data_needed, source="model", model=model, prompt_version=PROMPT_VERSION,
        ))
    return out


# ------------------------------------------------------- maths and target


def _per_step_raw(item: Recommendation, runs: list[Run]) -> dict[tuple[int, int], float]:
    """Spread an item's raw saving over its steps in proportion to their duration."""
    total = sum(_step(runs, r).duration for r in item.refs) or 1.0
    return {(r.rec, r.step): item.seconds_raw * _step(runs, r).duration / total for r in item.refs}


def count_overlaps(items: list[Recommendation], runs: list[Run], include: set[str]) -> dict[str, float]:
    """Rank by raw value; each item takes only what earlier items left on each step. Returns counted seconds per item id."""
    remaining: dict[tuple[int, int], float] = {(rec, s.index): s.duration for rec, run in enumerate(runs) for s in run.steps}
    counted: dict[str, float] = {}
    for item in sorted(items, key=lambda x: (-x.seconds_raw, x.id)):
        if item.status not in include or item.seconds_raw <= 0:
            counted[item.id] = 0.0
            item.savings = [StepSaving(ref=r, seconds_before=_step(runs, r).duration, seconds_raw=0.0, seconds_counted=0.0) for r in item.refs] if item.status in include else []
            continue
        got = 0.0
        savings: list[StepSaving] = []
        for r, raw in _per_step_raw(item, runs).items():
            take = min(raw, remaining.get(r, 0.0))
            remaining[r] = remaining.get(r, 0.0) - take
            got += take
            savings.append(StepSaving(ref=Ref(rec=r[0], step=r[1], node_id=_node_for(runs[r[0]], r[1])), seconds_before=_step(runs, Ref(rec=r[0], step=r[1])).duration, seconds_raw=round(raw, 3), seconds_counted=round(take, 3)))
        counted[item.id] = round(got, 3)
        item.savings = savings
    return counted


def build_target(items: list[Recommendation], runs: list[Run], roles: list[str], process: Process | None, applied: str) -> tuple[Target, dict[str, float]]:
    include = {"proposed", "accepted", "done"} if applied == "proposed" else {"accepted", "done"}
    # recompute counted seconds for this selection without mutating the items' headline numbers
    snapshot = [i.model_copy(deep=True) for i in items]
    counted = count_overlaps(snapshot, runs, include)
    after: dict[tuple[int, int], float] = {(rec, s.index): s.duration for rec, run in enumerate(runs) for s in run.steps}
    disp: dict[tuple[int, int], str] = {k: "keep" for k in after}
    rec_ids: dict[tuple[int, int], list[str]] = {k: [] for k in after}
    rank = {"keep": 0, "assist": 1, "automate": 2, "remove": 3}
    for item in snapshot:
        if item.status not in include:
            continue
        for sv in item.savings:
            k = (sv.ref.rec, sv.ref.step)
            if sv.seconds_counted <= 0:
                continue
            after[k] = max(0.0, after[k] - sv.seconds_counted)
            d = "remove" if item.kind in ("remove", "merge") else "automate" if item.kind == "automate" else "assist" if item.kind in ("assist", "move") else "keep"
            if after[k] <= 0.05:
                d = "remove" if item.kind in ("remove", "merge") else "automate"
            if rank[d] > rank[disp[k]]:
                disp[k] = d
            rec_ids[k].append(item.id)
    steps: list[TargetStep] = []
    for rec, run in enumerate(runs):
        for s in run.steps:
            k = (rec, s.index)
            steps.append(TargetStep(ref=Ref(rec=rec, step=s.index, node_id=_node_for(run, s.index)), application=_app(s), action=s.label.action if s.label else "unlabelled step",
                                    disposition=disp[k], recommendation_ids=rec_ids[k], seconds_before=round(s.duration, 3), seconds_after=round(after[k], 3)))
    before_total = sum(s.seconds_before for s in steps)
    live = [s for s in steps if s.disposition in ("keep", "assist") or s.seconds_after > 0.05]
    switches = lambda seq: sum(1 for a, b in zip(seq, seq[1:]) if normalise(a.application) != normalise(b.application))  # noqa: E731
    in_app = any(i.mechanism == "in_app_approval" and i.status in include for i in snapshot)
    decisions = sum(1 for s in steps if s.disposition == "keep" and DECISION_RE.search(s.action))
    return Target(
        applied=applied, steps=steps, seconds_before=round(before_total, 3), seconds_after=round(sum(s.seconds_after for s in steps), 3),
        steps_before=len(steps), steps_after=len(live), app_switches_before=switches(steps), app_switches_after=switches(live),
        handoffs_before=len(process.handoffs) if process else 0, handoffs_after=len(process.handoffs) if process else 0, handoff_in_app=in_app,
        human_decisions_kept=decisions,
    ), counted


def build_recommendations(
    runs: list[Run], roles: list[str], process: Process | None = None, client: LLMClient | None = None,
    classification: list[AIClassification] | None = None, model: str | None = None, previous: Recommendations | None = None,
) -> Recommendations:
    """Fix items from the catalogue, AI items from the (cached) classification, numbers from the maths.

    `classification` lets the numbers be recomputed (e.g. after a status change) without a new model call;
    `previous` carries over statuses and notes by item id.
    """
    total = sum(r.summary.total_duration or r.duration for r in runs) or 1.0
    items = fix_catalogue(runs, roles, process)
    unavailable: str | None = None
    if classification is None:
        if client is None:
            classification, unavailable = [], "no model configured for the AI path"
        else:
            classification, model, unavailable = classify_with_model(client, runs, roles, process)
    items += ai_items(runs, roles, classification, model)
    if previous:
        old = {i.id: i for i in previous.items}
        for i in items:
            if i.id in old:
                i.status, i.decided_by, i.decided_at, i.note = old[i.id].status, old[i.id].decided_by, old[i.id].decided_at, old[i.id].note
    # headline numbers: everything not rejected, overlaps counted once
    counted = count_overlaps(items, runs, {"proposed", "accepted", "done"})
    for i in items:
        i.seconds_saved = counted.get(i.id, 0.0)
        i.share_saved = round(i.seconds_saved / total, 4)
        if i.seconds_raw > 0 and i.seconds_saved < i.seconds_raw - 0.05:
            i.method += f" -> {i.seconds_saved:.0f} s counted after overlaps"
    items.sort(key=lambda i: (0 if i.path == "fix" else 1, -i.seconds_saved, -i.potential_seconds, SEV[i.confidence], i.id))
    target, _ = build_target(items, runs, roles, process, "proposed")
    target_acc, _ = build_target(items, runs, roles, process, "accepted")
    fix_s = sum(i.seconds_saved for i in items if i.path == "fix")
    ai_s = sum(i.seconds_saved for i in items if i.path == "ai")
    return Recommendations(
        generated_at=_now(), rules_version=RULES_VERSION, model=model, prompt_version=PROMPT_VERSION if model else None, factors=dict(FACTORS),
        items=items, classification=classification, target=target, target_accepted=target_acc,
        summary=RecommendationsSummary(
            total_seconds=round(total, 3), fix_seconds=round(fix_s, 3), ai_seconds=round(ai_s, 3), counted_seconds=round(fix_s + ai_s, 3),
            share=round((fix_s + ai_s) / total, 4),
            proposed=sum(1 for i in items if i.status == "proposed"), accepted=sum(1 for i in items if i.status == "accepted"),
            rejected=sum(1 for i in items if i.status == "rejected"), done=sum(1 for i in items if i.status == "done"),
            ai_unavailable=unavailable if not any(i.source == "model" for i in items) else None,
        ),
    )


def apply_decision(recs: Recommendations, runs: list[Run], roles: list[str], process: Process | None, item_id: str, status: str, decided_by: str | None, note: str | None) -> Recommendations:
    """Record a decision and recompute the numbers and targets without calling the model."""
    for i in recs.items:
        if i.id == item_id:
            i.status = status  # type: ignore[assignment]
            i.decided_by, i.decided_at, i.note = decided_by, _now(), note
            break
    else:
        raise KeyError(item_id)
    return build_recommendations(runs, roles, process, client=None, classification=recs.classification, model=recs.model, previous=recs)
