"use client";

import type { Run, Step } from "@/lib/types";
import { fmtClock, fmtSeconds, fmtPct } from "@/lib/types";
import { frameUrl, findingLabel, hasFrame, stepsOf, type FrameSource } from "@/lib/view";
import type { Selection } from "./RunView";

interface Props {
  run: Run; src: FrameSource; colors: Map<string, string>;
  tab: "findings" | "step"; onTab: (t: "findings" | "step") => void;
  selection: Selection; onSelectNode: (id: string | null, keepFinding?: boolean) => void; onSelectFinding: (i: number | null) => void;
  labelModel?: string; segModel?: string;
}

export default function Inspector({ run, src, colors, tab, onTab, selection, onSelectNode, onSelectFinding, labelModel, segModel }: Props) {
  return (
    <aside className="card inspector" aria-label="Inspector">
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === "findings"} onClick={() => onTab("findings")}>Findings <span className="n">{run.findings.length}</span></button>
        <button className="tab" role="tab" aria-selected={tab === "step"} onClick={() => onTab("step")}>Step</button>
      </div>
      <div className="body">
        {tab === "findings" ? (
          <FindingsList run={run} src={src} selection={selection} onSelectFinding={onSelectFinding} onOpenStep={(id) => onSelectNode(id, true)} />
        ) : (
          <StepPanel run={run} src={src} colors={colors} nodeId={selection.nodeId} labelModel={labelModel} segModel={segModel} />
        )}
      </div>
    </aside>
  );
}

