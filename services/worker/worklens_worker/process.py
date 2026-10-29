"""Stage 6: merge several recordings, one per role, into one process. No model calls.

One recording is one person's run of a task. A process is the chain of those
runs in handoff order (clerk → approver → ...). This module

* finds the handoff between consecutive recordings: the sending step at the
  end of one and the receiving step at the start of the next, matched on
  values that appear on both screens (an invoice number, a reference);
* runs rules that only make sense across roles:

    cross-check     the same values are checked in the same application by
                    two roles (the second check repeats the first)
    cross-rekey     a role types values the previous role already entered or
                    had on screen (re-keying across the handoff)
    handoff-detour  the work leaves the system of record for another
                    application (usually Mail) to hand over, and the next role
                    goes straight back into that system

Each recording keeps its own findings (long-step, loop, app-switch-copy); the
process adds only what no single recording can see.
"""
from __future__ import annotations

import re
from collections import defaultdict

from .graph import is_wait, normalise, visits
from .models import FrameRef, Handoff, Process, ProcessFinding, ProcessSummary, Recording, Ref, Run, Step
from .rules import FILL_RE, _severity, _values

SEND_RE = re.compile(r"\b(send|sent|submit|forward|reply|request|notify|assign|share|post|escalat\w*|approve[sd]?|ask)\b", re.I)
RECV_RE = re.compile(r"\b(open|read|view|check|receive[sd]?|review|look|inspect|see)\b", re.I)
CHECK_RE = re.compile(r"\b(check|verify|verif\w*|confirm|review|compare|look ?up|validate|reconcile|match)\b", re.I)
SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}
IDENT_RE = re.compile(r"\b[A-Za-z]{1,6}-?\d{3,}\b|\b\d[\d,]{2,}(?:\.\d+)?\b")


def _idents(step: Step) -> set[str]:
    """Identifier-like tokens on a screen: INV-20481, PO-7731, AP-000912, 4,250.00."""
    if not step.label:
        return set()
    return {m.group(0).lower().replace(",", "") for f in step.label.data_fields for m in IDENT_RE.finditer(f)}


def _keys(step: Step) -> set[str]:
    return _values(step) | _idents(step)


def _fmt(seconds: float) -> str:
    return f"{seconds / 60:.1f} min" if seconds >= 90 else f"{seconds:.0f} s"


def _app(step: Step) -> str:
    return normalise(step.label.application) if step.label else "unknown"


def _app_name(step: Step) -> str:
    return step.label.application if step.label else "Unknown"


def _node_for(run: Run, step: Step) -> str:
    for n in run.graph.nodes:
        if step.index in n.step_indexes:
            return n.id
    return ""


def _ref(runs: list[Run], rec: int, step: Step) -> Ref:
    return Ref(rec=rec, step=step.index, node_id=_node_for(runs[rec], step))


def _ident(values: set[str]) -> str:
    """The most identifier-like shared value: letters+digits (INV-20481) before bare numbers, shortest first."""
    cands = sorted((v for v in values if any(ch.isdigit() for ch in v)), key=lambda v: (not any(ch.isalpha() for ch in v), len(v), "-" not in v))
    return cands[0] if cands else (sorted(values, key=len)[0] if values else "")


# ---------------------------------------------------------------- handoffs


def find_handoff(runs: list[Run], a: int, b: int) -> Handoff:
    """The step that hands over at the end of recording a, and the one that picks up at the start of b."""
    ra, rb = runs[a], runs[b]
    tail = [s for g in visits(ra.steps)[-4:] for s in g]
    head = [s for g in visits(rb.steps)[:4] for s in g]
    sends = [s for s in tail if s.label and SEND_RE.search(s.label.action)]
    recvs = [s for s in head if s.label and RECV_RE.search(s.label.action)]
    best: tuple[int, Step, Step, set[str]] | None = None
    for s in sends or tail[-1:]:
        for r in recvs or head[:1]:
            shared = _keys(s) & _keys(r)
            score = len(shared) * 10 + (3 if s in sends else 0) + (3 if r in recvs else 0)
            if best is None or score > best[0]:
                best = (score, s, r, shared)
    assert best is not None
    _, s, r, shared = best
    return Handoff(
        from_ref=_ref(runs, a, s),
        to_ref=_ref(runs, b, r),
        via=_app_name(s),
        object=_ident(shared),
        matched=bool(shared),
    )


