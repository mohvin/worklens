"use client";

import type { Run } from "@/lib/types";
import { fmtClock, fmtSeconds, fmtPct } from "@/lib/types";
import { frameUrl, stepsOf } from "@/lib/view";

interface Props {
  run: Run;
  colors: Map<string, string>;
  nodeId: string | null;
  hotSteps: Set<number>;
  onClose: () => void;
}

export default function NodeDrawer({ run, colors, nodeId, hotSteps, onClose }: Props) {
  const node = run.graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return <div className="drawer empty">Click a box on the map, a segment on the timeline or a finding to see the frames behind it.</div>;
  }
  const steps = stepsOf(run, node);
  const fields = [...new Set(steps.flatMap((s) => s.label?.data_fields ?? []))];
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
        <button className="close" onClick={onClose}>Close</button>
      </header>
      {(node.object || fields.length > 0) && (
        <ul className="fields">
          {node.object && <li className="obj">{node.object}</li>}
          {fields.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
      {steps.map((s) => {
        const frames = run.frames.filter((f) => f.index >= s.frame_start && f.index <= s.frame_end && f.kept);
        const shown = frames.length ? frames : run.frames.slice(s.frame_start, s.frame_end + 1);
        return (
          <div className="stepframes" key={s.index}>
            <h4>
              Step {s.index} · {fmtClock(s.t_start)}–{fmtClock(s.t_end)} · {fmtSeconds(s.duration)}
              {s.label && <span style={{ color: "var(--ink-3)" }}> · confidence {s.label.confidence.toFixed(2)}</span>}
              {s.label_error && <span className="err"> · {s.label_error}</span>}
              {shown.length < s.frame_end - s.frame_start + 1 && <span style={{ color: "var(--ink-3)" }}> · {shown.length} of {s.frame_end - s.frame_start + 1} frames kept after de-dupe</span>}
            </h4>
            <div className="filmstrip">
              {shown.map((f) => (
                <figure key={f.index} className={hotSteps.has(s.index) ? "evidence" : undefined}>
                  <img src={frameUrl(run, f.index)} alt={`Frame at ${fmtClock(f.t)}`} loading="lazy" width={220} height={124} />
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
