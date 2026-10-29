"use client";

import { useRef, useState } from "react";
import { fmtClock, fmtSeconds } from "@/lib/types";
import { frameUrl } from "@/lib/view";
import type { MapModel } from "@/lib/model";
import type { UFinding } from "@/lib/findings";

// One bar per recording (role label on the left when there are several), one
// segment per step, finding braces underneath, a scrub preview on hover.

const W = 1000, SH = 34, ROWGAP = 6, BR = 20;

export interface Selection { nodeKey: string | null; findingIndex: number | null }

interface Props {
  model: MapModel; colors: Map<string, string>; findings: UFinding[]; selection: Selection;
  onSelectNode: (key: string | null) => void; onSelectFinding: (i: number | null) => void;
}

const isWait = (action: string | undefined) => /\b(wait|waiting|loading|load)\b/i.test(action ?? "");
const sevColor = (f: UFinding) => (f.cross ? "var(--brand)" : f.severity === "high" ? "var(--danger)" : f.severity === "medium" ? "var(--warning)" : "var(--text-3)");

export default function Timeline({ model, colors, findings, selection, onSelectNode, onSelectFinding }: Props) {
  const recs = model.recs;
  const multi = recs.length > 1;
  const LX = multi ? 76 : 0, BW = W - LX;
  const longest = Math.max(...recs.map((r) => r.run.summary.total_duration || r.run.duration || 1));
  const x = (t: number) => LX + (t / longest) * BW;
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ rec: number; t: number; px: number; py: number } | null>(null);
  const selNode = model.nodes.find((n) => n.key === selection.nodeKey);
  const active = selection.findingIndex === null ? null : findings[selection.findingIndex];
  const hot = new Set(active ? active.refs.map((r) => `${r.rec}:${r.step}`) : []);

  const rowY = (rec: number) => 2 + rec * (SH + ROWGAP);
  const TY = rowY(recs.length - 1) + SH + 13;
  const BY0 = TY + 12;

  // finding braces, packed into rows
  const ends: number[] = [];
  const rows = findings.map((f, i) => {
    const byRec = new Map<number, number[]>();
    f.refs.forEach((r) => byRec.set(r.rec, [...(byRec.get(r.rec) ?? []), r.step]));
    const spans = [...byRec.entries()].map(([rec, idx]) => {
      const st = recs[rec].run.steps; idx.sort((a, b) => a - b);
      const parts: [number, number][] = [];
      for (const j of idx) { const s = st[j]; if (!s) continue; const last = parts[parts.length - 1]; if (last && Math.abs(last[1] - s.t_start) < 1e-6) last[1] = s.t_end; else parts.push([s.t_start, s.t_end]); }
      return { rec, parts };
    }).filter((s) => s.parts.length);
    const lo = Math.min(...spans.flatMap((s) => s.parts.map((p) => p[0]))), hi = Math.max(...spans.flatMap((s) => s.parts.map((p) => p[1])));
    let row = ends.findIndex((e) => e <= lo); if (row === -1) { row = ends.length; ends.push(0); }
    ends[row] = hi + longest * 0.03;
    return { f, i, row, spans, lo };
  });
  const H = BY0 + ends.length * BR + 2;
  const tick = longest > 1200 ? 300 : longest > 400 ? 60 : longest > 120 ? 30 : 10;
  const ticks: number[] = []; for (let t = 0; t <= longest; t += tick) ticks.push(t);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const t = ((fx * W - LX) / BW) * longest;
    const rec = Math.max(0, Math.min(recs.length - 1, Math.floor((fy * H - 2) / (SH + ROWGAP))));
    if (t < 0 || t > (recs[rec].run.summary.total_duration || recs[rec].run.duration) || fy * H > rowY(recs.length - 1) + SH) return setHover(null);
    const host = box.current?.getBoundingClientRect();
    setHover({ rec, t, px: e.clientX - (host?.left ?? 0), py: r.top + (rowY(rec) / H) * r.height - (host?.top ?? 0) - 6 });
  };
  const hoverRun = hover ? recs[hover.rec].run : null;
  const hoverStep = hover && hoverRun ? hoverRun.steps.find((s) => hover.t >= s.t_start && hover.t < s.t_end) ?? hoverRun.steps[hoverRun.steps.length - 1] : null;
  const hoverFrame = hover && hoverRun ? Math.min(hoverRun.frames.length - 1, Math.max(0, Math.floor(hover.t * hoverRun.fps_sampled))) : 0;

  return (
    <>
      <div className="tl" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Timeline, one bar per recording" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>
            <pattern id="wait" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.5" height="6" fill="rgba(255,255,255,0.7)" /></pattern>
          </defs>
          {recs.map((rec, ri) => {
            const y = rowY(ri);
            return (
              <g key={ri}>
                {multi && <text className="rolelabel" x={0} y={y + SH / 2 + 4}>{(rec.role ?? `Recording ${ri + 1}`).length > 11 ? (rec.role ?? "").slice(0, 10) + "…" : rec.role ?? `Recording ${ri + 1}`}</text>}
                {rec.run.steps.map((s) => {
                  const app = s.label?.application ?? "Unknown";
                  const x0 = x(s.t_start), w = Math.max(1, x(s.t_end) - x0);
                  const dim = hot.size > 0 && !hot.has(`${ri}:${s.index}`);
                  const node = model.nodes.find((n) => n.rec === ri && n.steps.includes(s.index));
                  const isSel = selNode && selNode.rec === ri && selNode.steps.includes(s.index);
                  const label = s.label?.action ?? ""; const maxChars = Math.floor(w / 6.5);
                  return (
                    <g key={s.index} className="seg" onClick={() => onSelectNode(node?.key ?? null)}>
                      <title>{`${fmtClock(s.t_start)}–${fmtClock(s.t_end)} ${app}: ${s.label?.action ?? "unlabelled"} (${fmtSeconds(s.duration)})`}</title>
                      <rect x={x0} y={y} width={w} height={SH} rx={2} fill={colors.get(app)} opacity={dim ? 0.3 : 1} />
                      {isWait(s.label?.action) && <rect x={x0} y={y} width={w} height={SH} rx={2} fill="url(#wait)" />}
                      <rect x={x0} y={y} width={w} height={SH} rx={2} fill="none" stroke="var(--surface)" strokeWidth={1.5} />
                      {w > 70 && label && <text className="seglabel" x={x0 + 6} y={y + SH / 2 + 4}>{label.length > maxChars ? label.slice(0, Math.max(3, maxChars - 1)) + "…" : label}</text>}
                      {isSel && <rect x={x0 + 1} y={y + 1} width={w - 2} height={SH - 2} rx={2} fill="none" stroke="var(--brand)" strokeWidth={2.5} />}
                    </g>
                  );
                })}
              </g>
            );
          })}
          {ticks.map((t) => (
            <g key={t}><line className="tick" x1={x(t)} x2={x(t)} y1={rowY(recs.length - 1) + SH} y2={rowY(recs.length - 1) + SH + 4} /><text className="ticklabel" x={x(t)} y={TY} textAnchor={t === 0 ? "start" : t >= longest - tick / 2 ? "end" : "middle"}>{fmtClock(t)}</text></g>
          ))}
          {rows.map(({ f, i, row, spans, lo }) => {
            const y = BY0 + row * BR; const isActive = selection.findingIndex === i; const col = sevColor(f);
            const flat = spans.flatMap((s) => s.parts).sort((a, b) => a[0] - b[0]);
            return (
              <g key={f.key} className="seg" opacity={selection.findingIndex !== null && !isActive ? 0.4 : 1} onClick={() => onSelectFinding(isActive ? null : i)}>
                <title>{f.title}</title>
                {flat.map(([a, b], k) => <path key={k} className="brace" stroke={col} d={`M${x(a)} ${y} v5 H${x(b)} v-5`} />)}
                {flat.slice(1).map(([a], k) => <path key={`d${k}`} className="brace" stroke={col} strokeDasharray="3 3" d={`M${x(flat[k][1])} ${y + 5} H${x(a)}`} />)}
                <text className="bracelabel" x={x(lo) + 3} y={y + 15} fontWeight={isActive ? 600 : 400}>{f.ruleLabel} · {fmtSeconds(f.seconds)}{multi && !f.cross && f.role ? ` · ${f.role}` : ""}</text>
              </g>
            );
          })}
          {hover && <line className="playhead" x1={x(hover.t)} x2={x(hover.t)} y1={rowY(hover.rec) - 2} y2={rowY(hover.rec) + SH + 2} />}
        </svg>
        {hover && hoverRun && hoverStep && (
          <div className="scrub" style={{ left: hover.px, top: hover.py }} aria-hidden>
            <img src={frameUrl(hoverRun, recs[hover.rec].src, hoverFrame)} alt="" />
            <div className="cap"><i style={{ background: colors.get(hoverStep.label?.application ?? "Unknown") }} /><b>{fmtClock(hover.t)}</b><span>{hoverStep.label ? `${hoverStep.label.application} · ${hoverStep.label.action}` : "unlabelled"}</span></div>
          </div>
        )}
      </div>
      <div className="legend">
        {[...colors.entries()].map(([app, c]) => <span key={app}><i style={{ background: c }} />{app}</span>)}
        {recs.some((r) => r.run.summary.wait_duration > 0) && <span className="wait"><i />waiting</span>}
        {multi && <span className="hand"><i />finding across roles</span>}
      </div>
    </>
  );
}
