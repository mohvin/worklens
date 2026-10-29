"use client";

import { useMemo, useState } from "react";
import type { Run } from "@/lib/types";
import FrameWithRegions, { RegionCloseup } from "./FrameWithRegions";
import { fmtClock, fmtSeconds, fmtPct } from "@/lib/types";
import { frameUrl, hasFrame, stepsOf, type FrameSource } from "@/lib/view";

interface Props {
  run: Run;
  src: FrameSource;
  colors: Map<string, string>;
  nodeId: string | null;
  hotSteps: Set<number>;
  onClose: () => void;
}

export default function NodeDrawer({ run, src, colors, nodeId, hotSteps, onClose }: Props) {
  const [showRegions, setShowRegions] = useState(true);
  const regionsByFrame = useMemo(() => {
    const m = new Map<number, NonNullable<Run["regions"]>>();
    for (const r of run.regions ?? []) (m.get(r.frame) ?? m.set(r.frame, []).get(r.frame)!).push(r);
    return m;
  }, [run.regions]);
  const node = run.graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return <div className="drawer empty">Click a box on the map, a segment on the timeline or a finding to see the frames behind it.</div>;
  }
  const steps = stepsOf(run, node);
  const fields = [...new Set(steps.flatMap((s) => s.label?.data_fields ?? []))];
  const hasRegions = (run.regions ?? []).some((r) => r.kind === "changed element");
  return (
    <div className="drawer" aria-live="polite">
      <header>
        <h3>
          <span style={{ color: colors.get(node.application) }}>{node.application}</span>
          {" — "}
          {node.action}
        </h3>
        <span className="meta">
          {fmtSeconds(node.total_duration)} · {fmtPct(node.share)} of the recording
          {node.visits > 1 && ` · ${node.visits} visits, ${fmtSeconds(node.avg_duration)} each`}
          {node.is_wait && " · waiting on the system"}
        </span>
        {hasRegions && (
          <label className="toggle">
            <input type="checkbox" checked={showRegions} onChange={(e) => setShowRegions(e.target.checked)} /> Outline what changed (SAM 3.1)
          </label>
        )}
        <button className="close" onClick={onClose}>Close</button>
      </header>

      {(node.object || fields.length > 0) && (
        <ul className="fields">
          {node.object && <li className="obj">{node.object}</li>}
          {fields.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
      {steps.map((s) => {
        const inStep = run.frames.filter((f) => f.index >= s.frame_start && f.index <= s.frame_end);
        const boundary = run.boundaries.find((b) => b.frame_after === s.frame_start);
        const element = (regionsByFrame.get(s.frame_start) ?? []).find((r) => r.kind === "changed element");
        const screenSwitch = (regionsByFrame.get(s.frame_start) ?? []).some((r) => r.kind === "screen change");
        const kept = inStep.filter((f) => f.kept && hasFrame(src, f.index));
        const shown = kept.length ? kept : inStep.filter((f) => hasFrame(src, f.index)).slice(0, 1);
        return (
          <div className="stepframes" key={s.index}>
            <h4>
              Step {s.index} · {fmtClock(s.t_start)}–{fmtClock(s.t_end)} · {fmtSeconds(s.duration)}
              {s.label && <span style={{ color: "var(--ink-3)" }}> · confidence {s.label.confidence.toFixed(2)}</span>}
              {s.label_error && <span className="err"> · {s.label_error}</span>}
              {shown.length < s.frame_end - s.frame_start + 1 && <span style={{ color: "var(--ink-3)" }}> · {shown.length} of {s.frame_end - s.frame_start + 1} frames kept after de-dupe</span>}
            </h4>
            {boundary && (
              <p className="change">
                {screenSwitch
                  ? `Began with a screen switch (${fmtPct(boundary.changed_fraction ?? 0)} of the screen changed).`
                  : element
                    ? `Began when a ${element.x2 - element.x1}×${element.y2 - element.y1} px element changed; SAM 3.1 isolated it${element.confidence ? ` (${element.confidence.toFixed(2)})` : ""} and Muse Spark read the close-up.`
                    : `Began with a change on ${fmtPct(boundary.changed_fraction ?? 0)} of the screen.`}
              </p>
            )}
            <div className="filmstrip">
              {element && showRegions && (
                <figure className="closeupfig">
                  <RegionCloseup src={frameUrl(run, src, s.frame_start)} region={element} width={220} />
                  <figcaption>close-up · what changed</figcaption>
                </figure>
              )}
              {shown.map((f) => (
                <figure key={f.index} className={hotSteps.has(s.index) ? "evidence" : undefined}>
                  <FrameWithRegions src={frameUrl(run, src, f.index)} alt={`Frame at ${fmtClock(f.t)}`} width={220}
                    frameW={run.frame_width ?? 0} frameH={run.frame_height ?? 0} regions={regionsByFrame.get(f.index) ?? []} show={showRegions} />
                  <figcaption>{fmtClock(f.t)} · frame {f.index}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
