import type { Process, Run, Severity } from "./types";
import { nodeKey, type MapModel } from "./model";
import { findingLabel } from "./view";

// One shape for findings from a single recording and findings across roles,
// so the timeline, the map and the inspector draw both the same way.
export interface UFinding {
  key: string;
  title: string;
  detail: string;
  severity: Severity;
  ruleLabel: string;
  seconds: number;
  share: number;                       // of the whole model
  refs: { rec: number; step: number }[];
  nodeKeys: string[];
  evidence: { rec: number; frame: number }[];
  role?: string;                       // the recording it belongs to, when the model has roles
  cross: boolean;                      // true for findings across roles
}

const SEV: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function runFindings(run: Run, rec: number, total: number, role?: string): UFinding[] {
  return run.findings.map((f, i) => {
    const nodes = new Set(f.node_ids);
    run.graph.nodes.forEach((n) => { if (n.step_indexes.some((s) => f.step_indexes.includes(s))) nodes.add(n.id); });
    return {
      key: `r${rec}:f${i}`, title: f.title, detail: f.detail, severity: f.severity, ruleLabel: findingLabel[f.rule],
      seconds: f.seconds, share: f.seconds / total,
      refs: f.step_indexes.map((step) => ({ rec, step })), nodeKeys: [...nodes].map((id) => nodeKey(rec, id)),
      evidence: f.evidence_frames.map((frame) => ({ rec, frame })), role, cross: false,
    };
  });
}

export const processRuleLabel: Record<Process["findings"][number]["rule"], string> = {
  "cross-check": "Checked twice",
  "cross-rekey": "Re-keyed across roles",
  "handoff-detour": "Handoff detour",
};

/** Findings across roles first, then each recording's own, by severity then time. */
export function processFindings(proc: Process, model: MapModel): UFinding[] {
  const total = model.total;
  const cross: UFinding[] = proc.findings.map((f, i) => ({
    key: `p:f${i}`, title: f.title, detail: f.detail, severity: f.severity, ruleLabel: processRuleLabel[f.rule],
    seconds: f.seconds, share: f.seconds / total,
    refs: f.refs.map((r) => ({ rec: r.rec, step: r.step })),
    nodeKeys: [...new Set(f.refs.filter((r) => r.node_id).map((r) => nodeKey(r.rec, r.node_id)))],
    evidence: f.evidence.map((e) => ({ rec: e.rec, frame: e.frame })), cross: true,
  }));
  const own = model.recs.flatMap((r, i) => runFindings(r.run, i, total, r.role));
  const all = [...cross, ...own];
  return all.sort((a, b) => (a.cross !== b.cross ? (a.cross ? -1 : 1) : SEV[a.severity] - SEV[b.severity] || b.seconds - a.seconds));
}
