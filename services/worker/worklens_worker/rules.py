"""Stage 5: bottleneck rules over the graph. No model calls.

Three rules, each emitting findings with evidence frames the UI can show:

* long-step        one step takes more than LONG_STEP_SHARE of the recording
* loop             the same screen (node) is visited two or more times
* app-switch-copy  the user switches application and the same values appear
                   on both sides, i.e. data was re-keyed or copy-pasted by hand

Findings are sorted by severity then by time lost, so findings[:3] is the
"top 3" of the findings view.
"""
from __future__ import annotations

import re
from collections import defaultdict

from .graph import is_wait, normalise, step_key, visits
from .models import Finding, Run, Step

LONG_STEP_SHARE = 0.20
COPY_RE = re.compile(r"\b(copy|copies|copied|paste|pasted|re-?key|re-?type|transcrib)", re.I)
SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}


def _fmt(seconds: float) -> str:
    if seconds >= 90:
        return f"{seconds / 60:.1f} min"
    return f"{seconds:.0f} s"


def _severity(share: float, high: float, medium: float) -> str:
    return "high" if share >= high else "medium" if share >= medium else "low"


def _evidence(step: Step) -> list[int]:
    mid = (step.frame_start + step.frame_end) // 2
    return sorted({step.frame_start, mid, step.frame_end})


def _node_for(run: Run, step: Step) -> str:
    for n in run.graph.nodes:
        if step.index in n.step_indexes:
            return n.id
    return ""


def rule_long_step(run: Run) -> list[Finding]:
    total = sum(s.duration for s in run.steps) or 1.0
    out: list[Finding] = []
    for s in run.steps:
        share = s.duration / total
        if share <= LONG_STEP_SHARE:
            continue
        name = f"{s.label.application} · {s.label.action}" if s.label else "unlabelled step"
        waiting = is_wait(s)
        title = f"{_fmt(s.duration)} waiting on {s.label.application}" if waiting and s.label else f"{_fmt(s.duration)} on one step"
        detail = (
            f"Step {s.index} ({name}) took {_fmt(s.duration)}, {share:.0%} of the recording. "
            + ("The user was waiting for the system, not working." if waiting else "This single screen dominates the task.")
        )
        out.append(
            Finding(
                rule="long-step",
                title=title,
                detail=detail,
                severity=_severity(share, 0.30, 0.20),
                step_indexes=[s.index],
                evidence_frames=_evidence(s),
                node_ids=[_node_for(run, s)],
                seconds=round(s.duration, 3),
                share=round(share, 4),
            )
        )
    return out


def _app(step: Step) -> str:
    return step.label.application if step.label else "Unknown"


def _blocks(groups: list[list[Step]]) -> list[list[list[Step]]]:
    """Contiguous visits in the same application."""
    blocks: list[list[list[Step]]] = []
    for g in groups:
        if blocks and normalise(_app(blocks[-1][0][0])) == normalise(_app(g[0])):
            blocks[-1].append(g)
        else:
            blocks.append([g])
    return blocks


def rule_loop(run: Run) -> list[Finding]:
    """A screen seen again after leaving it.

    The cost of a loop is the whole return trip: when the user comes back to
    Mail, every second spent in Mail the second time counts, not only the
    seconds on the exact screen that repeated. Loops inside one application
    (form -> lookup -> same form) are costed on the repeated screen alone.
    """
    total = sum(s.duration for s in run.steps) or 1.0
    groups = visits(run.steps)
    blocks = _blocks(groups)
    block_of = {id(g): bi for bi, blk in enumerate(blocks) for g in blk}
    by_key: dict[str, list[list[Step]]] = defaultdict(list)
    for g in groups:
        by_key[step_key(g[0])].append(g)

    per_app: dict[str, dict] = {}
    out: list[Finding] = []
    for key, vis in by_key.items():
        if len(vis) < 2:
            continue
        first = vis[0][0]
        bidx = sorted({block_of[id(g)] for g in vis})
        if len(bidx) == 1:  # revisit inside one application block
            repeat = sum(s.duration for g in vis[1:] for s in g)
            i0, i1 = groups.index(vis[0]), groups.index(vis[1])
            between = [g[0] for g in groups[i0 + 1 : i1]]
            screens = " → ".join(f"{s.label.action}" if s.label else "unlabelled" for s in between) or "nothing"
            out.append(
                Finding(
                    rule="loop",
                    title=f"Back to {first.label.action if first.label else 'the same screen'} {len(vis)} times",
                    detail=(
                        f"{_app(first)} · {first.label.action if first.label else 'unlabelled'} was visited {len(vis)} times "
                        f"({_fmt(repeat)} on the repeats, {repeat / total:.0%}) with {screens} in between."
                    ),
                    severity=_severity(repeat / total, 0.15, 0.05),
                    step_indexes=[s.index for g in vis for s in g],
                    evidence_frames=[g[0].frame_start for g in vis],
                    node_ids=[_node_for(run, first)],
                    seconds=round(repeat, 3),
                    share=round(repeat / total, 4),
                )
            )
            continue
        app = _app(first)
        h = per_app.setdefault(app, {"blocks": set(), "screens": [], "nodes": []})
        h["blocks"] |= set(bidx)
        h["screens"].append(first.label.action if first.label else "unlabelled")
        n = _node_for(run, first)
        if n and n not in h["nodes"]:
            h["nodes"].append(n)

    for app, h in per_app.items():
        bidx = sorted(h["blocks"])
        returns = [blocks[i] for i in bidx[1:]]
        repeat = sum(s.duration for blk in returns for g in blk for s in g)
        detour_apps: list[str] = []
        for blk in blocks[bidx[0] + 1 : bidx[1]]:
            detour_apps.append(_app(blk[0][0]))
        steps = [s for i in bidx for g in blocks[i] for s in g]
        out.append(
            Finding(
                rule="loop",
                title=f"Back to {app} {len(bidx)} times",
                detail=(
                    f"The user left {app} and came back {len(bidx) - 1} time{'s' if len(bidx) > 2 else ''}; "
                    f"the return trip{'s' if len(bidx) > 2 else ''} cost {_fmt(repeat)} ({repeat / total:.0%}). "
                    f"Screens seen again: {', '.join(h['screens'])}. Detour via {' → '.join(detour_apps) or 'nothing'}."
                ),
                severity=_severity(repeat / total, 0.15, 0.05),
                step_indexes=[s.index for s in steps],
                evidence_frames=[blocks[i][0][0].frame_start for i in bidx],
                node_ids=h["nodes"],
                seconds=round(repeat, 3),
                share=round(repeat / total, 4),
            )
        )
    return out


