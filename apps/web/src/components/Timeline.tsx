"use client";

import type { Run, Finding } from "@/lib/types";
import { fmtClock, fmtSeconds } from "@/lib/types";
import { nodeOfStep, findingLabel } from "@/lib/view";
import type { Selection } from "./RunView";

const W = 1000;
const STRIP_Y = 4;
const STRIP_H = 40;
const TICK_Y = STRIP_Y + STRIP_H + 14;
const BRACE_Y0 = TICK_Y + 14;
const BRACE_ROW = 22;

interface Props {
  run: Run;
  colors: Map<string, string>;
  selection: Selection;
  hotSteps: Set<number>;
  onSelectNode: (id: string | null) => void;
  onSelectFinding: (i: number | null) => void;
}

// contiguous ranges of step indexes -> [t_start, t_end] spans
function spans(run: Run, f: Finding): [number, number][] {
  const idx = [...f.step_indexes].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const i of idx) {
    const s = run.steps[i];
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - s.t_start) < 1e-6) last[1] = s.t_end;
    else out.push([s.t_start, s.t_end]);
  }
  return out;
}

export default function Timeline({ run, colors, selection, hotSteps, onSelectNode, onSelectFinding }: Props) {
  const total = run.summary.total_duration || run.duration || 1;
  const x = (t: number) => (t / total) * W;
  const selectedNode = run.graph.nodes.find((n) => n.id === selection.nodeId);
  const selectedSteps = new Set(selectedNode?.step_indexes ?? []);

  // lay findings into rows so braces do not overlap
  const rows: { f: Finding; i: number; row: number; spans: [number, number][] }[] = [];
  const rowEnds: number[] = [];
  run.findings.forEach((f, i) => {
    const sp = spans(run, f);
    const lo = sp[0][0], hi = sp[sp.length - 1][1];
    let row = rowEnds.findIndex((end) => end <= lo);
    if (row === -1) { row = rowEnds.length; rowEnds.push(0); }
    rowEnds[row] = hi + total * 0.02;
    rows.push({ f, i, row, spans: sp });
  });
  const H = BRACE_Y0 + rowEnds.length * BRACE_ROW + 4;

  const tickEvery = total > 1200 ? 300 : total > 400 ? 60 : total > 120 ? 30 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += tickEvery) ticks.push(t);

  return (
    <div className="timeline">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Timeline of the recording, one segment per step">
        <defs>
          <pattern id="wait" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2.5" height="6" fill="rgba(255,255,255,0.7)" />
          </pattern>
        </defs>
        {run.steps.map((s) => {
          const app = s.label?.application ?? "Unknown";
          const node = nodeOfStep(run, s.index);
          const isSel = selectedSteps.has(s.index);
          const hot = hotSteps.has(s.index);
          const x0 = x(s.t_start), w = Math.max(1, x(s.t_end) - x0);
          const wait = /\b(wait|loading)\b/i.test(s.label?.action ?? "");
          return (
            <g key={s.index} className="seg" onClick={() => onSelectNode(node?.id ?? null)}>
              <title>{`${fmtClock(s.t_start)}–${fmtClock(s.t_end)}  ${app}: ${s.label?.action ?? "unlabelled"} (${fmtSeconds(s.duration)})`}</title>
              <rect x={x0} y={STRIP_Y} width={w} height={STRIP_H} fill={colors.get(app)} opacity={hotSteps.size && !hot ? 0.35 : 1} />
              {wait && <rect x={x0} y={STRIP_Y} width={w} height={STRIP_H} fill="url(#wait)" />}
              {w > 2 && <rect x={x0} y={STRIP_Y} width={w} height={STRIP_H} fill="none" stroke="#fff" strokeWidth={1} />}
              {isSel && <rect x={x0 + 1} y={STRIP_Y + 1} width={w - 2} height={STRIP_H - 2} fill="none" stroke="var(--brand)" strokeWidth={2.5} />}
            </g>
          );
        })}
        {ticks.map((t) => (
          <g key={t}>
            <line className="tick" x1={x(t)} x2={x(t)} y1={STRIP_Y + STRIP_H} y2={STRIP_Y + STRIP_H + 5} />
            <text className="ticklabel" x={x(t)} y={TICK_Y} textAnchor={t === 0 ? "start" : t >= total - tickEvery / 2 ? "end" : "middle"}>{fmtClock(t)}</text>
          </g>
        ))}
        {rows.map(({ f, i, row, spans: sp }) => {
          const y = BRACE_Y0 + row * BRACE_ROW;
          const color = `var(--heat-${f.severity})`;
          const active = selection.findingIndex === i;
          return (
            <g key={i} className="seg" onClick={() => onSelectFinding(active ? null : i)} opacity={selection.findingIndex !== null && !active ? 0.45 : 1}>
              <title>{f.title}</title>
              {sp.map(([a, b], k) => (
                <path key={k} className="brace" stroke={color} d={`M${x(a)} ${y} v6 H${x(b)} v-6`} />
              ))}
              {sp.length > 1 && <path className="brace" stroke={color} strokeDasharray="3 3" d={`M${x(sp[0][1])} ${y + 6} H${x(sp[1][0])}`} />}
              <text className="bracelabel" x={x(sp[0][0]) + 3} y={y + 17} fontWeight={active ? 600 : 400}>
                {findingLabel[f.rule]} · {fmtSeconds(f.seconds)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {[...colors.entries()].map(([app, c]) => (
          <span key={app}><i style={{ background: c }} />{app}</span>
        ))}
        {run.summary.wait_duration > 0 && <span className="wait"><i />waiting</span>}
      </div>
    </div>
  );
}
