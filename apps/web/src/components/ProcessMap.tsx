"use client";

import { useEffect, useRef, useState } from "react";
import type { Run } from "@/lib/types";
import { fmtSeconds, fmtPct } from "@/lib/types";
import { wrapText, frameUrl, type FrameSource } from "@/lib/view";

const NW = 196, NH = 84, GX = 26, GY = 44, PAD = 12, EV = 8, TW = 72, TH = 40.5;

interface Props { run: Run; src: FrameSource; colors: Map<string, string>; selectedId: string | null; hotNodes: Set<string>; onSelect: (id: string | null) => void }

export default function ProcessMap({ run, src, colors, selectedId, hotNodes, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const nodes = run.graph.nodes;
  if (nodes.length === 0) return <div className="map" ref={ref}><div className="empty">No steps yet.</div></div>;
  const cols = Math.max(1, Math.floor((width - 2 * PAD - 2 * (EV * 2 + GX) + GX) / (NW + GX)));
  const pos = new Map<string, { x: number; y: number; row: number; col: number; order: number }>();
  nodes.forEach((n, i) => { const row = Math.floor(i / cols), col = i % cols; pos.set(n.id, { x: PAD + EV * 2 + GX + col * (NW + GX), y: PAD + row * (NH + GY), row, col, order: i }); });
  const rows = Math.max(1, Math.ceil(nodes.length / cols));
  const H = PAD * 2 + rows * NH + (rows - 1) * GY + 24;
  const lp = pos.get(nodes[nodes.length - 1].id)!;
  const startXY = { x: PAD + EV, y: PAD + NH / 2 }, endXY = { x: lp.x + NW + GX + EV, y: lp.y + NH / 2 };
  const lx = PAD + EV * 2 + GX / 2;
  const mid = (p: { x: number }) => p.x + NW / 2;
  let back = 0;
  const edges = run.graph.edges.map((e, k) => {
    const s = pos.get(e.source)!, t = pos.get(e.target)!; const isBack = t.order < s.order; const adj = t.order === s.order + 1;
    let d: string, lab: [number, number];
    if (adj && s.row === t.row) { d = `M${s.x + NW} ${s.y + NH / 2} H${t.x}`; lab = [(s.x + NW + t.x) / 2, s.y + NH / 2 - 5]; }
    else if (!isBack && t.row === s.row + 1 && t.col === 0) { const gy = s.y + NH + GY / 2; d = `M${s.x + NW} ${s.y + NH / 2} H${s.x + NW + GX / 2} V${gy} H${lx} V${t.y + NH / 2} H${t.x}`; lab = [(s.x + NW + GX / 2 + lx) / 2, gy - 5]; }
    else if (!isBack && s.row === t.row) { const gy = s.y + NH + GY / 2; d = `M${mid(s)} ${s.y + NH} V${gy} H${mid(t)} V${t.y + NH}`; lab = [(mid(s) + mid(t)) / 2, gy - 5]; }
    else if (!isBack) { const gy = s.y + NH + GY / 2 + 7; d = `M${mid(s)} ${s.y + NH} V${gy} H${lx + 8} V${t.y + NH / 2 - 8} H${t.x}`; lab = [lx + 16, (gy + t.y) / 2]; }
    else if (s.row === t.row) { const lane = s.y + NH + 14 + back++ * 10; d = `M${mid(s)} ${s.y + NH} V${lane} H${mid(t) + 10} V${t.y + NH}`; lab = [(mid(s) + mid(t)) / 2, lane - 4]; }
    else { const lane = s.y + NH + 14 + back++ * 10; const mx = lx - 8 - back * 4; d = `M${mid(s)} ${s.y + NH} V${lane} H${mx} V${t.y + NH / 2 + 10} H${t.x}`; lab = [mx + 8, (lane + t.y + NH / 2) / 2]; }
    const dim = hotNodes.size > 0 && !(hotNodes.has(e.source) && hotNodes.has(e.target)) && !(isBack && hotNodes.has(e.target));
    return { k, d, lab, isBack, dim, count: e.count };
  });

  return (
    <div className="map" ref={ref}>
      <svg viewBox={`0 0 ${width} ${H}`} width={width} height={H} role="img" aria-label="Process map">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text-3)" /></marker>
          <marker id="arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--danger)" /></marker>
          {nodes.map((n) => <clipPath id={`c-${n.id}`} key={n.id}><rect x={8} y={8} width={TW} height={TH} rx={2} /></clipPath>)}
        </defs>
        <circle className="ends" cx={startXY.x} cy={startXY.y} r={EV} />
        <path className="edge" d={`M${startXY.x + EV} ${startXY.y} H${pos.get(nodes[0].id)!.x}`} markerEnd="url(#arrow)" />
        <path className="edge" d={`M${lp.x + NW} ${endXY.y} H${endXY.x - EV}`} markerEnd="url(#arrow)" />
        <circle className="ends" cx={endXY.x} cy={endXY.y} r={EV} strokeWidth={3} />
        {edges.map((e) => (
          <g key={e.k}>
            <path className={`edge${e.isBack ? " back" : ""}${e.dim ? " dim" : ""}`} d={e.d} markerEnd={e.isBack ? "url(#arrow-back)" : "url(#arrow)"} />
            {e.count > 1 && <text className="edgelabel" x={e.lab[0]} y={e.lab[1]} textAnchor="middle">×{e.count}</text>}
          </g>
        ))}
        {nodes.map((n) => {
          const p = pos.get(n.id)!; const lines = wrapText(n.action, 17, 2); const first = run.steps[n.step_indexes[0]];
          const cls = ["node", n.id === selectedId ? "selected" : "", hotNodes.has(n.id) ? "hot" : ""].join(" ");
          return (
            <g key={n.id} className={cls} transform={`translate(${p.x},${p.y})`} tabIndex={0} role="button" aria-label={`${n.application}: ${n.action}, ${fmtSeconds(n.total_duration)}`}
              onClick={() => onSelect(n.id === selectedId ? null : n.id)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(n.id); } }}>
              <rect className="box" width={NW} height={NH} rx={5} />
              {first && <image href={frameUrl(run, src, first.frame_start)} x={8} y={8} width={TW} height={TH} preserveAspectRatio="xMidYMid slice" clipPath={`url(#c-${n.id})`} />}
              <rect className="thumbframe" x={8} y={8} width={TW} height={TH} rx={2} />
              <circle cx={12} cy={68} r={3.5} fill={colors.get(n.application)} />
              <text className="app" x={20} y={72}>{n.application.length > 14 ? n.application.slice(0, 13) + "…" : n.application}</text>
              {lines.map((l, k) => <text key={k} className="action" x={90} y={22 + k * 15}>{l}</text>)}
              <text className="dur" x={NW - 8} y={72} textAnchor="end">{fmtSeconds(n.total_duration)}{n.is_wait ? " wait" : ""} · {fmtPct(n.share)}</text>
              {n.visits > 1 && <g transform={`translate(${NW - 14},14)`}><circle r={9} fill="var(--danger)" /><text className="badge" textAnchor="middle" y={3.5}>{n.visits}×</text></g>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
