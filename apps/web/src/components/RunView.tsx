"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Run } from "@/lib/types";
import { fmtClock, fmtSeconds, fmtPct } from "@/lib/types";
import { appColors, type FrameSource } from "@/lib/view";
import { buildModel, nodeKey, splitKey } from "@/lib/model";
import Timeline from "./Timeline";
import ProcessMap from "./ProcessMap";
import StepsTable from "./StepsTable";
import Inspector from "./Inspector";

export interface Selection { nodeId: string | null; findingIndex: number | null }

interface Props { run: Run; frameBase: string; frames: number[] | null; sample: boolean; processedAt?: string | null; costUsd?: number }

export default function RunView({ run, frameBase, frames, sample, processedAt, costUsd }: Props) {
  const [sel, setSel] = useState<Selection>({ nodeId: null, findingIndex: null });
  const [tab, setTab] = useState<"map" | "steps">("map");
  const [itab, setItab] = useState<"findings" | "step">("findings");
  const [zoom, setZoom] = useState<"fit" | 1>(1);
  const src = useMemo<FrameSource>(() => ({ base: frameBase, available: frames }), [frameBase, frames]);
  const colors = useMemo(() => appColors(run), [run]);
  const model = useMemo(() => buildModel([{ run, src }]), [run, src]);
  const total = run.summary.total_duration || run.duration;
  const lost = run.findings.reduce((a, f) => a + f.seconds, 0);
  const labelCalls = run.model_calls.filter((c) => c.stage === "label");
  const segCalls = run.model_calls.filter((c) => c.stage === "segment");
  const cost = costUsd ?? run.model_calls.reduce((a, c) => a + c.cost_usd, 0);
  const finding = sel.findingIndex === null ? null : run.findings[sel.findingIndex];
  const hotNodes = new Set(finding ? [...finding.node_ids, ...run.graph.nodes.filter((n) => n.step_indexes.some((i) => finding.step_indexes.includes(i))).map((n) => n.id)] : []);
  const hotSteps = new Set(finding ? finding.step_indexes : []);
  const kept = run.frames.filter((f) => f.kept).length;

  const selectNode = (id: string | null, keepFinding = false) => {
    setSel((s) => ({ nodeId: id, findingIndex: keepFinding ? s.findingIndex : null }));
    setItab("step");
  };
  const selectFinding = (i: number | null) => {
    setSel({ nodeId: i === null ? null : run.findings[i].node_ids[0] ?? null, findingIndex: i });
    setItab("findings");
  };

  return (
    <main className="page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Runs</Link><span>›</span><span>{run.source}</span></nav>
      <div className="pagehead">
        <div>
          <h1>{run.source}<span className="chip ok">{sample ? "Replay sample" : "Built"}</span></h1>
          <div className="meta">
            {processedAt && <>Processed <b>{processedAt}</b> · </>}
            <b>{fmtClock(total)}</b> recording{run.frame_width ? `, ${run.frame_width}×${run.frame_height}` : ""}
            {segCalls.length > 0 && <> · {segCalls.length} SAM 3.1 calls</>}
            {labelCalls.length > 0 && <> · {labelCalls.length} Muse Spark calls{labelCalls.some((c) => c.cached) ? `, ${labelCalls.filter((c) => c.cached).length} from cache` : ""}</>}
            {cost > 0 && <> · ${cost.toFixed(2)}</>}
          </div>
        </div>
        <div className="actions">
          <a className="btn" href={`/api/runs/${run.id}/export?format=json`}>Export JSON</a>
          <a className="btn" href={`/api/runs/${run.id}/export?format=bpmn`}>Export BPMN</a>
        </div>
      </div>

      <section className="kpis" aria-label="Run summary">
        <div className="kpi"><div className="l">Recorded</div><div className="v">{fmtClock(total)}</div><div className="c">{run.steps.length} steps · {kept} of {run.frames.length} frames kept</div></div>
        <div className={`kpi${lost > 0 ? " alert" : ""}`}><div className="l">Time flagged</div><div className="v">{fmtSeconds(lost)}<small>{fmtPct(lost / total)}</small></div><div className="c">{run.findings.length} finding{run.findings.length === 1 ? "" : "s"}{run.findings.length ? `, ${run.findings.filter((f) => f.severity === "high").length} high` : ""}</div></div>
        <div className="kpi"><div className="l">Waiting</div><div className="v">{fmtSeconds(run.summary.wait_duration)}<small>{fmtPct(run.summary.wait_duration / total)}</small></div><div className="c">system load time, not work</div></div>
        <div className="kpi"><div className="l">App switches</div><div className="v">{run.summary.app_switches}</div><div className="c">across {run.summary.applications.length} applications</div></div>
        <div className="kpi"><div className="l">Loops</div><div className="v">{run.summary.loops}</div><div className="c">{run.summary.loops ? "a screen visited again after leaving it" : "no screen revisited"}</div></div>
      </section>

      <div className="cols">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <section className="card" aria-label="Timeline">
            <div className="card-h"><h2>Timeline</h2><span className="hint">hover to scrub · click a segment to inspect the step</span></div>
            <Timeline run={run} src={src} colors={colors} selection={sel} hotSteps={hotSteps} onSelectNode={(id) => selectNode(id)} onSelectFinding={selectFinding} />
          </section>

          <section className="card">
            <div className="tabs" role="tablist">
              <button className="tab" role="tab" aria-selected={tab === "map"} onClick={() => setTab("map")}>Process map</button>
              <button className="tab" role="tab" aria-selected={tab === "steps"} onClick={() => setTab("steps")}>Steps <span className="n">{run.steps.length}</span></button>
              <span style={{ flex: 1 }} />
              {tab === "map" && <span className="hint" style={{ fontSize: ".82rem", color: "var(--text-3)", alignSelf: "center", paddingRight: 8 }}>columns are applications · read top to bottom · a jump between columns is an app switch</span>}
              {tab === "map" && <span className="zoom"><button className={`btn sm${zoom === "fit" ? " on" : ""}`} onClick={() => setZoom("fit")}>Fit</button><button className={`btn sm${zoom === 1 ? " on" : ""}`} onClick={() => setZoom(1)}>100%</button></span>}
            </div>
            {tab === "map" ? (
              <ProcessMap model={model} colors={colors} selectedKey={sel.nodeId ? nodeKey(0, sel.nodeId) : null} hotKeys={new Set([...hotNodes].map((id) => nodeKey(0, id)))} zoom={zoom} onSelect={(key) => selectNode(key ? splitKey(key).id : null)} />
            ) : (
              <div style={{ overflowX: "auto" }}><StepsTable run={run} colors={colors} selectedId={sel.nodeId} onSelect={(id) => selectNode(id)} /></div>
            )}
          </section>
        </div>

        <Inspector run={run} src={src} colors={colors} tab={itab} onTab={setItab} selection={sel} onSelectNode={selectNode} onSelectFinding={selectFinding} labelModel={labelCalls[0]?.model} segModel={segCalls[0]?.model} />
      </div>
      <footer className="foot"><span>Boundaries by pixel-diff{segCalls.length ? `, what changed by ${segCalls[0].model}` : ""} · labels by {labelCalls[0]?.model ?? "Muse Spark"} · graph and findings deterministic</span></footer>
    </main>
  );
}
