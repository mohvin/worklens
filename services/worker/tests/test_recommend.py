"""Offline tests for the recommendations: fix catalogue, model classification handling, overlap maths and target."""
from __future__ import annotations

import pytest

from worklens_worker.graph import build
from worklens_worker.models import AIClassification, ModelCall, Run
from worklens_worker.process import build_process
from worklens_worker.recommend import FACTORS, apply_decision, build_recommendations, count_overlaps, fix_catalogue
from worklens_worker.rules import run_rules

from test_graph_rules import labelled_run
from test_process import approver_run


@pytest.fixture(scope="module")
def runs():
    return [run_rules(build(labelled_run())), approver_run()]


@pytest.fixture(scope="module")
def proc(runs):
    return build_process("p1", "Invoice approval", runs, ["AP clerk", "Approver"])


ROLES = ["AP clerk", "Approver"]


class StubClient:
    """Stands in for LLMClient: returns a canned classification, or None to simulate failure."""

    def __init__(self, answer):
        self.answer = answer
        self.cfg = type("cfg", (), {"model": "muse-spark-1.3"})()
        self.calls = []

    def structured(self, system, user, images, schema, name):
        call = ModelCall(stage="recommend", model="muse-spark-1.3", cache_key="x", cached=False, latency_s=0.1, error=None if self.answer else "boom")
        return self.answer, call


def canned(runs):
    # clerk: n3 read PDF, n5 fill form -> document extraction; n6 check PO -> lookup; approver m5 approve -> model says automate (must be downgraded)
    return {"screens": [
        {"key": "r0:n4", "disposition": "automate", "mechanism": "document_extraction", "rationale": "The invoice PDF holds every value typed later.", "stays_human": "Review of extracted values.", "guardrail": "Confidence below 0.9 routes to the clerk.", "data_needed": ["supplier PDF"], "confidence": "high"},
        {"key": "r0:n6", "disposition": "automate", "mechanism": "document_extraction", "rationale": "Fields are copied from the PDF.", "stays_human": "Confirm before saving.", "guardrail": "Totals must match the PO.", "data_needed": ["supplier PDF"], "confidence": "high"},
        {"key": "r0:n7", "disposition": "automate", "mechanism": "lookup_validation", "rationale": "PO-7731 exists in the register.", "stays_human": "Exceptions.", "guardrail": "Mismatch flagged.", "data_needed": ["PO register"], "confidence": "high"},
        {"key": "r1:n5", "disposition": "automate", "mechanism": "straight_through", "rationale": "Click approve.", "stays_human": "", "guardrail": "", "data_needed": [], "confidence": "medium"},
        {"key": "r1:n2", "disposition": "automate", "mechanism": "straight_through", "rationale": "waiting", "stays_human": "", "guardrail": "", "data_needed": [], "confidence": "low"},
        {"key": "r9:zz", "disposition": "automate", "mechanism": "prefill", "rationale": "bogus", "stays_human": "", "guardrail": "", "data_needed": [], "confidence": "low"},
        {"key": "r0:n3", "disposition": "assist", "mechanism": "teleport", "rationale": "not on the menu", "stays_human": "", "guardrail": "", "data_needed": [], "confidence": "low"},
    ]}


def test_fix_catalogue_covers_the_process_findings(runs, proc):
    items = fix_catalogue(runs, ROLES, proc)
    kinds = {(i.finding_keys[0], i.mechanism) for i in items}
    assert ("p:f0", "in_app_approval") in kinds or ("p:f1", "in_app_approval") in kinds
    assert any(i.mechanism == "remove_step" and "second check" in i.title for i in items)
    loop = next(i for i in items if i.mechanism == "merge_steps")
    assert loop.seconds_raw == 15.0 and loop.confidence == "medium"
    assert [r.step for r in loop.refs] == [8, 9, 10, 11]  # the return trip only
    wait = next(i for i in items if i.mechanism == "reorder")
    assert wait.seconds_raw == 0 and wait.potential_seconds == 21.0 and wait.confidence == "low"
    for i in items:
        assert i.refs and i.finding_keys and i.method, i.id


