"""Offline tests for the process merge: handoff detection and the cross-role rules.

The clerk recording is the synthetic-invoice fixture; the approver recording is
a small labelled run written here, so no model calls are needed.
"""
from __future__ import annotations

import pytest

from worklens_worker.graph import build
from worklens_worker.models import Frame, Run, Step, StepLabel
from worklens_worker.process import build_process, find_handoff
from worklens_worker.rules import run_rules

from test_graph_rules import labelled_run


def mk_run(run_id: str, source: str, rows: list[tuple[float, str, str, list[str]]]) -> Run:
    """rows: (duration, application, action, data_fields)"""
    run = Run(id=run_id, source=source, status="labelled")
    t = 0.0
    for i, (d, app, action, fields) in enumerate(rows):
        run.steps.append(Step(index=i, t_start=t, t_end=t + d, duration=d, frame_start=int(t), frame_end=int(t + d) - 1, label=StepLabel(application=app, action=action, object="", data_fields=fields, confidence=0.9)))
        t += d
    run.duration = t
    run.frames = [Frame(index=i, t=float(i), path=f"frames/f{i:06d}.jpg", phash="0" * 16) for i in range(int(t))]
    return run_rules(build(run))


def approver_run(extra: list[tuple[float, str, str, list[str]]] | None = None) -> Run:
    rows = [
        (5, "Mail", "open approval request", ["Subject: Invoice INV-20481 - approval", "AP-000912"]),
        (9, "ERP - Accounts Payable", "wait for invoice AP-000912 to load", []),
        (14, "ERP - Accounts Payable", "check invoice against PO", ["Invoice no: INV-20481", "PO: PO-7731", "Amount: 4,250.00"]),
        (8, "Sheets", "check PO in register", ["PO-7731", "Acme Supplies", "4,250.00", "Received"]),
    ] + (extra or []) + [
        (6, "ERP - Accounts Payable", "approve invoice", ["Status: Approved", "AP-000912"]),
        (5, "Mail", "reply approved", ["Invoice INV-20481 approved"]),
    ]
    return mk_run("approver1", "approver-review.mp4", rows)


@pytest.fixture(scope="module")
def clerk() -> Run:
    return run_rules(build(labelled_run()))


def test_handoff_matches_on_shared_identifier(clerk):
    runs = [clerk, approver_run()]
    h = find_handoff(runs, 0, 1)
    assert h.from_ref.rec == 0 and clerk.steps[h.from_ref.step].label.action == "send approval reply"
    assert h.to_ref.rec == 1 and runs[1].steps[h.to_ref.step].label.action == "open approval request"
    assert h.via == "Mail" and h.matched and h.object == "ap-000912"
    assert h.from_ref.node_id and h.to_ref.node_id


def test_handoff_falls_back_to_sequence_when_nothing_matches(clerk):
    other = mk_run("x", "x.mp4", [(4, "CRM", "open ticket", ["T-1"]), (6, "CRM", "close ticket", [])])
    h = find_handoff([clerk, other], 0, 1)
    assert not h.matched and h.object == ""
    assert h.to_ref.step == 0


def test_cross_check_finds_the_same_check_by_both_roles(clerk):
    p = build_process("p1", "Invoice approval", [clerk, approver_run()], ["AP clerk", "Approver"])
    f = next(x for x in p.findings if x.rule == "cross-check")
    assert "Sheets" in f.title and "AP clerk" in f.title and "Approver" in f.title
    assert f.seconds == pytest.approx(9 + 8)
    assert {(r.rec, r.step) for r in f.refs} == {(0, 6), (1, 3)}
    assert all(r.node_id for r in f.refs)
    assert len({(e.rec, e.frame) for e in f.evidence}) == 2


def test_cross_rekey_flags_values_typed_again_by_the_next_role(clerk):
    extra = [(11, "ERP - Accounts Payable", "enter PO number", ["PO: PO-7731", "Supplier: Acme Supplies"])]
    p = build_process("p1", "Invoice approval", [clerk, approver_run(extra)], ["AP clerk", "Approver"])
    f = next(x for x in p.findings if x.rule == "cross-rekey")
    assert f.title.startswith("Approver re-keys into ERP - Accounts Payable")
    assert f.seconds == 11 and [(r.rec, r.step) for r in f.refs] == [(1, 4)]
    # values the approver's own ERP already showed earlier are not re-keying: INV-20481 was on step 2
    assert "inv-20481" not in f.detail.lower()


def test_no_cross_rekey_without_a_fill_step(clerk):
    p = build_process("p1", "Invoice approval", [clerk, approver_run()], ["AP clerk", "Approver"])
    assert not [x for x in p.findings if x.rule == "cross-rekey"]


def test_handoff_detour_costs_the_round_trip_through_mail(clerk):
    p = build_process("p1", "Invoice approval", [clerk, approver_run()], ["AP clerk", "Approver"])
    f = next(x for x in p.findings if x.rule == "handoff-detour")
    assert f.title == "Work leaves ERP - Accounts Payable for Mail to hand over and comes back"
    # clerk steps 8-10 in Mail (3+2+6) + approver step 0 in Mail (5) + the ERP reload wait (9)
    assert f.seconds == pytest.approx(3 + 2 + 6 + 5 + 9)
    assert (1, 1) in {(r.rec, r.step) for r in f.refs}


def test_process_summary_and_ordering(clerk):
    p = build_process("p1", "Invoice approval", [clerk, approver_run()], ["AP clerk", "Approver"])
    assert p.status == "built" and [r.role for r in p.recordings] == ["AP clerk", "Approver"]
    assert p.summary.handoffs == 1 and p.summary.roles == ["AP clerk", "Approver"]
    assert p.summary.total_duration == pytest.approx(95 + 47)
    assert p.summary.run_findings == len(clerk.findings) + len(approver_run().findings)
    assert p.summary.applications[:2] == ["Mail", "PDF Viewer"]
    sev = [f.severity for f in p.findings]
    assert sev == sorted(sev, key=lambda s: {"high": 0, "medium": 1, "low": 2}[s])
    assert abs(sum(f.share for f in p.findings) - sum(f.seconds for f in p.findings) / p.summary.total_duration) < 0.01


def test_single_recording_process_has_no_handoff(clerk):
    p = build_process("p1", "Solo", [clerk], ["AP clerk"])
    assert p.handoffs == [] and p.findings == [] and p.summary.handoffs == 0


def test_process_bpmn_has_a_pool_per_role_and_a_message_flow_per_handoff(clerk):
    from xml.etree import ElementTree as ET

    from worklens_worker.export import NS, to_process_bpmn

    runs = [clerk, approver_run()]
    p = build_process("p1", "Invoice approval", runs, ["AP clerk", "Approver"])
    xml = to_process_bpmn(p, runs)
    root = ET.fromstring(xml)
    pools = root.findall(".//bpmn:participant", NS)
    assert [x.get("name") for x in pools] == ["AP clerk", "Approver"]
    flows = root.findall(".//bpmn:messageFlow", NS)
    assert len(flows) == 1 and flows[0].get("sourceRef") == "r0_" + p.handoffs[0].from_ref.node_id
    tasks = root.findall(".//bpmn:task", NS)
    assert len(tasks) == len(clerk.graph.nodes) + len(runs[1].graph.nodes)
    assert len(root.findall(".//bpmndi:BPMNShape", NS)) == len(pools) + len(tasks) + 4  # + start/end per pool
    ids = [t.get("id") for t in tasks]
    assert len(ids) == len(set(ids))
