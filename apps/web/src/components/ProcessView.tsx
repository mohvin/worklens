"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Process } from "@/lib/types";
import { fmtClock, fmtSeconds, fmtPct } from "@/lib/types";
import { buildModel, laneColors, type MapRecording } from "@/lib/model";
import { processFindings } from "@/lib/findings";
import type { ProcessRec } from "@/lib/runs";
import Timeline, { type Selection } from "./Timeline";
import ProcessMap from "./ProcessMap";
import StepsTable from "./StepsTable";
import Inspector from "./Inspector";

interface Props { proc: Process; recs: ProcessRec[]; processedAt?: string | null }

export default function ProcessView({ proc, recs, processedAt }: Props) {
  const [sel, setSel] = useState<Selection>({ nodeKey: null, findingIndex: null });
  const [tab, setTab] = useState<"map" | "steps">("map");
  const [itab, setItab] = useState<"findings" | "step">("findings");
  const [zoom, setZoom] = useState<"fit" | 1>(1);

  const model = useMemo(() => {
    const mapRecs: MapRecording[] = proc.recordings.map((r, i) => {
      const rec = recs.find((x) => x.id === r.run_id);
      const hand = proc.handoffs.find((h) => h.to_ref.rec === i);
      return { run: rec!.run!, src: { base: rec!.frameBase, available: rec!.frames }, role: r.role, handoff: hand ? `${hand.via}${hand.object ? ` · ${hand.object.toUpperCase()}` : ""}` : undefined };
    });
    return buildModel(mapRecs);
  }, [proc, recs]);
  const colors = useMemo(() => laneColors(model), [model]);
  const findings = useMemo(() => processFindings(proc, model), [proc, model]);
  const total = model.total;
  const flagged = findings.reduce((a, f) => a + f.seconds, 0);
  const cross = findings.filter((f) => f.cross);
  const finding = sel.findingIndex === null ? null : findings[sel.findingIndex];
  const hotKeys = new Set(finding ? finding.nodeKeys : []);
  const labelModel = model.recs[0]?.run.model_calls.find((c) => c.stage === "label")?.model;
  const segModel = model.recs[0]?.run.model_calls.find((c) => c.stage === "segment")?.model;

  const selectNode = (key: string | null, keepFinding = false) => {
    setSel((s) => ({ nodeKey: key, findingIndex: keepFinding ? s.findingIndex : null }));
    setItab("step");
  };
  const selectFinding = (i: number | null) => {
    setSel({ nodeKey: i === null ? null : findings[i].nodeKeys[0] ?? null, findingIndex: i });
    setItab("findings");
  };

  return (
    <main className="page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Runs</Link><span>›</span><span>{proc.name}</span></nav>
      <div className="pagehead">
        <div>
          <h1>{proc.name}<span className="chip brand">Process · {proc.recordings.length} recording{proc.recordings.length === 1 ? "" : "s"}</span></h1>
          <div className="meta">
            {processedAt && <>Merged <b>{processedAt}</b> · </>}
            {proc.recordings.map((r, i) => <span key={r.run_id}>{i > 0 && " → "}<b>{r.role}</b> <Link href={`/runs/${r.run_id}`} style={{ color: "var(--text-2)" }}>{r.source}</Link> {fmtClock(r.duration)}</span>)}
            {" · "}{proc.summary.handoffs} handoff{proc.summary.handoffs === 1 ? "" : "s"}
          </div>
        </div>
        <div className="actions">
          <a className="btn" href={`/api/processes/${proc.id}/export?format=json`}>Export JSON</a>
          <a className="btn" href={`/api/processes/${proc.id}/export?format=bpmn`}>Export BPMN</a>
        </div>
      </div>

      <section className="kpis" aria-label="Process summary">
        <div className="kpi"><div className="l">Recordings</div><div className="v">{proc.recordings.length}</div><div className="c">{proc.summary.roles.join(" → ")} · {fmtClock(total)} of work</div></div>
        <div className={`kpi${flagged > 0 ? " alert" : ""}`}><div className="l">Time flagged</div><div className="v">{fmtSeconds(flagged)}<small>{fmtPct(flagged / total)}</small></div><div className="c">{findings.length} finding{findings.length === 1 ? "" : "s"}, {findings.filter((f) => f.severity === "high").length} high · {cross.length} across roles</div></div>
        <div className="kpi"><div className="l">Waiting</div><div className="v">{fmtSeconds(proc.summary.wait_duration)}<small>{fmtPct(proc.summary.wait_duration / total)}</small></div><div className="c">system load time, not work</div></div>
        <div className="kpi"><div className="l">Handoffs</div><div className="v">{proc.summary.handoffs}</div><div className="c">{proc.handoffs.length ? `via ${[...new Set(proc.handoffs.map((h) => h.via))].join(", ")}${proc.handoffs.every((h) => h.matched) ? "" : " · some by order only"}` : "single role"}</div></div>
        <div className="kpi"><div className="l">Loops</div><div className="v">{proc.summary.loops}</div><div className="c">{proc.summary.loops ? "a screen visited again after leaving it" : "no screen revisited"}</div></div>
      </section>

      <div className="cols">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <section className="card" aria-label="Timeline">
            <div className="card-h"><h2>Timeline</h2><span className="hint">one bar per recording · hover to scrub · click a segment to inspect the step</span></div>
            <Timeline model={model} colors={colors} findings={findings} selection={sel} onSelectNode={(k) => selectNode(k)} onSelectFinding={selectFinding} />
          </section>

          <section className="card">
            <div className="tabs" role="tablist">
              <button className="tab" role="tab" aria-selected={tab === "map"} onClick={() => setTab("map")}>Process map</button>
              <button className="tab" role="tab" aria-selected={tab === "steps"} onClick={() => setTab("steps")}>Steps <span className="n">{proc.summary.steps}</span></button>
              <span style={{ flex: 1 }} />
              {tab === "map" && <span className="hint" style={{ fontSize: ".82rem", color: "var(--text-3)", alignSelf: "center", paddingRight: 8 }}>columns are applications · one band per role · dashed purple arrow is the handoff</span>}
              {tab === "map" && <span className="zoom"><button className={`btn sm${zoom === "fit" ? " on" : ""}`} onClick={() => setZoom("fit")}>Fit</button><button className={`btn sm${zoom === 1 ? " on" : ""}`} onClick={() => setZoom(1)}>100%</button></span>}
            </div>
            {tab === "map" ? (
              <ProcessMap model={model} colors={colors} selectedKey={sel.nodeKey} hotKeys={hotKeys} zoom={zoom} onSelect={(key) => selectNode(key)} />
            ) : (
              <div style={{ overflowX: "auto" }}>
                {model.recs.map((r, i) => (
                  <div key={i}>
                    <div className="section-h" style={{ padding: "0 12px" }}>{r.role}<span>{r.run.source} · {fmtClock(r.run.duration)}</span></div>
                    <StepsTable run={r.run} rec={i} colors={colors} selectedKey={sel.nodeKey} onSelect={(key) => selectNode(key)} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <Inspector model={model} findings={findings} colors={colors} tab={itab} onTab={setItab} selection={sel} onSelectNode={selectNode} onSelectFinding={selectFinding} labelModel={labelModel} segModel={segModel} />
      </div>
      <footer className="foot"><span>Each recording processed on its own (pixel-diff, {segModel ?? "SAM 3.1"}, {labelModel ?? "Muse Spark"}) · handoffs and findings across roles matched on shared identifiers, deterministic</span></footer>
    </main>
  );
}
