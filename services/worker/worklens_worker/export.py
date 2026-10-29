"""Stage 6: export a run as JSON and as BPMN 2.0 XML.

JSON is `Run.model_dump()`, validated by packages/schema/run.schema.json.

BPMN maps the graph to one process: a start event, one task per node (in
first-seen order), one sequence flow per edge, an end event after the last
node visited. Diagram interchange (bpmndi) is included with a left-to-right
layout so the file opens in bpmn.io and Camunda Modeler without errors; loop
edges are routed underneath the row of tasks.
"""
from __future__ import annotations

import json
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

from .graph import step_key, visits
from .models import Process, Run

NS = {
    "bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL",
    "bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
    "dc": "http://www.omg.org/spec/DD/20100524/DC",
    "di": "http://www.omg.org/spec/DD/20100524/DI",
}
TASK_W, TASK_H, GAP, Y, EVENT_R = 180, 80, 70, 120, 18


def to_json(run: Run) -> str:
    return json.dumps(run.model_dump(), indent=2)


def _fmt(seconds: float) -> str:
    return f"{seconds / 60:.1f} min" if seconds >= 90 else f"{seconds:.0f} s"


def _last_node_id(run: Run) -> str | None:
    if not run.steps or not run.graph.nodes:
        return None
    last_key = step_key(visits(run.steps)[-1][0])
    for n in run.graph.nodes:
        if n.step_indexes and step_key(run.steps[n.step_indexes[0]]) == last_key:
            return n.id
    return run.graph.nodes[-1].id


def to_bpmn(run: Run) -> str:
    g = run.graph
    pid = f"worklens_{run.id}"
    x_of = {n.id: 120 + i * (TASK_W + GAP) for i, n in enumerate(g.nodes)}
    start_x = 40
    end_x = 120 + len(g.nodes) * (TASK_W + GAP)
    first = g.nodes[0].id if g.nodes else None
    last = _last_node_id(run)

    flows: list[tuple[str, str, str]] = []  # id, source, target
    if first:
        flows.append(("flow_start", "start", first))
    for i, e in enumerate(g.edges):
        flows.append((f"flow_{i + 1}", e.source, e.target))
    if last:
        flows.append(("flow_end", last, "end"))

    out: list[str] = []
    out.append('<?xml version="1.0" encoding="UTF-8"?>')
    out.append(
        f'<bpmn:definitions xmlns:bpmn="{NS["bpmn"]}" xmlns:bpmndi="{NS["bpmndi"]}" '
        f'xmlns:dc="{NS["dc"]}" xmlns:di="{NS["di"]}" '
        f'id="defs_{run.id}" targetNamespace="https://worklens.purplelab.ai/bpmn" exporter="WorkLens" exporterVersion="0.1">'
    )
    out.append(f'  <bpmn:process id="{pid}" name="{escape(run.source)}" isExecutable="false">')
    out.append('    <bpmn:startEvent id="start" name="Start" />')
    for n in g.nodes:
        name = f"{n.application}: {n.action} ({_fmt(n.total_duration)}" + (f", {n.visits}x)" if n.visits > 1 else ")")
        doc = f"{n.visits} visit(s), {n.total_duration:.1f} s total, {n.share:.0%} of the recording. Object: {n.object or '-'}"
        out.append(f'    <bpmn:task id="{n.id}" name="{escape(name)}">')
        out.append(f"      <bpmn:documentation>{escape(doc)}</bpmn:documentation>")
        out.append("    </bpmn:task>")
    out.append('    <bpmn:endEvent id="end" name="End" />')
    for fid, s, t in flows:
        count = next((e.count for e in g.edges if e.source == s and e.target == t), 1)
        name = f' name="{count}x"' if count > 1 else ""
        out.append(f'    <bpmn:sequenceFlow id="{fid}" sourceRef="{s}" targetRef="{t}"{name} />')
    out.append("  </bpmn:process>")

    # diagram interchange
    out.append(f'  <bpmndi:BPMNDiagram id="diagram_{run.id}">')
    out.append(f'    <bpmndi:BPMNPlane id="plane_{run.id}" bpmnElement="{pid}">')
    out.append(
        f'      <bpmndi:BPMNShape id="start_di" bpmnElement="start"><dc:Bounds x="{start_x}" y="{Y + TASK_H // 2 - EVENT_R}" '
        f'width="{EVENT_R * 2}" height="{EVENT_R * 2}" /></bpmndi:BPMNShape>'
    )
    for n in g.nodes:
        out.append(
            f'      <bpmndi:BPMNShape id="{n.id}_di" bpmnElement="{n.id}"><dc:Bounds x="{x_of[n.id]}" y="{Y}" '
            f'width="{TASK_W}" height="{TASK_H}" /></bpmndi:BPMNShape>'
        )
    out.append(
        f'      <bpmndi:BPMNShape id="end_di" bpmnElement="end"><dc:Bounds x="{end_x}" y="{Y + TASK_H // 2 - EVENT_R}" '
        f'width="{EVENT_R * 2}" height="{EVENT_R * 2}" /></bpmndi:BPMNShape>'
    )
    loop_depth = 0
    for fid, s, t in flows:
        pts = _waypoints(s, t, x_of, start_x, end_x, loop_depth)
        if pts is None:
            continue
        if len(pts) > 2:
            loop_depth += 1
        wp = "".join(f'<di:waypoint x="{x}" y="{y}" />' for x, y in pts)
        out.append(f'      <bpmndi:BPMNEdge id="{fid}_di" bpmnElement="{fid}">{wp}</bpmndi:BPMNEdge>')
    out.append("    </bpmndi:BPMNPlane>")
    out.append("  </bpmndi:BPMNDiagram>")
    out.append("</bpmn:definitions>")
    xml = "\n".join(out) + "\n"
    ET.fromstring(xml)  # well-formedness check; raises on a bug
    return xml


