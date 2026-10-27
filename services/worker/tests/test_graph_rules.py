"""Offline tests for the graph builder, the bottleneck rules and the exports.

Uses the labels Muse Spark produced for samples/synthetic-invoice.mp4
(tests/fixtures/synthetic_labels.json) so no model calls are needed.
"""
from __future__ import annotations

import json
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

from worklens_worker.export import NS, to_bpmn, to_json
from worklens_worker.graph import build
from worklens_worker.models import Frame, Run, Step, StepLabel
from worklens_worker.rules import run_rules

FIXTURE = Path(__file__).with_name("fixtures") / "synthetic_labels.json"


def labelled_run(drop_labels: set[int] = frozenset()) -> Run:
    data = json.loads(FIXTURE.read_text())
    run = Run(id="fixture1", source=data["source"], duration=data["duration"], status="labelled")
    run.frames = [Frame(index=i, t=float(i), path=f"frames/f{i:06d}.jpg", phash="0" * 16) for i in range(int(data["duration"]))]
    for i, s in enumerate(data["steps"]):
        step = Step(
            index=i, t_start=s["t_start"], t_end=s["t_end"], duration=s["t_end"] - s["t_start"],
            frame_start=int(s["t_start"]), frame_end=int(s["t_end"]) - 1,
        )
        if i not in drop_labels:
            step.label = StepLabel(**{k: s[k] for k in ("application", "action", "object", "data_fields", "confidence")})
        else:
            step.label_error = "simulated model error"
        run.steps.append(step)
    return run


@pytest.fixture(scope="module")
def built() -> Run:
    return run_rules(build(labelled_run()))


def test_graph_merges_repeated_screens_and_keeps_order(built):
    g = built.graph
    assert [n.action for n in g.nodes][:4] == ["select invoice email", "open invoice email", "open attachment", "read invoice PDF"]
    assert len(g.nodes) == 11  # 12 steps, "select invoice email" visited twice
    sel = next(n for n in g.nodes if n.action == "select invoice email")
    assert sel.visits == 2 and sel.step_indexes == [0, 8] and sel.total_duration == 7.0
    assert all(n.visits == 1 for n in g.nodes if n is not sel)


def test_graph_sums_durations_and_shares(built):
    g = built.graph
    assert round(sum(n.total_duration for n in g.nodes), 3) == 95.0
    assert abs(sum(n.share for n in g.nodes) - 1.0) < 0.01
    wait = next(n for n in g.nodes if n.action.startswith("wait"))
    assert wait.is_wait and wait.share == pytest.approx(21 / 95, abs=0.001)


def test_edges_follow_the_sequence(built):
    g = built.graph
    by_id = {n.id: n for n in g.nodes}
    assert len(g.edges) == 11  # 12 visits -> 11 transitions, all distinct
    assert all(e.count == 1 for e in g.edges)
    # the loop: "fill invoice form and submit" -> "select invoice email"
    back = [e for e in g.edges if by_id[e.target].action == "select invoice email"]
    assert len(back) == 1 and by_id[back[0].source].action == "fill invoice form and submit"


def test_summary(built):
    s = built.summary
    assert s.steps == 12 and s.labelled_steps == 12
    assert s.applications == ["ERP - Accounts Payable", "Mail", "PDF Viewer", "Sheets"]
    assert s.app_switches == 5  # Mail>PDF>ERP>Sheets>ERP>Mail
    assert s.loops == 1
    assert s.wait_duration == 21.0 and s.longest_step_index == 4


