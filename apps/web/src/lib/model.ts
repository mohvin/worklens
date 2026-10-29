import type { Run } from "./types";
import type { FrameSource } from "./view";

// The map model: one or more recordings laid out as a single ordered flow.
// Lanes are applications (shared across recordings), nodes keep the order in
// which screens were first seen, and a recording after the first joins the
// previous one through a handoff edge. A single run is the one-recording case.

export interface MapRecording { run: Run; src: FrameSource; role?: string; handoff?: string }

export interface MapNode {
  key: string;            // `r<rec>:<node id>`
  rec: number;
  role?: string;
  id: string;
  lane: number;
  application: string;
  action: string;
  dur: number;
  share: number;          // of the whole model
  visits: number;
  wait: boolean;
  steps: number[];
  frame: number;          // first frame of the first step, for the thumbnail
  order: number;
}

export interface MapEdge { s: string; t: string; count: number; kind: "seq" | "hand"; label?: string }

export interface MapModel { recs: MapRecording[]; nodes: MapNode[]; edges: MapEdge[]; lanes: string[]; total: number }

export const nodeKey = (rec: number, id: string) => `r${rec}:${id}`;
export const splitKey = (key: string): { rec: number; id: string } => {
  const m = /^r(\d+):(.*)$/.exec(key);
  return m ? { rec: Number(m[1]), id: m[2] } : { rec: 0, id: key };
};

export function buildModel(recs: MapRecording[]): MapModel {
  const total = recs.reduce((a, r) => a + (r.run.summary.total_duration || r.run.duration), 0) || 1;
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const lanes: string[] = [];
  const laneOf = (app: string) => {
    let i = lanes.indexOf(app);
    if (i < 0) { lanes.push(app); i = lanes.length - 1; }
    return i;
  };
  recs.forEach((rec, r) => {
    const run = rec.run;
    const base = nodes.length;
    run.graph.nodes.forEach((n, i) => {
      nodes.push({
        key: nodeKey(r, n.id), rec: r, role: rec.role, id: n.id, lane: laneOf(n.application), application: n.application, action: n.action,
        dur: n.total_duration, share: n.total_duration / total, visits: n.visits, wait: n.is_wait, steps: n.step_indexes,
        frame: run.steps[n.step_indexes[0]]?.frame_start ?? 0, order: base + i,
      });
    });
    run.graph.edges.forEach((e) => edges.push({ s: nodeKey(r, e.source), t: nodeKey(r, e.target), count: e.count, kind: "seq" }));
    if (r > 0) {
      const prev = recs[r - 1].run;
      const last = prev.graph.nodes[prev.graph.nodes.length - 1];
      const first = run.graph.nodes[0];
      if (last && first) edges.push({ s: nodeKey(r - 1, last.id), t: nodeKey(r, first.id), count: 1, kind: "hand", label: rec.handoff });
    }
  });
  return { recs, nodes, edges, lanes, total };
}

/** Application → palette slot, in lane order. */
export function laneColors(model: MapModel): Map<string, string> {
  const m = new Map<string, string>();
  model.lanes.forEach((l, i) => m.set(l, `var(--app-${i % 6})`));
  return m;
}