def _waypoints(s: str, t: str, x_of: dict[str, int], start_x: int, end_x: int, depth: int):
    mid_y = Y + TASK_H // 2

    def right(nid: str) -> tuple[int, int]:
        return (start_x + EVENT_R * 2, mid_y) if nid == "start" else (x_of[nid] + TASK_W, mid_y)

    def left(nid: str) -> tuple[int, int]:
        return (end_x, mid_y) if nid == "end" else (x_of[nid], mid_y)

    if s == t:  # self loop: small detour above the task
        x = x_of[s]
        return [(x + TASK_W - 20, Y), (x + TASK_W - 20, Y - 40), (x + 20, Y - 40), (x + 20, Y)]
    sx = right(s)[0] if s != "start" else right(s)[0]
    tx = left(t)[0]
    if s == "start" or t == "end" or sx <= tx:
        return [right(s), left(t)]
    # backwards edge: route below the row, each loop one lane deeper
    lane_y = Y + TASK_H + 40 + depth * 30
    xs, xt = x_of[s] + TASK_W // 2, x_of[t] + TASK_W // 2
    return [(xs, Y + TASK_H), (xs, lane_y), (xt, lane_y), (xt, Y + TASK_H)]


# ------------------------------------------------------------- process BPMN

POOL_PAD, POOL_GAP, POOL_LABEL_W = 40, 80, 30


