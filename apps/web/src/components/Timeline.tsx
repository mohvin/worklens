"use client";

import { useRef, useState } from "react";
import type { Run, Finding } from "@/lib/types";
import { fmtClock, fmtSeconds } from "@/lib/types";
import { nodeOfStep, findingLabel, frameUrl, type FrameSource } from "@/lib/view";
import type { Selection } from "./RunView";

const W = 1000, SY = 2, SH = 34, TY = SY + SH + 13, BY0 = TY + 12, BR = 20;

interface Props {
  run: Run; src: FrameSource; colors: Map<string, string>; selection: Selection; hotSteps: Set<number>;
  onSelectNode: (id: string | null) => void; onSelectFinding: (i: number | null) => void;
}

function spans(run: Run, f: Finding): [number, number][] {
  const idx = [...f.step_indexes].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const i of idx) {
    const s = run.steps[i]; const last = out[out.length - 1];
    if (last && Math.abs(last[1] - s.t_start) < 1e-6) last[1] = s.t_end; else out.push([s.t_start, s.t_end]);
  }
  return out;
}
const isWait = (action: string | undefined) => /\b(wait|waiting|loading|load)\b/i.test(action ?? "");
const sevColor = (s: Finding["severity"]) => (s === "high" ? "var(--danger)" : s === "medium" ? "var(--warning)" : "var(--text-3)");

export default function Timeline({ run, src, colors, selection, hotSteps, onSelectNode, onSelectFinding }: Props) {
  const total = run.summary.total_duration || run.duration || 1;
  const x = (t: number) => (t / total) * W;
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ t: number; px: number; py: number } | null>(null);
  const selectedNode = run.graph.nodes.find((n) => n.id === selection.nodeId);
  const selSteps = new Set(selectedNode?.step_indexes ?? []);
  const hoverStep = hover ? run.steps.find((s) => hover.t >= s.t_start && hover.t < s.t_end) ?? run.steps[run.steps.length - 1] : null;
  const hoverFrame = hover ? Math.min(run.frames.length - 1, Math.max(0, Math.floor(hover.t * run.fps_sampled))) : 0;

  const rows: { f: Finding; i: number; row: number; sp: [number, number][] }[] = [];
  const ends: number[] = [];
  run.findings.forEach((f, i) => {
    const sp = spans(run, f); const lo = sp[0][0], hi = sp[sp.length - 1][1];
    let row = ends.findIndex((e) => e <= lo); if (row === -1) { row = ends.length; ends.push(0); }
    ends[row] = hi + total * 0.02; rows.push({ f, i, row, sp });
  });
  const H = BY0 + ends.length * BR + 2;
  const tick = total > 1200 ? 300 : total > 400 ? 60 : total > 120 ? 30 : 10;
  const ticks: number[] = []; for (let t = 0; t <= total; t += tick) ticks.push(t);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect(); const fx = (e.clientX - r.left) / r.width;
    if (fx < 0 || fx > 1) return setHover(null);
    const host = box.current?.getBoundingClientRect();
    setHover({ t: fx * total, px: e.clientX - (host?.left ?? 0), py: r.top - (host?.top ?? 0) - 6 });
  };

  return (
    <>
      <div className="tl" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Timeline, one segment per step" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>
            <pattern id="wait" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.5" height="6" fill="rgba(255,255,255,0.7)" /></pattern>
          </defs>
          {run.steps.map((s) => {
            const app = s.label?.application ?? "Unknown"; const node = nodeOfStep(run, s.index);
            const x0 = x(s.t_start), w = Math.max(1, x(s.t_end) - x0); const dim = hotSteps.size > 0 && !hotSteps.has(s.index);
            const label = s.label?.action ?? ""; const maxChars = Math.floor(w / 6.5);
            return (
              <g key={s.index} className="seg" onClick={() => onSelectNode(node?.id ?? null)}>
                <title>{`${fmtClock(s.t_start)}–${fmtClock(s.t_end)} ${app}: ${s.label?.action ?? "unlabelled"} (${fmtSeconds(s.duration)})`}</title>
                <rect x={x0} y={SY} width={w} height={SH} rx={2} fill={colors.get(app)} opacity={dim ? 0.3 : 1} />
                {isWait(s.label?.action) && <rect x={x0} y={SY} width={w} height={SH} rx={2} fill="url(#wait)" />}
                <rect x={x0} y={SY} width={w} height={SH} rx={2} fill="none" stroke="var(--surface)" strokeWidth={1.5} />
                {w > 70 && label && <text className="seglabel" x={x0 + 6} y={SY + SH / 2 + 4}>{label.length > maxChars ? label.slice(0, Math.max(3, maxChars - 1)) + "…" : label}</text>}
                {selSteps.has(s.index) && <rect x={x0 + 1} y={SY + 1} width={w - 2} height={SH - 2} rx={2} fill="none" stroke="var(--brand)" strokeWidth={2.5} />}
              </g>
            );
          })}
          {ticks.map((t) => (
            <g key={t}><line className="tick" x1={x(t)} x2={x(t)} y1={SY + SH} y2={SY + SH + 4} /><text className="ticklabel" x={x(t)} y={TY} textAnchor={t === 0 ? "start" : t >= total - tick / 2 ? "end" : "middle"}>{fmtClock(t)}</text></g>
          ))}
          {rows.map(({ f, i, row, sp }) => {
            const y = BY0 + row * BR; const active = selection.findingIndex === i; const col = sevColor(f.severity);
            return (
              <g key={i} className="seg" opacity={selection.findingIndex !== null && !active ? 0.4 : 1} onClick={() => onSelectFinding(active ? null : i)}>
                <title>{f.title}</title>
                {sp.map(([a, b], k) => <path key={k} className="brace" stroke={col} d={`M${x(a)} ${y} v5 H${x(b)} v-5`} />)}
                {sp.length > 1 && <path className="brace" stroke={col} strokeDasharray="3 3" d={`M${x(sp[0][1])} ${y + 5} H${x(sp[1][0])}`} />}
                <text className="bracelabel" x={x(sp[0][0]) + 3} y={y + 15} fontWeight={active ? 600 : 400}>{findingLabel[f.rule]} · {fmtSeconds(f.seconds)}</text>
              </g>
            );
          })}
          {hover && <line className="playhead" x1={x(hover.t)} x2={x(hover.t)} y1={SY - 2} y2={SY + SH + 2} />}
        </svg>
        {hover && hoverStep && (
          <div className="scrub" style={{ left: hover.px, top: hover.py }} aria-hidden>
            <img src={frameUrl(run, src, hoverFrame)} alt="" />
            <div className="cap"><i style={{ background: colors.get(hoverStep.label?.application ?? "Unknown") }} /><b>{fmtClock(hover.t)}</b><span>{hoverStep.label ? `${hoverStep.label.application} · ${hoverStep.label.action}` : "unlabelled"}</span></div>
          </div>
        )}
      </div>
      <div className="legend">
        {[...colors.entries()].map(([app, c]) => <span key={app}><i style={{ background: c }} />{app}</span>)}
        {run.summary.wait_duration > 0 && <span className="wait"><i />waiting</span>}
      </div>
    </>
  );
}