def test_rules_find_the_three_planted_bottlenecks(built):
    rules = {f.rule for f in built.findings}
    assert rules == {"long-step", "loop", "app-switch-copy"}

    long = next(f for f in built.findings if f.rule == "long-step")
    assert long.step_indexes == [4] and long.seconds == 21.0 and long.severity == "medium"
    assert "waiting" in long.title
    assert long.evidence_frames == [20, 30, 40]

    loop = next(f for f in built.findings if f.rule == "loop")
    assert loop.title == "Back to Mail 2 times"
    assert loop.step_indexes == [0, 1, 2, 8, 9, 10, 11] and loop.evidence_frames == [0, 80]
    assert loop.seconds == 15.0 and loop.severity == "high"  # the whole return trip, 16% of the recording
    assert "PDF Viewer → ERP - Accounts Payable → Sheets → ERP - Accounts Payable" in loop.detail

    copy = next(f for f in built.findings if f.rule == "app-switch-copy")
    assert copy.title == "Values re-keyed from PDF Viewer into ERP - Accounts Payable"
    assert copy.step_indexes == [3, 5] or copy.step_indexes == [3, 4, 5]
    assert any("4,250.00" in v for v in [copy.detail])


def test_findings_sorted_by_severity_then_time(built):
    ranks = {"high": 0, "medium": 1, "low": 2}
    keys = [(ranks[f.severity], -f.seconds) for f in built.findings]
    assert keys == sorted(keys)


def test_unlabelled_steps_are_kept_in_the_graph():
    run = run_rules(build(labelled_run(drop_labels={6})))
    unk = [n for n in run.graph.nodes if n.application == "Unknown"]
    assert len(unk) == 1 and unk[0].step_indexes == [6]
    assert round(sum(n.total_duration for n in run.graph.nodes), 3) == 95.0


def test_loop_inside_one_application_is_costed_on_the_repeated_screen():
    run = labelled_run()
    # make the Sheets check happen inside the ERP: form -> lookup screen in ERP -> same form
    run.steps[6].label.application = "ERP - Accounts Payable"
    run.steps[6].label.action = "look up PO"
    run.steps[7].label.action = "fill invoice form"  # same screen as step 5
    run = run_rules(build(run))
    loops = [f for f in run.findings if f.rule == "loop"]
    inner = next(f for f in loops if "fill invoice form" in f.title)
    assert inner.step_indexes == [5, 7] and inner.seconds == 13.0
    assert "look up PO" in inner.detail


def test_detour_and_back_is_not_a_re_keying():
    run = labelled_run()
    # after the Sheets check the user continues the same ERP form, with the same values on screen
    run.steps[7].label.data_fields = ["Supplier: Acme Supplies", "PO: PO-7731", "Due date: 2026-11-14"]
    run = run_rules(build(run))
    titles = [f.title for f in run.findings if f.rule == "app-switch-copy"]
    assert "Values re-keyed from PDF Viewer into ERP - Accounts Payable" in titles
    assert not any(t.startswith("Values re-keyed from Sheets") for t in titles)


def test_json_export_roundtrips(built):
    again = Run.model_validate_json(to_json(built))
    assert again.graph == built.graph and again.findings == built.findings


def test_bpmn_is_well_formed_with_diagram(built):
    xml = to_bpmn(built)
    root = ET.fromstring(xml)
    assert root.tag == f"{{{NS['bpmn']}}}definitions"
    proc = root.find("bpmn:process", NS)
    tasks = proc.findall("bpmn:task", NS)
    flows = proc.findall("bpmn:sequenceFlow", NS)
    assert len(tasks) == len(built.graph.nodes)
    assert len(flows) == len(built.graph.edges) + 2  # start and end flows
    ids = {el.get("id") for el in proc}
    for f in flows:
        assert f.get("sourceRef") in ids and f.get("targetRef") in ids
    plane = root.find("bpmndi:BPMNDiagram/bpmndi:BPMNPlane", NS)
    assert plane.get("bpmnElement") == proc.get("id")
    shapes = {s.get("bpmnElement") for s in plane.findall("bpmndi:BPMNShape", NS)}
    edges = {e.get("bpmnElement") for e in plane.findall("bpmndi:BPMNEdge", NS)}
    assert shapes == {t.get("id") for t in tasks} | {"start", "end"}
    assert edges == {f.get("id") for f in flows}
    for e in plane.findall("bpmndi:BPMNEdge", NS):
        assert len(e.findall("di:waypoint", NS)) >= 2