def to_process_bpmn(proc: Process, runs: list[Run]) -> str:
    """One pool (participant) per role, each with that recording's process; a message flow per handoff.

    Node ids are prefixed per recording (r0_n3) so two recordings can share a
    layout. Pools are stacked top to bottom in handoff order; tasks run left to
    right inside each pool, loops routed underneath as in the single-run file.
    """
    pid = f"worklens_{proc.id}"
    out: list[str] = []
    out.append('<?xml version="1.0" encoding="UTF-8"?>')
    out.append(
        f'<bpmn:definitions xmlns:bpmn="{NS["bpmn"]}" xmlns:bpmndi="{NS["bpmndi"]}" '
        f'xmlns:dc="{NS["dc"]}" xmlns:di="{NS["di"]}" '
        f'id="defs_{proc.id}" targetNamespace="https://worklens.purplelab.ai/bpmn" exporter="WorkLens" exporterVersion="0.2">'
    )
    out.append(f'  <bpmn:collaboration id="collab_{proc.id}">')
    for rec in proc.recordings:
        out.append(f'    <bpmn:participant id="pool_{rec.index}" name="{escape(rec.role)}" processRef="{pid}_r{rec.index}" />')
    for k, h in enumerate(proc.handoffs):
        name = f"handoff via {h.via}" + (f" · {h.object}" if h.object else "")
        out.append(
            f'    <bpmn:messageFlow id="hand_{k}" name="{escape(name)}" '
            f'sourceRef="r{h.from_ref.rec}_{h.from_ref.node_id}" targetRef="r{h.to_ref.rec}_{h.to_ref.node_id}" />'
        )
    out.append("  </bpmn:collaboration>")

    # processes
    flows_by_rec: list[list[tuple[str, str, str]]] = []
    for rec, run in zip(proc.recordings, runs):
        g = run.graph
        r = f"r{rec.index}_"
        out.append(f'  <bpmn:process id="{pid}_r{rec.index}" name="{escape(rec.role)}: {escape(run.source)}" isExecutable="false">')
        out.append(f'    <bpmn:startEvent id="{r}start" name="Start" />')
        for n in g.nodes:
            name = f"{n.application}: {n.action} ({_fmt(n.total_duration)}" + (f", {n.visits}x)" if n.visits > 1 else ")")
            out.append(f'    <bpmn:task id="{r}{n.id}" name="{escape(name)}" />')
        out.append(f'    <bpmn:endEvent id="{r}end" name="End" />')
        flows: list[tuple[str, str, str]] = []
        if g.nodes:
            flows.append((f"{r}flow_start", "start", g.nodes[0].id))
        for i, e in enumerate(g.edges):
            flows.append((f"{r}flow_{i + 1}", e.source, e.target))
        last = _last_node_id(run)
        if last:
            flows.append((f"{r}flow_end", last, "end"))
        for fid, a, b in flows:
            count = next((e.count for e in g.edges if e.source == a and e.target == b), 1)
            name = f' name="{count}x"' if count > 1 else ""
            out.append(f'    <bpmn:sequenceFlow id="{fid}" sourceRef="{r}{a}" targetRef="{r}{b}"{name} />')
        out.append("  </bpmn:process>")
        flows_by_rec.append(flows)

    # diagram: pools stacked vertically
    widest = max((len(run.graph.nodes) for run in runs), default=1)
    pool_w = POOL_LABEL_W + 120 + widest * (TASK_W + GAP) + EVENT_R * 2 + POOL_PAD
    pool_h = TASK_H + 2 * POOL_PAD + 40 + 30 * max((sum(1 for e in run.graph.edges if _is_back(run, e.source, e.target)) for run in runs), default=0)
    out.append(f'  <bpmndi:BPMNDiagram id="diagram_{proc.id}">')
    out.append(f'    <bpmndi:BPMNPlane id="plane_{proc.id}" bpmnElement="collab_{proc.id}">')
    centers: dict[str, tuple[int, int, int]] = {}  # prefixed node id -> (x, y_top, y_bottom)
    for rec, run, flows in zip(proc.recordings, runs, flows_by_rec):
        r = f"r{rec.index}_"
        oy = rec.index * (pool_h + POOL_GAP)  # offset so each pool has its own row
        out.append(
            f'      <bpmndi:BPMNShape id="pool_{rec.index}_di" bpmnElement="pool_{rec.index}" isHorizontal="true">'
            f'<dc:Bounds x="20" y="{oy + Y - POOL_PAD}" width="{pool_w}" height="{pool_h}" /></bpmndi:BPMNShape>'
        )
        g = run.graph
        x_of = {n.id: POOL_LABEL_W + 120 + i * (TASK_W + GAP) for i, n in enumerate(g.nodes)}
        start_x = POOL_LABEL_W + 40
        end_x = POOL_LABEL_W + 120 + len(g.nodes) * (TASK_W + GAP)
        out.append(
            f'      <bpmndi:BPMNShape id="{r}start_di" bpmnElement="{r}start"><dc:Bounds x="{start_x}" y="{oy + Y + TASK_H // 2 - EVENT_R}" '
            f'width="{EVENT_R * 2}" height="{EVENT_R * 2}" /></bpmndi:BPMNShape>'
        )
        for n in g.nodes:
            out.append(
                f'      <bpmndi:BPMNShape id="{r}{n.id}_di" bpmnElement="{r}{n.id}"><dc:Bounds x="{x_of[n.id]}" y="{oy + Y}" '
                f'width="{TASK_W}" height="{TASK_H}" /></bpmndi:BPMNShape>'
            )
            centers[f"{r}{n.id}"] = (x_of[n.id] + TASK_W // 2, oy + Y, oy + Y + TASK_H)
        out.append(
            f'      <bpmndi:BPMNShape id="{r}end_di" bpmnElement="{r}end"><dc:Bounds x="{end_x}" y="{oy + Y + TASK_H // 2 - EVENT_R}" '
            f'width="{EVENT_R * 2}" height="{EVENT_R * 2}" /></bpmndi:BPMNShape>'
        )
        depth = 0
        for fid, a, b in flows:
            pts = _waypoints(a, b, x_of, start_x, end_x, depth)
            if pts is None:
                continue
            if len(pts) > 2:
                depth += 1
            wp = "".join(f'<di:waypoint x="{x}" y="{y + oy}" />' for x, y in pts)
            out.append(f'      <bpmndi:BPMNEdge id="{fid}_di" bpmnElement="{fid}">{wp}</bpmndi:BPMNEdge>')
    for k, h in enumerate(proc.handoffs):
        a = centers.get(f"r{h.from_ref.rec}_{h.from_ref.node_id}")
        b = centers.get(f"r{h.to_ref.rec}_{h.to_ref.node_id}")
        if not a or not b:
            continue
        out.append(
            f'      <bpmndi:BPMNEdge id="hand_{k}_di" bpmnElement="hand_{k}">'
            f'<di:waypoint x="{a[0]}" y="{a[2]}" /><di:waypoint x="{b[0]}" y="{b[1]}" /></bpmndi:BPMNEdge>'
        )
    out.append("    </bpmndi:BPMNPlane>")
    out.append("  </bpmndi:BPMNDiagram>")
    out.append("</bpmn:definitions>")
    xml = "\n".join(out) + "\n"
    ET.fromstring(xml)
    return xml


def _is_back(run: Run, s: str, t: str) -> bool:
    order = {n.id: i for i, n in enumerate(run.graph.nodes)}
    return order.get(t, 0) < order.get(s, 0)
