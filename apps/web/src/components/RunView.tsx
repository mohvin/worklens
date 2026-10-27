"use client";

import { useMemo, useState } from "react";
import type { Run } from "@/lib/types";
import { fmtSeconds, fmtPct } from "@/lib/types";
import { appColors } from "@/lib/view";
import Timeline from "./Timeline";
import ProcessMap from "./ProcessMap";
import NodeDrawer from "./NodeDrawer";
import Findings from "./Findings";
import StepsTable from "./StepsTable";

export interface Selection { nodeId: string | null; findingIndex: number | null }

export default function RunView({ run }: { run: Run }) {
  const [sel, setSel] = useState<Selection>({ nodeId: null, findingIndex: null });
  const colors = useMemo(() => appColors(run), [run]);
  const total = run.summary.total_duration || run.duration;
  const lost = run.findings.reduce((a, f) => a + f.seconds, 0);
  const calls = run.model_calls.length;
  const cost = run.model_calls.reduce((a, c) => a + c.cost_usd, 0);
  const finding = sel.findingIndex === null ? null : run.findings[sel.findingIndex];
  const hotNodes = new Set(finding ? finding.node_ids : []);
  const hotSteps = new Set(finding ? finding.step_indexes : []);

  const selectNode = (id: string | null) => setSel({ nodeId: id, findingIndex: null });
  const selectFinding = (i: number | null) =>
    setSel({ nodeId: i === null ? null : run.findings[i].node_ids[0] ?? null, findingIndex: i });

  return (
    <main className="wrap">
      <div className="runhead">
        <h1>
          {run.source}
          <small>run {run.id}</small>
        </h1>
        <div className="facts">
          <span><b>{fmtSeconds(total)}</b> recorded</span>
          <span><b>{run.steps.length}</b> steps</span>
          <span><b>{run.summary.applications.length}</b> applications, <b>{run.summary.app_switches}</b> switches</span>
          {run.summary.wait_duration > 0 && <span><b>{fmtSeconds(run.summary.wait_duration)}</b> waiting</span>}
          {lost > 0 && <span className="lost"><b>{fmtSeconds(lost)}</b> flagged by {run.findings.length} finding{run.findings.length === 1 ? "" : "s"}</span>}
          {calls > 0 && (
            <span>
              <b>{calls}</b> Muse Spark calls, ${cost.toFixed(2)}
              {run.model_calls.some((c) => c.cached) && ` (${run.model_calls.filter((c) => c.cached).length} replayed from cache)`}
            </span>
          )}
          <span style={{ marginLeft: "auto" }}>
            <a href={`/api/runs/${run.id}/export?format=bpmn`}>Download BPMN</a>
            {" · "}
            <a href={`/api/runs/${run.id}/export?format=json`}>JSON</a>
          </span>
        </div>
      </div>

      <section className="block" aria-label="Timeline">
        <Timeline run={run} colors={colors} selection={sel} hotSteps={hotSteps} onSelectNode={selectNode} onSelectFinding={selectFinding} />
      </section>

      <section className="block">
        <h2>Process map <span>one box per screen, in the order first seen; click a box to see its frames</span></h2>
        <ProcessMap run={run} colors={colors} selectedId={sel.nodeId} hotNodes={hotNodes} onSelect={selectNode} />
      </section>

      <section className="block">
        <NodeDrawer run={run} colors={colors} nodeId={sel.nodeId} hotSteps={hotSteps} onClose={() => selectNode(null)} />
      </section>

      <section className="block">
        <h2>
          Where the time goes{" "}
          <span>{run.findings.length === 0 ? "nothing flagged" : `${fmtSeconds(lost)} of ${fmtSeconds(total)} (${fmtPct(lost / total)}) across ${run.findings.length} finding${run.findings.length === 1 ? "" : "s"}`}</span>
        </h2>
        <Findings run={run} activeIndex={sel.findingIndex} onSelect={selectFinding} />
      </section>

      <section className="block">
        <h2>Steps <span>what Muse Spark saw on each screen</span></h2>
        <StepsTable run={run} colors={colors} selectedId={sel.nodeId} onSelect={selectNode} />
      </section>

      <footer className="foot">
        <span>Boundaries by {run.boundaries[0]?.method ?? "pixel-diff"} · labels by {run.model_calls[0]?.model ?? "Muse Spark"} · graph and findings deterministic</span>
      </footer>
    </main>
  );
}