FILL_RE = re.compile(r"\b(fill|enter|type|key|input|create|submit|post|record)", re.I)


def _values(step: Step) -> set[str]:
    """Normalised values visibly entered or read on a screen.

    'Amount: 4,250.00' contributes both the whole field and the part after
    the colon, so a value read on one screen matches the labelled field it
    was typed into on the next.
    """
    if not step.label:
        return set()
    vals: set[str] = set()
    for f in step.label.data_fields:
        parts = [f] + ([f.split(":", 1)[1]] if ":" in f else [])
        for part in parts:
            v = normalise(part)
            if len(v) >= 3 and not v.isalpha() or len(v) >= 6:  # skip short bare words like "Sent"
                vals.add(v)
    return vals


def rule_app_switch_copy(run: Run) -> list[Finding]:
    total = sum(s.duration for s in run.steps) or 1.0
    groups = visits(run.steps)
    hits: dict[tuple[str, str], dict] = {}
    for i, (a, b) in enumerate(zip(groups, groups[1:])):
        sa = a[-1]
        if not (sa.label and b[0].label):
            continue
        if normalise(sa.label.application) == normalise(b[0].label.application):
            continue
        # the screen the data lands on: first non-wait visit in the new application
        target = b
        for g in groups[i + 1 :]:
            if not g[0].label or normalise(g[0].label.application) != normalise(b[0].label.application):
                break
            if not is_wait(g[0]):
                target = g
                break
        sb = target[0]
        # values the target application already showed before this switch were
        # not carried over now (a detour and back is not a re-keying)
        seen_before: set[str] = set()
        for g in groups[: i + 1]:
            if g[0].label and normalise(g[0].label.application) == normalise(sb.label.application):
                for st in g:
                    seen_before |= _values(st)
        shared = (_values(sa) & _values(sb)) - seen_before
        mentions = bool(COPY_RE.search(sb.label.action) or COPY_RE.search(sa.label.action))
        if not shared and not mentions:
            continue
        pair = (sa.label.application, sb.label.application)
        h = hits.setdefault(pair, {"count": 0, "values": set(), "steps": [], "frames": [], "seconds": 0.0, "nodes": [], "fill": False})
        h["count"] += 1
        h["values"] |= {f.split(":", 1)[-1].strip() for f in sb.label.data_fields if _values_of(f) & shared} or shared
        h["steps"] += [sa.index, sb.index]
        h["frames"] += [sa.frame_end, sb.frame_start]
        h["seconds"] += sum(s.duration for s in target)  # time spent handling the values on the target screen
        h["fill"] = h["fill"] or bool(FILL_RE.search(sb.label.action))
        for s in (sa, sb):
            n = _node_for(run, s)
            if n and n not in h["nodes"]:
                h["nodes"].append(n)

    out: list[Finding] = []
    for (src, dst), h in hits.items():
        share = h["seconds"] / total
        vals = sorted(h["values"])
        shown = ", ".join(vals[:4]) + ("…" if len(vals) > 4 else "")
        title = f"Values re-keyed from {src} into {dst}" if h["fill"] else f"Values cross-checked by hand between {src} and {dst}"
        verb = "keying" if h["fill"] else "checking"
        out.append(
            Finding(
                rule="app-switch-copy",
                title=title,
                detail=(
                    f"{h['count']} switch{'es' if h['count'] > 1 else ''} from {src} to {dst} with the same values on both "
                    f"screens ({shown}). {_fmt(h['seconds'])} spent {verb} data that already exists in {src}."
                ),
                severity=_severity(share, 0.15, 0.05),
                step_indexes=sorted(set(h["steps"])),
                evidence_frames=sorted(set(h["frames"])),
                node_ids=h["nodes"],
                seconds=round(h["seconds"], 3),
                share=round(share, 4),
            )
        )
    return out


def _values_of(field: str) -> set[str]:
    parts = [field] + ([field.split(":", 1)[1]] if ":" in field else [])
    return {normalise(p) for p in parts}


RULES = (rule_long_step, rule_loop, rule_app_switch_copy)


def run_rules(run: Run) -> Run:
    findings: list[Finding] = []
    for rule in RULES:
        findings.extend(rule(run))
    findings.sort(key=lambda f: (SEVERITY_RANK[f.severity], -f.seconds))
    run.findings = findings
    return run
