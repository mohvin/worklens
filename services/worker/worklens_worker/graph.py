"""Stage 4: build the process graph from labelled steps. No model calls.

Deterministic so the same labels always give the same map:

* A node is one screen activity, keyed on the normalised (application, action)
  label. Steps with the same key merge into one node; visits are counted,
  durations summed and the step indexes kept so the UI can show evidence.
* Adjacent steps with the same key are one visit (the detector cut a screen
  state in two, not the user coming back).
* An edge is a transition between consecutive visits, counted. A node visited
  again after leaving it is a loop; the rules stage reports it.
* Unlabelled steps (model error) still get a node so the graph covers the
  whole recording and nothing is silently dropped.
"""
from __future__ import annotations

import re
from collections import Counter

from .models import Edge, Graph, Node, Run, Step, Summary

UNLABELLED = ("Unknown", "unlabelled step")
WAIT_RE = re.compile(r"\b(wait|waiting|loading|load)\b", re.I)


def normalise(text: str) -> str:
    """Case, punctuation and whitespace insensitive label key."""
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def step_key(step: Step) -> str:
    app, action = (step.label.application, step.label.action) if step.label else UNLABELLED
    return f"{normalise(app)}|{normalise(action)}"


def is_wait(step: Step) -> bool:
    return bool(step.label and WAIT_RE.search(step.label.action))


def visits(steps: list[Step]) -> list[list[Step]]:
    """Group adjacent steps with the same key into one visit."""
    out: list[list[Step]] = []
    for s in steps:
        if out and step_key(out[-1][0]) == step_key(s):
            out[-1].append(s)
        else:
            out.append([s])
    return out


def build_graph(steps: list[Step]) -> Graph:
    total = sum(s.duration for s in steps) or 1.0
    nodes: dict[str, Node] = {}
    order: list[str] = []
    objects: dict[str, Counter] = {}

    for group in visits(steps):
        key = step_key(group[0])
        first = group[0]
        if key not in nodes:
            app, action = (first.label.application, first.label.action) if first.label else UNLABELLED
            nodes[key] = Node(
                id=f"n{len(order) + 1}",
                application=app,
                action=action,
                object="",
                visits=0,
                total_duration=0.0,
                step_indexes=[],
            )
            objects[key] = Counter()
            order.append(key)
        node = nodes[key]
        node.visits += 1
        node.total_duration = round(node.total_duration + sum(s.duration for s in group), 3)
        node.step_indexes.extend(s.index for s in group)
        for s in group:
            if s.label and s.label.object:
                objects[key][s.label.object.strip()] += 1

    for key, node in nodes.items():
        node.object = objects[key].most_common(1)[0][0] if objects[key] else ""
        node.avg_duration = round(node.total_duration / node.visits, 3)
        node.share = round(node.total_duration / total, 4)
        node.is_wait = is_wait(steps[node.step_indexes[0]])

    edge_counts: Counter[tuple[str, str]] = Counter()
    groups = visits(steps)
    for a, b in zip(groups, groups[1:]):
        edge_counts[(nodes[step_key(a[0])].id, nodes[step_key(b[0])].id)] += 1
    edges = [Edge(source=s, target=t, count=c) for (s, t), c in edge_counts.items()]

    return Graph(nodes=[nodes[k] for k in order], edges=edges)


def summarise(steps: list[Step], graph: Graph) -> Summary:
    apps: list[str] = []
    switches = 0
    for s in steps:
        app = normalise(s.label.application) if s.label else UNLABELLED[0].lower()
        if apps and apps[-1] != app:
            switches += 1
        if not apps or apps[-1] != app:
            apps.append(app)
    longest = max(steps, key=lambda s: s.duration) if steps else None
    return Summary(
        total_duration=round(sum(s.duration for s in steps), 3),
        steps=len(steps),
        labelled_steps=sum(1 for s in steps if s.label),
        applications=sorted({(s.label.application if s.label else UNLABELLED[0]) for s in steps}),
        app_switches=switches,
        loops=sum(1 for n in graph.nodes if n.visits > 1),
        wait_duration=round(sum(s.duration for s in steps if is_wait(s)), 3),
        longest_step_index=longest.index if longest else None,
    )


def build(run: Run) -> Run:
    run.graph = build_graph(run.steps)
    run.summary = summarise(run.steps, run.graph)
    run.status = "built"
    return run
