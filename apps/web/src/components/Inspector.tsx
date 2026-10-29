"use client";

import type { Run, Step } from "@/lib/types";
import { fmtClock, fmtSeconds, fmtPct } from "@/lib/types";
import { frameUrl, hasFrame, type FrameSource } from "@/lib/view";
import type { MapModel, MapNode } from "@/lib/model";
import type { UFinding } from "@/lib/findings";
import type { Selection } from "./Timeline";

interface Props {
  model: MapModel; findings: UFinding[]; colors: Map<string, string>;
  tab: "findings" | "step"; onTab: (t: "findings" | "step") => void;
  selection: Selection; onSelectNode: (key: string | null, keepFinding?: boolean) => void; onSelectFinding: (i: number | null) => void;
  labelModel?: string; segModel?: string;
}

export default function Inspector({ model, findings, colors, tab, onTab, selection, onSelectNode, onSelectFinding, labelModel, segModel }: Props) {
  return (
    <aside className="card inspector" aria-label="Inspector">
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === "findings"} onClick={() => onTab("findings")}>Findings <span className="n">{findings.length}</span></button>
        <button className="tab" role="tab" aria-selected={tab === "step"} onClick={() => onTab("step")}>Step</button>
      </div>
      <div className="body">
        {tab === "findings" ? (
          <FindingsList model={model} findings={findings} selection={selection} onSelectFinding={onSelectFinding} onOpenStep={(key) => onSelectNode(key, true)} />
        ) : (
          <StepPanel model={model} colors={colors} nodeKey={selection.nodeKey} labelModel={labelModel} segModel={segModel} />
        )}
      </div>
    </aside>
  );
}

function stepRef(model: MapModel, r: { rec: number; step: number }): string {
  if (model.recs.length === 1) return String(r.step);
  const role = model.recs[r.rec].role ?? `R${r.rec + 1}`;
  return `${role.split(/\s+/).map((w) => w[0]).join("").toUpperCase()}${r.step}`;
}

function FindingsList({ model, findings, selection, onSelectFinding, onOpenStep }: { model: MapModel; findings: UFinding[]; selection: Selection; onSelectFinding: (i: number | null) => void; onOpenStep: (key: string) => void }) {
  if (findings.length === 0) {
    return <div className="empty">No long step, loop or re-keying found in this recording. The map and steps are still available; a longer recording gives the rules more to find.</div>;
  }
  const multi = model.recs.length > 1;
  return (
    <ul className="flist" role="tabpanel">
      {findings.map((f, i) => {
        const open = selection.findingIndex === i;
        const refs = f.refs.map((r) => stepRef(model, r));
        const steps = refs.length > 4 ? `${refs[0]}–${refs[refs.length - 1]}` : refs.join(", ");
        return (
          <li key={f.key} className={`frow${open ? " open" : ""}`}>
            <button aria-expanded={open} onClick={() => onSelectFinding(open ? null : i)}>
              <span className="rank">{i + 1}</span>
              <span>
                <div className="ftitle">{f.title}</div>
                <div className="fmeta"><span className={`sev ${f.cross ? "cross" : f.severity}`}>{f.cross ? "across roles" : f.severity}</span><span>{f.ruleLabel}</span><span>steps {steps}</span>{multi && !f.cross && f.role && <span>{f.role}</span>}</div>
              </span>
              <span className="ftime">{fmtSeconds(f.seconds)}<div style={{ fontSize: ".76rem", color: "var(--text-3)", fontWeight: 400, textAlign: "right" }}>{fmtPct(f.share)}</div></span>
            </button>
            {open && (
              <div className="fbody">
                <p>{f.detail}</p>
                <div className="thumbs">
                  {f.evidence.slice(0, 3).map((e, k) => {
                    const rec = model.recs[e.rec]; if (!rec) return null;
                    const t = rec.run.frames[Math.min(e.frame, rec.run.frames.length - 1)]?.t ?? 0;
                    return <figure key={k}><img src={frameUrl(rec.run, rec.src, e.frame)} alt={`Evidence frame ${e.frame}`} loading="lazy" /><figcaption>{multi ? `${(rec.role ?? "").slice(0, 8)} ` : ""}{fmtClock(t)}</figcaption></figure>;
                  })}
                </div>
                <div className="rowacts">
                  <span className="btn sm on" aria-live="polite">Highlighted on map</span>
                  {f.nodeKeys[0] && <button className="btn sm" onClick={(e) => { e.stopPropagation(); onOpenStep(f.nodeKeys[0]); }}>Open step</button>}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StepPanel({ model, colors, nodeKey, labelModel, segModel }: { model: MapModel; colors: Map<string, string>; nodeKey: string | null; labelModel?: string; segModel?: string }) {
  const node = model.nodes.find((n) => n.key === nodeKey);
  if (!node) return <div className="empty">Select a box on the map, a segment on the timeline or a row in Steps to see its frames, what changed and how the models labelled it.</div>;
  const rec = model.recs[node.rec]; const run = rec.run; const src = rec.src;
  const steps = node.steps.map((i) => run.steps[i]);
  const fields = [...new Set(steps.flatMap((s) => s.label?.data_fields ?? []))];
  const W0 = run.frame_width ?? 0, H0 = run.frame_height ?? 0;
  const regionsAt = (f: number) => (run.regions ?? []).filter((r) => r.frame === f);
  return (
    <div className="sel" role="tabpanel">
      <h3><span style={{ color: colors.get(node.application) }}>{node.application}</span> · {node.action}</h3>
      <div className="sub">{model.recs.length > 1 && rec.role ? <><b>{rec.role}</b> · </> : null}{fmtSeconds(node.dur)} · {fmtPct(node.share)} of the {model.recs.length > 1 ? "process" : "recording"}{node.visits > 1 ? ` · ${node.visits} visits` : ""}{node.wait ? " · waiting on the system" : ""}</div>
      <dl className="kv">
        <dt>Object</dt><dd>{objectOf(run, node) || "–"}</dd>
        <dt>Label by</dt><dd>{labelModel ?? "Muse Spark"} · confidence {steps[0]?.label ? steps[0].label.confidence.toFixed(2) : "–"}</dd>
        <dt>Steps</dt><dd>{steps.map((s) => `${s.index} (${fmtClock(s.t_start)})`).join(", ")}</dd>
      </dl>
      {fields.length > 0 && (
        <>
          <h4>Fields seen</h4>
          <div className="chips">{fields.map((f) => <span key={f}>{f}</span>)}</div>
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

const objectOf = (run: Run, node: MapNode): string => run.graph.nodes.find((n) => n.id === node.id)?.object ?? "";

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