function FindingsList({ run, src, selection, onSelectFinding, onOpenStep }: { run: Run; src: FrameSource; selection: Selection; onSelectFinding: (i: number | null) => void; onOpenStep: (id: string) => void }) {
  if (run.findings.length === 0) {
    return <div className="empty">No long step, loop or re-keying found in this recording. The map and steps are still available; a longer recording gives the rules more to find.</div>;
  }
  return (
    <ul className="flist" role="tabpanel">
      {run.findings.map((f, i) => {
        const open = selection.findingIndex === i;
        const steps = f.step_indexes.length > 3 ? `${f.step_indexes[0]}–${f.step_indexes[f.step_indexes.length - 1]}` : f.step_indexes.join(", ");
        return (
          <li key={i} className={`frow${open ? " open" : ""}`}>
            <button aria-expanded={open} onClick={() => onSelectFinding(open ? null : i)}>
              <span className="rank">{i + 1}</span>
              <span>
                <div className="ftitle">{f.title}</div>
                <div className="fmeta"><span className={`sev ${f.severity}`}>{f.severity}</span><span>{findingLabel[f.rule]}</span><span>steps {steps}</span></div>
              </span>
              <span className="ftime">{fmtSeconds(f.seconds)}<div style={{ fontSize: ".76rem", color: "var(--text-3)", fontWeight: 400, textAlign: "right" }}>{fmtPct(f.share)}</div></span>
            </button>
            {open && (
              <div className="fbody">
                <p>{f.detail}</p>
                <div className="thumbs">
                  {f.evidence_frames.slice(0, 3).map((fi) => (
                    <figure key={fi}><img src={frameUrl(run, src, fi)} alt={`Evidence frame ${fi}`} loading="lazy" /><figcaption>{fmtClock(run.frames[Math.min(fi, run.frames.length - 1)]?.t ?? 0)}</figcaption></figure>
                  ))}
                </div>
                <div className="rowacts">
                  <span className="btn sm on" aria-live="polite">Highlighted on map</span>
                  {f.node_ids[0] && <button className="btn sm" onClick={(e) => { e.stopPropagation(); onOpenStep(f.node_ids[0]); }}>Open step</button>}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StepPanel({ run, src, colors, nodeId, labelModel, segModel }: { run: Run; src: FrameSource; colors: Map<string, string>; nodeId: string | null; labelModel?: string; segModel?: string }) {
  const node = run.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return <div className="empty">Select a box on the map, a segment on the timeline or a row in Steps to see its frames, what changed and how the models labelled it.</div>;
  const steps = stepsOf(run, node);
  const fields = [...new Set(steps.flatMap((s) => s.label?.data_fields ?? []))];
  const W0 = run.frame_width ?? 0, H0 = run.frame_height ?? 0;
  const regionsAt = (f: number) => (run.regions ?? []).filter((r) => r.frame === f);
  return (
    <div className="sel" role="tabpanel">
      <h3><span style={{ color: colors.get(node.application) }}>{node.application}</span> · {node.action}</h3>
      <div className="sub">{fmtSeconds(node.total_duration)} · {fmtPct(node.share)} of the recording{node.visits > 1 ? ` · ${node.visits} visits` : ""}{node.is_wait ? " · waiting on the system" : ""}</div>
      <dl className="kv">
        <dt>Object</dt><dd>{node.object || "–"}</dd>
        <dt>Label by</dt><dd>{labelModel ?? "Muse Spark"} · confidence {steps[0].label ? steps[0].label.confidence.toFixed(2) : "–"}</dd>
        <dt>Steps</dt><dd>{steps.map((s) => `${s.index} (${fmtClock(s.t_start)})`).join(", ")}</dd>
      </dl>
      {(node.object || fields.length > 0) && (
        <>
          <h4>Fields seen</h4>
          <div className="chips">{node.object && <span className="obj">{node.object}</span>}{fields.map((f) => <span key={f}>{f}</span>)}</div>
        </>
      )}
      {steps.map((s) => <StepFrames key={s.index} run={run} src={src} step={s} W0={W0} H0={H0} regionsAt={regionsAt} />)}
      <h4>Provenance</h4>
      <div className="prov">
        <span>Boundaries: pixel-diff</span>
        {segModel && <span>Changed element: {segModel}</span>}
        <span>Label: {labelModel ?? "Muse Spark"}, temperature 0, strict JSON</span>
      </div>
    </div>
  );
}

function StepFrames({ run, src, step: s, W0, H0, regionsAt }: { run: Run; src: FrameSource; step: Step; W0: number; H0: number; regionsAt: (f: number) => NonNullable<Run["regions"]> }) {
  const b = run.boundaries.find((x) => x.frame_after === s.frame_start);
  const regs = regionsAt(s.frame_start);
  const el = regs.find((r) => r.kind === "changed element");
  const sw = regs.some((r) => r.kind === "screen change");
  const inStep = run.frames.filter((f) => f.index >= s.frame_start && f.index <= s.frame_end);
  const kept = inStep.filter((f) => f.kept && hasFrame(src, f.index));
  const shown = kept.length ? kept : inStep.filter((f) => hasFrame(src, f.index)).slice(0, 1);
  const pad = 12;
  return (
    <>
      <h4>Step {s.index} · {fmtClock(s.t_start)}–{fmtClock(s.t_end)} · {fmtSeconds(s.duration)}{s.label_error && <span className="err"> · unlabelled: {s.label_error}</span>}</h4>
      {b && (
        <p style={{ margin: "0 0 8px", color: "var(--text-2)" }}>
          {sw ? `Began with a screen switch (${fmtPct(b.changed_fraction ?? 0)} of the screen changed).`
            : el ? `Began when a ${el.x2 - el.x1}×${el.y2 - el.y1} px element changed. SAM 3.1 isolated it (${el.confidence.toFixed(2)}); Muse Spark read the close-up.`
            : `Began with a change on ${fmtPct(b.changed_fraction ?? 0)} of the screen.`}
        </p>
      )}
      {el && W0 > 0 && (
        <figure>
          <svg className="frame" viewBox={`${Math.max(0, el.x1 - pad)} ${Math.max(0, el.y1 - pad)} ${el.x2 - el.x1 + 2 * pad} ${el.y2 - el.y1 + 2 * pad}`} style={{ background: "var(--brand-soft)" }} role="img" aria-label="Close-up of the changed element">
            <image href={frameUrl(run, src, s.frame_start)} />
            <rect x={el.x1} y={el.y1} width={el.x2 - el.x1} height={el.y2 - el.y1} fill="none" stroke="var(--brand)" strokeWidth={Math.max(1.5, (el.x2 - el.x1 + 2 * pad) / 200)} />
          </svg>
          <figcaption>Close-up: what changed (SAM 3.1)</figcaption>
        </figure>
      )}
      {shown.map((f) => (
        <figure key={f.index}>
          {W0 > 0 ? (
            <svg className="frame" viewBox={`0 0 ${W0} ${H0}`} role="img" aria-label={`Frame at ${fmtClock(f.t)}`}>
              <image href={frameUrl(run, src, f.index)} width={W0} height={H0} />
              {el && f.index === s.frame_start && <rect x={el.x1} y={el.y1} width={el.x2 - el.x1} height={el.y2 - el.y1} fill="var(--brand)" fillOpacity={0.12} stroke="var(--brand)" strokeWidth={3} />}
            </svg>
          ) : (
            <img className="frame" src={frameUrl(run, src, f.index)} alt={`Frame at ${fmtClock(f.t)}`} loading="lazy" />
          )}
          <figcaption>{fmtClock(f.t)} · frame {f.index}{kept.length ? ` · ${kept.length} of ${inStep.length} frames kept after de-dupe` : ""}</figcaption>
        </figure>
      ))}
    </>
  );
}
