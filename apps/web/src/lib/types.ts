// Mirrors services/worker/worklens_worker/models.py (packages/schema/run.schema.json).

export interface Frame { index: number; t: number; path: string; phash: string; kept: boolean }
export interface Boundary { index: number; t: number; frame_before: number; frame_after: number; score: number; method: string; changed_fraction?: number; change_box?: number[] | null }
export interface Region { frame: number; kind: "changed element" | "screen change"; x1: number; y1: number; x2: number; y2: number; confidence: number }
export interface StepLabel { application: string; action: string; object: string; data_fields: string[]; confidence: number }
export interface Step {
  index: number; t_start: number; t_end: number; duration: number;
  frame_start: number; frame_end: number; label: StepLabel | null; label_error: string | null;
}
export interface ModelCall {
  stage: string; model: string; cache_key: string; cached: boolean; latency_s: number;
  prompt_tokens: number; completion_tokens: number; cost_usd: number; ok: boolean; error: string | null;
}
export interface Node {
  id: string; application: string; action: string; object: string; visits: number;
  total_duration: number; step_indexes: number[]; avg_duration: number; share: number; is_wait: boolean;
}
export interface Edge { source: string; target: string; count: number }
export interface Graph { nodes: Node[]; edges: Edge[] }
export type Severity = "low" | "medium" | "high";
export interface Finding {
  rule: "long-step" | "loop" | "app-switch-copy"; title: string; detail: string; severity: Severity;
  step_indexes: number[]; evidence_frames: number[]; node_ids: string[]; seconds: number; share: number;
}
export interface Summary {
  total_duration: number; steps: number; labelled_steps: number; applications: string[];
  app_switches: number; loops: number; wait_duration: number; longest_step_index: number | null;
}
export interface Run {
  id: string; source: string; duration: number; fps_sampled: number; status: string;
  frame_width?: number; frame_height?: number;
  frames: Frame[]; boundaries: Boundary[]; regions?: Region[]; steps: Step[]; graph: Graph; summary: Summary;
  findings: Finding[]; model_calls: ModelCall[];
}

export const fmtSeconds = (s: number): string => {
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  if (s >= 90) return `${(s / 60).toFixed(1)} min`;
  return `${Math.round(s)} s`;
};
export const fmtClock = (s: number): string => {
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};
export const fmtPct = (x: number): string => `${Math.round(x * 100)}%`;

// ---- a process: several recordings, one per role, joined by handoffs ----
export interface Recording { index: number; run_id: string; role: string; source: string; duration: number; steps: number; findings: number }
export interface Ref { rec: number; step: number; node_id: string }
export interface FrameRef { rec: number; frame: number }
export interface Handoff { from_ref: Ref; to_ref: Ref; via: string; object: string; matched: boolean }
export interface ProcessFinding {
  rule: "cross-check" | "cross-rekey" | "handoff-detour"; title: string; detail: string; severity: Severity;
  refs: Ref[]; evidence: FrameRef[]; seconds: number; share: number;
}
export interface ProcessSummary {
  total_duration: number; wait_duration: number; steps: number; applications: string[]; roles: string[];
  app_switches: number; loops: number; handoffs: number; run_findings: number;
}
export interface Process {
  id: string; name: string; status: "created" | "building" | "built" | "failed";
  recordings: Recording[]; handoffs: Handoff[]; findings: ProcessFinding[]; summary: ProcessSummary;
}