# ------------------------------------------------------------------- rules


def rule_cross_check(runs: list[Run], roles: list[str], total: float) -> list[ProcessFinding]:
    """The same values checked in the same application by two different roles."""
    out: list[ProcessFinding] = []
    for a in range(len(runs)):
        for b in range(a + 1, len(runs)):
            hits: dict[str, dict] = {}
            for sa in runs[a].steps:
                if not sa.label or not CHECK_RE.search(sa.label.action) or is_wait(sa):
                    continue
                for sb in runs[b].steps:
                    if not sb.label or not CHECK_RE.search(sb.label.action) or _app(sa) != _app(sb) or is_wait(sb):
                        continue
                    shared = _keys(sa) & _keys(sb)
                    if not shared:
                        continue
                    h = hits.setdefault(_app(sa), {"app": _app_name(sa), "pairs": [], "values": set()})
                    h["pairs"].append((sa, sb))
                    h["values"] |= shared
            for h in hits.values():
                steps_a = {p[0].index: p[0] for p in h["pairs"]}
                steps_b = {p[1].index: p[1] for p in h["pairs"]}
                seconds = sum(s.duration for s in steps_a.values()) + sum(s.duration for s in steps_b.values())
                share = seconds / total
                vals = sorted(h["values"], key=len)
                obj = _ident(h["values"]) or vals[0]
                out.append(
                    ProcessFinding(
                        rule="cross-check",
                        title=f"{obj.upper() if len(obj) <= 12 else obj} checked in {h['app']} by both {roles[a]} and {roles[b]}",
                        detail=(
                            f"{roles[a]} checked {', '.join(vals[:3])} in {h['app']} "
                            f"({', '.join(f'step {i}' for i in sorted(steps_a))}), then {roles[b]} opened {h['app']} and checked the same "
                            f"({', '.join(f'step {i}' for i in sorted(steps_b))}). {_fmt(seconds)} on two checks of one fact; "
                            f"one can go, or the result can be shown where the next role already works."
                        ),
                        severity=_severity(share, 0.10, 0.04),
                        refs=[_ref(runs, a, s) for s in steps_a.values()] + [_ref(runs, b, s) for s in steps_b.values()],
                        evidence=[FrameRef(rec=a, frame=s.frame_start) for s in steps_a.values()] + [FrameRef(rec=b, frame=s.frame_start) for s in steps_b.values()],
                        seconds=round(seconds, 3),
                        share=round(share, 4),
                    )
                )
    return out


def rule_cross_rekey(runs: list[Run], roles: list[str], total: float) -> list[ProcessFinding]:
    """A later role types values an earlier role already had on screen."""
    out: list[ProcessFinding] = []
    for b in range(1, len(runs)):
        shown_before: set[str] = set()
        for a in range(b):
            for s in runs[a].steps:
                shown_before |= _keys(s)
        hits: dict[str, dict] = {}
        seen_in_b: dict[str, set[str]] = defaultdict(set)  # per application, values already shown in b
        for sb in runs[b].steps:
            if not sb.label:
                continue
            app = _app(sb)
            if FILL_RE.search(sb.label.action) and not is_wait(sb):
                shared = (_keys(sb) & shown_before) - seen_in_b[app]
                if shared:
                    h = hits.setdefault(app, {"app": _app_name(sb), "steps": [], "values": set(), "seconds": 0.0})
                    h["steps"].append(sb)
                    h["values"] |= shared
                    h["seconds"] += sb.duration
            seen_in_b[app] |= _keys(sb)
        for h in hits.values():
            share = h["seconds"] / total
            vals = sorted(h["values"], key=len)
            src_roles = sorted({roles[a] for a in range(b) for s in runs[a].steps if _keys(s) & h["values"]})
            out.append(
                ProcessFinding(
                    rule="cross-rekey",
                    title=f"{roles[b]} re-keys into {h['app']} what {' and '.join(src_roles) or 'an earlier role'} already entered",
                    detail=(
                        f"{', '.join(vals[:4])}{'…' if len(vals) > 4 else ''} were typed again by {roles[b]} in {h['app']} "
                        f"({', '.join(f'step {s.index}' for s in h['steps'])}) although {' and '.join(src_roles) or 'an earlier role'} already had them on screen. "
                        f"{_fmt(h['seconds'])} of re-keying across the handoff."
                    ),
                    severity=_severity(share, 0.10, 0.04),
                    refs=[_ref(runs, b, s) for s in h["steps"]],
                    evidence=[FrameRef(rec=b, frame=s.frame_start) for s in h["steps"]],
                    seconds=round(h["seconds"], 3),
                    share=round(share, 4),
                )
            )
    return out


