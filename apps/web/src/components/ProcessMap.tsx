"use client";

import { useEffect, useRef, useState } from "react";
import type { Run, Node } from "@/lib/types";
import { fmtSeconds, fmtPct } from "@/lib/types";
import { wrapText } from "@/lib/view";

const NW = 196, NH = 76, GX = 40, GY = 60, PAD = 16, EV = 9;

interface Props {
  run: Run;
  colors: Map<string, string>;
  selectedId: string | null;
  hotNodes: Set<string>;
  onSelect: (id: string | null) => void;
}

export default function ProcessMap({ run, colors, selectedId, hotNodes, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodes = run.graph.nodes;
  const cols = Math.max(1, Math.floor((width - 2 * PAD - 2 * (EV * 2 + GX) + GX) / (NW + GX)));
  const pos = new Map<string, { x: number; y: number; row: number; col: number; order: number }>();
  nodes.forEach((n, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    pos.set(n.id, { x: PAD + EV * 2 + GX + col * (NW + GX), y: PAD + row * (NH + GY), row, col, order: i });
  });
  const rows = Math.max(1, Math.ceil(nodes.length / cols));
  const H = PAD * 2 + rows * NH + (rows - 1) * GY + 40;
  const last = nodes[nodes.length - 1];
  const lastPos = last ? pos.get(last.id)! : { x: PAD, y: PAD, row: 0, col: 0, order: 0 };
  const startXY = { x: PAD + EV, y: PAD + NH / 2 };
  const endXY = { x: lastPos.x + NW + GX + EV, y: lastPos.y + NH / 2 };

  const mid = (p: { x: number; y: number }) => ({ cx: p.x + NW / 2, cy: p.y + NH / 2 });
  let backLane = 0;
  const edges = run.graph.edges.map((e, k) => {
    const s = pos.get(e.source)!, t = pos.get(e.target)!;
    const back = t.order < s.order;
    const adjacent = t.order === s.order + 1;
    let d: string;
    let label: { x: number; y: number } | null = null;
    if (adjacent && s.row === t.row) {
      d = `M${s.x + NW} ${s.y + NH / 2} H${t.x}`;
      label = { x: (s.x + NW + t.x) / 2, y: s.y + NH / 2 - 6 };
    } else if (!back && t.row === s.row + 1 && t.col === 0) {
      // row wrap: out of the right margin, down through the gap, in from the left margin
      const gapY = s.y + NH + GY / 2;
      const rx = s.x + NW + GX / 2, lx = PAD + EV * 2 + GX / 2;
      d = `M${s.x + NW} ${s.y + NH / 2} H${rx} V${gapY} H${lx} V${t.y + NH / 2} H${t.x}`;
      label = { x: (rx + lx) / 2, y: gapY - 5 };
    } else if (!back && s.row === t.row) {
      // forward, skipping nodes on the same row: under the gap and up into the target
      const gapY = s.y + NH + GY / 2;
      d = `M${mid(s).cx} ${s.y + NH} V${gapY} H${mid(t).cx} V${t.y + NH}`;
      label = { x: (mid(s).cx + mid(t).cx) / 2, y: gapY - 5 };
    } else if (!back) {
      // forward to a later row: down into the gap, along the left margin, in from the left
      const gapY = s.y + NH + GY / 2 + 9;
      const lx = PAD + EV * 2 + GX / 2 + 8;
      d = `M${mid(s).cx} ${s.y + NH} V${gapY} H${lx} V${t.y + NH / 2 - 10} H${t.x}`;
      label = { x: lx + 8, y: (gapY + t.y) / 2 };
    } else if (s.row === t.row) {
      // loop on the same row: lane under the row, arrow up into the target
      const lane = s.y + NH + 18 + backLane++ * 12;
      d = `M${mid(s).cx} ${s.y + NH} V${lane} H${mid(t).cx + 10} V${t.y + NH}`;
      label = { x: (mid(s).cx + mid(t).cx) / 2, y: lane - 5 };
    } else {
      // loop to an earlier row: down, left along the margin, up, into the target's left edge
      const lane = s.y + NH + 18 + backLane++ * 12;
      const mx = PAD + EV * 2 + GX / 2 - 8 - backLane * 4;
      d = `M${mid(s).cx} ${s.y + NH} V${lane} H${mx} V${t.y + NH / 2 + 12} H${t.x}`;
      label = { x: mx + 8, y: (lane + t.y + NH / 2) / 2 };
    }
    const dim = hotNodes.size > 0 && !(hotNodes.has(e.source) && hotNodes.has(e.target)) && !(back && hotNodes.has(e.target));
    return { ...e, d, back, label, dim, key: k };
  });

  return (
    <div className="map" ref={ref}>
      <svg viewBox={`0 0 ${width} ${H}`} width={width} height={H} role="img" aria-label="Process map">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
          </marker>
          <marker id="arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--heat-high)" />
          </marker>
          <marker id="arrow-grey" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-3)" />
          </marker>
        </defs>

        {nodes.length > 0 && (
          <>
            <circle className="ends" cx={startXY.x} cy={startXY.y} r={EV} />
            <path className="edge" d={`M${startXY.x + EV} ${startXY.y} H${pos.get(nodes[0].id)!.x}`} markerEnd="url(#arrow-grey)" />
            <path className="edge" d={`M${lastPos.x + NW} ${endXY.y} H${endXY.x - EV}`} markerEnd="url(#arrow-grey)" />
            <circle className="ends" cx={endXY.x} cy={endXY.y} r={EV} strokeWidth={3} />
          </>
        )}

        {edges.map((e) => (
          <g key={e.key} className={e.dim ? "dim" : undefined}>
            <path className={`edge${e.back ? " back" : ""}${e.dim ? " dim" : ""}`} d={e.d} markerEnd={e.back ? "url(#arrow-back)" : "url(#arrow-grey)"} />
            {e.count > 1 && e.label && (
              <text className="edgelabel" x={e.label.x} y={e.label.y} textAnchor="middle">×{e.count}</text>
            )}
          </g>
        ))}

        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const lines = wrapText(n.action, 26, 2);
          const cls = ["node", n.id === selectedId ? "selected" : "", hotNodes.has(n.id) ? "hot" : ""].join(" ");
          return (
            <g key={n.id} className={cls} transform={`translate(${p.x},${p.y})`} onClick={() => onSelect(n.id === selectedId ? null : n.id)} tabIndex={0}
              onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(n.id); } }} role="button" aria-label={`${n.application}: ${n.action}, ${fmtSeconds(n.total_duration)}`}>
              <rect className="box" width={NW} height={NH} rx={4} />
              <rect x={0} y={0} width={4} height={NH} rx={2} fill={colors.get(n.application)} />
              <text className="app" x={14} y={17}>{n.application.length > 28 ? n.application.slice(0, 27) + "…" : n.application}</text>
              {lines.map((l, i) => (
                <text key={i} className="action" x={14} y={34 + i * 16}>{l}</text>
              ))}
              <text className="dur" x={14} y={NH - 9}>
                {fmtSeconds(n.total_duration)}{n.is_wait ? " waiting" : ""}
                <tspan className="share"> · {fmtPct(n.share)}</tspan>
              </text>
              {n.visits > 1 && (
                <g transform={`translate(${NW - 18},14)`}>
                  <circle r={11} fill="var(--heat-high)" />
                  <text className="badge" textAnchor="middle" y={4}>{n.visits}×</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export type { Node };