def test_model_answers_are_validated_and_decisions_never_automated(runs, proc):
    recs = build_recommendations(runs, ROLES, proc, client=StubClient(canned(runs)))
    ai = {i.id: i for i in recs.items if i.source == "model"}
    assert set(ai) == {"ai-r0:n4", "ai-r0:n6", "ai-r0:n7", "ai-r1:n5", "ai-r1:n2"}  # bogus key and off-menu mechanism dropped
    assert ai["ai-r1:n5"].kind == "assist"            # approve is a decision: downgraded
    assert ai["ai-r1:n2"].kind == "keep_human"         # waiting stays human, no mechanism
    assert ai["ai-r0:n4"].factor == FACTORS["document_extraction"] and ai["ai-r0:n4"].seconds_raw == pytest.approx(8 * 0.8)
    assert recs.model == "muse-spark-1.3" and recs.prompt_version == "rec-v1" and recs.summary.ai_unavailable is None


def test_model_failure_keeps_the_fix_path(runs, proc):
    recs = build_recommendations(runs, ROLES, proc, client=StubClient(None))
    assert all(i.source == "rule" for i in recs.items)
    assert recs.summary.ai_unavailable and "boom" in recs.summary.ai_unavailable
    assert recs.summary.fix_seconds > 0


def test_overlaps_are_counted_once_and_never_exceed_the_total(runs, proc):
    recs = build_recommendations(runs, ROLES, proc, client=StubClient(canned(runs)))
    total = recs.summary.total_seconds
    assert recs.summary.counted_seconds <= total
    assert recs.target.seconds_after >= 0 and recs.target.seconds_before == pytest.approx(total)
    assert recs.target.seconds_before - recs.target.seconds_after == pytest.approx(recs.summary.counted_seconds, abs=0.01)
    # the Sheets check appears in the cross-check fix and in the lookup AI item: the second one gets less
    fix = next(i for i in recs.items if i.mechanism == "remove_step")
    look = next(i for i in recs.items if i.id == "ai-r0:n7")
    assert fix.seconds_saved == pytest.approx(8.0)
    assert look.seconds_saved <= look.seconds_raw
    for i in recs.items:
        assert i.seconds_saved <= i.seconds_raw + 1e-6
        assert all(s.seconds_counted <= s.seconds_before + 1e-6 for s in i.savings)


def test_target_marks_steps_and_keeps_the_decision(runs, proc):
    recs = build_recommendations(runs, ROLES, proc, client=StubClient(canned(runs)))
    t = recs.target
    disp = {(s.ref.rec, s.ref.step): s.disposition for s in t.steps}
    assert disp[(0, 3)] == "automate"           # read PDF
    assert disp[(1, 3)] == "remove"             # approver's second PO check
    assert disp[(1, 4)] in ("keep", "assist")    # approve invoice never removed/automated
    assert t.handoff_in_app and t.steps_after < t.steps_before and t.app_switches_after <= t.app_switches_before
    assert t.human_decisions_kept >= 1 or disp[(1, 4)] == "assist"
    assert recs.target_accepted.seconds_after == pytest.approx(recs.target_accepted.seconds_before)  # nothing accepted yet


def test_decisions_are_recorded_and_recomputed_without_the_model(runs, proc):
    recs = build_recommendations(runs, ROLES, proc, client=StubClient(canned(runs)))
    fix = next(i for i in recs.items if i.mechanism == "in_app_approval")
    recs2 = apply_decision(recs, runs, ROLES, proc, fix.id, "accepted", "Mohan", "do it in Odoo")
    it = next(i for i in recs2.items if i.id == fix.id)
    assert it.status == "accepted" and it.decided_by == "Mohan" and it.note == "do it in Odoo" and it.decided_at
    assert recs2.summary.accepted == 1 and recs2.target_accepted.seconds_after < recs2.target_accepted.seconds_before
    assert recs2.model == "muse-spark-1.3" and len(recs2.classification) == len(recs.classification)
    recs3 = apply_decision(recs2, runs, ROLES, proc, fix.id, "rejected", "Mohan", None)
    assert next(i for i in recs3.items if i.id == fix.id).seconds_saved == 0
    assert recs3.summary.counted_seconds < recs2.summary.counted_seconds
    with pytest.raises(KeyError):
        apply_decision(recs3, runs, ROLES, proc, "nope", "accepted", None, None)


def test_single_run_without_process(runs):
    recs = build_recommendations(runs[:1], ["AP clerk"], None, client=None)
    assert recs.summary.ai_unavailable == "no model configured for the AI path"
    assert recs.items and all(i.path == "fix" for i in recs.items)
    assert recs.target.handoffs_before == 0