def rule_handoff_detour(runs: list[Run], roles: list[str], handoffs: list[Handoff], total: float) -> list[ProcessFinding]:
    """The handoff leaves the system of record for another application and the next role goes straight back."""
    out: list[ProcessFinding] = []
    for h in handoffs:
        a, b = h.from_ref.rec, h.to_ref.rec
        ra, rb = runs[a], runs[b]
        via = normalise(h.via)
        # trailing steps of a in the handoff application
        tail: list[Step] = []
        for s in reversed(ra.steps[: h.from_ref.step + 1]):
            if _app(s) == via:
                tail.insert(0, s)
            else:
                break
        work = next((s for s in reversed(ra.steps[: h.from_ref.step + 1 - len(tail)]) if not is_wait(s) and s.label), None)
        if work is None or _app(work) == via:
            continue
        # leading steps of b in the handoff application, then the return into the work application
        head: list[Step] = []
        for s in rb.steps:
            if _app(s) == via:
                head.append(s)
            else:
                break
        after = rb.steps[len(head) : len(head) + 3]
        back = [s for s in after if _app(s) == _app(work)]
        if not head or not back:
            continue
        waits = [s for s in back if is_wait(s)]
        seconds = sum(s.duration for s in tail + head + waits)
        share = seconds / total
        steps = tail + head + waits
        out.append(
            ProcessFinding(
                rule="handoff-detour",
                title=f"Work leaves {_app_name(work)} for {h.via} to hand over and comes back",
                detail=(
                    f"{roles[a]} finishes in {_app_name(work)}, switches to {h.via} to hand over"
                    f"{f' ({h.object})' if h.object else ''}; {roles[b]} starts in {h.via} and re-opens {_app_name(work)}"
                    f"{' and waits for it to load' if waits else ''}. {_fmt(seconds)} spent on the detour. "
                    f"A handoff inside {_app_name(work)} would remove it."
                ),
                severity=_severity(share, 0.15, 0.05),
                refs=[_ref(runs, a, s) for s in tail] + [_ref(runs, b, s) for s in head + waits],
                evidence=[FrameRef(rec=a, frame=tail[-1].frame_start), FrameRef(rec=b, frame=head[0].frame_start)] + ([FrameRef(rec=b, frame=waits[0].frame_start)] if waits else []),
                seconds=round(seconds, 3),
                share=round(share, 4),
            )
        )
    return out


# --------------------------------------------------------------------- build


def build_process(process_id: str, name: str, runs: list[Run], roles: list[str]) -> Process:
    if len(runs) != len(roles) or not runs:
        raise ValueError("one role per run, at least one run")
    total = sum(r.summary.total_duration or r.duration for r in runs) or 1.0
    handoffs = [find_handoff(runs, i, i + 1) for i in range(len(runs) - 1)]
    findings = rule_cross_check(runs, roles, total) + rule_cross_rekey(runs, roles, total) + rule_handoff_detour(runs, roles, handoffs, total)
    findings.sort(key=lambda f: (SEVERITY_RANK[f.severity], -f.seconds))
    apps: list[str] = []
    for r in runs:  # in the order first seen, across recordings
        for st in r.steps:
            a = _app_name(st)
            if a not in apps:
                apps.append(a)
    return Process(
        id=process_id,
        name=name,
        status="built",
        recordings=[
            Recording(index=i, run_id=r.id, role=roles[i], source=r.source, duration=r.summary.total_duration or r.duration, steps=len(r.steps), findings=len(r.findings))
            for i, r in enumerate(runs)
        ],
        handoffs=handoffs,
        findings=findings,
        summary=ProcessSummary(
            total_duration=round(total, 3),
            wait_duration=round(sum(r.summary.wait_duration for r in runs), 3),
            steps=sum(len(r.steps) for r in runs),
            applications=apps,
            roles=list(roles),
            app_switches=sum(r.summary.app_switches for r in runs),
            loops=sum(r.summary.loops for r in runs),
            handoffs=len(handoffs),
            run_findings=sum(len(r.findings) for r in runs),
        ),
    )
