"""Tie each step to the application that was really on screen, from the browser tab log.

The Chrome extension records every tab switch as {t: seconds from start, host, title}.
Muse Spark names applications freely ("Odoo", "Odoo Purchase", "Mail"), which splits one
application over several lanes. When a tab-log entry covers a step and its host plausibly
matches what the model said, the model's name is replaced by one canonical name per host.

Steps the log cannot vouch for (a desktop app while a Chrome tab stays "active", or a name
that shares nothing with the host) keep the model's label.
"""
from __future__ import annotations

import re
from typing import Any

from .models import Run

# host fragment -> canonical application name
KNOWN: list[tuple[str, str]] = [
    ("mail.google.com", "Gmail"), ("outlook.", "Outlook"), ("outlook.office", "Outlook"),
    ("docs.google.com/spreadsheets", "Google Sheets"), ("sheets.google.com", "Google Sheets"),
    ("docs.google.com", "Google Docs"), ("drive.google.com", "Google Drive"), ("calendar.google.com", "Google Calendar"),
    ("odoo.com", "Odoo"), ("salesforce.com", "Salesforce"), ("lightning.force.com", "Salesforce"), ("hubspot.com", "HubSpot"),
    ("zoho.com", "Zoho"), ("atlassian.net", "Jira"), ("jira.", "Jira"), ("confluence.", "Confluence"),
    ("slack.com", "Slack"), ("teams.microsoft.com", "Teams"), ("notion.so", "Notion"), ("github.com", "GitHub"),
    ("sharepoint.com", "SharePoint"), ("office.com", "Microsoft 365"), ("xero.com", "Xero"), ("quickbooks.", "QuickBooks"),
    ("sap.com", "SAP"), ("servicenow.com", "ServiceNow"), ("zendesk.com", "Zendesk"), ("workday.com", "Workday"),
    ("worklens", "WorkLens"), ("vercel.app", "Web app"),
]
GENERIC = {"browser", "chrome", "web", "web browser", "website", "web app", "webpage", "tab", "unknown"}
# module names a model may use instead of the suite's name (Odoo "Accounting", SAP "Finance", Zoho "Books")
SUITES = {"Odoo", "SAP", "Zoho", "Microsoft 365", "Workday", "QuickBooks", "Xero", "Salesforce", "HubSpot", "ServiceNow", "Web app"}
MODULES = {"accounting", "invoicing", "purchase", "purchasing", "sales", "inventory", "crm", "finance", "books", "payroll", "expenses", "projects",
           "manufacturing", "helpdesk", "erp", "bills", "vendor bills", "accounts payable", "accounts receivable", "procurement", "timesheets", "dashboard"}
STOP = {"the", "and", "app", "web", "page", "tab", "com", "www"}


def canonical_name(host: str) -> str:
    h = (host or "").lower()
    for frag, name in KNOWN:
        if frag in h:
            return name
    parts = [p for p in h.split(".") if p and p != "www"]
    if len(parts) >= 2:
        parts = parts[:-1]  # drop the TLD
    stem = parts[-1] if parts else h
    return stem.replace("-", " ").title() if stem else "Browser"


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]{3,}", (text or "").lower()) if t not in STOP}


def plausible(model_app: str, host: str, canonical: str) -> bool:
    """Would a person agree the model's application and this host are the same thing?"""
    m = (model_app or "").strip().lower()
    if not m or m in GENERIC:
        return True
    toks = _tokens(m)
    if not toks:
        return True
    if canonical in SUITES and (m in MODULES or any(t in MODULES for t in toks)):
        return True
    target = _tokens(host) | _tokens(canonical)
    if toks & target:
        return True
    # "Mail" vs mail.google.com → Gmail; "Sheets" vs Google Sheets: substring either way
    return any(t in host.lower() or t in canonical.lower() or canonical.lower() in t for t in toks)


def entry_at(log: list[dict[str, Any]], t: float) -> dict[str, Any] | None:
    cur = None
    for e in log:
        try:
            if float(e.get("t", 0)) <= t + 0.5:
                cur = e
            else:
                break
        except (TypeError, ValueError):
            continue
    return cur


def apply_tab_log(run: Run, log: list[dict[str, Any]] | None) -> tuple[Run, int]:
    """Rewrite step applications from the tab log where it is safe. Returns (run, steps changed)."""
    if not log:
        return run, 0
    log = sorted((e for e in log if isinstance(e, dict) and e.get("host")), key=lambda e: float(e.get("t", 0) or 0))
    changed = 0
    for s in run.steps:
        if not s.label:
            continue
        mid = (s.t_start + s.t_end) / 2
        e = entry_at(log, mid)
        if not e:
            continue
        name = canonical_name(str(e.get("host", "")))
        if name == s.label.application:
            continue
        if plausible(s.label.application, str(e.get("host", "")), name):
            s.label.application = name
            changed += 1
    return run, changed
