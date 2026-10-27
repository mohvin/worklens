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
from .models import Run

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
