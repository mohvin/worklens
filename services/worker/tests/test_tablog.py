from worklens_worker.models import Run, Step, StepLabel
from worklens_worker.tablog import apply_tab_log, canonical_name, plausible


def _run(apps):
    steps = [Step(index=i, t_start=i * 10.0, t_end=i * 10.0 + 10, duration=10, frame_start=i * 10, frame_end=i * 10 + 9,
                  label=StepLabel(application=a, action="do", object="x", confidence=0.9)) for i, a in enumerate(apps)]
    return Run(id="t", source="t.webm", duration=len(apps) * 10.0, steps=steps)


def test_canonical_names():
    assert canonical_name("mail.google.com") == "Gmail"
    assert canonical_name("alm-corp.odoo.com") == "Odoo"
    assert canonical_name("www.example-crm.io") == "Example Crm"


def test_plausible():
    assert plausible("Odoo Purchase", "alm-corp.odoo.com", "Odoo")
    assert plausible("Mail", "mail.google.com", "Gmail")
    assert plausible("Browser", "anything.com", "Anything")
    assert not plausible("PDF Viewer", "mail.google.com", "Gmail")
    assert not plausible("Excel", "alm-corp.odoo.com", "Odoo")
    assert plausible("Accounting", "alm-corp.odoo.com", "Odoo")
    assert plausible("Odoo Accounting", "alm-corp.odoo.com", "Odoo")
    assert not plausible("Accounting", "mail.google.com", "Gmail")


def test_apply_tab_log_rewrites_only_plausible():
    run = _run(["Gmail", "Mail", "PDF Viewer", "Odoo Purchase", "Odoo - Purchase", "Excel"])
    log = [{"t": 0, "host": "mail.google.com"}, {"t": 30, "host": "alm-corp.odoo.com"}]
    run, n = apply_tab_log(run, log)
    assert [s.label.application for s in run.steps] == ["Gmail", "Gmail", "PDF Viewer", "Odoo", "Odoo", "Excel"]
    assert n == 3


def test_apply_tab_log_empty():
    run = _run(["Mail"])
    assert apply_tab_log(run, None)[1] == 0
