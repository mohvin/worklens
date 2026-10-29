"use client";

import type { Region } from "@/lib/types";

interface Props { src: string; alt: string; width: number; frameW: number; frameH: number; regions: Region[]; show: boolean }

/** A sampled frame with the SAM 3.1 changed element outlined, in the frame's own pixel space. */
export default function FrameWithRegions({ src, alt, width, frameW, frameH, regions, show }: Props) {
  const h = frameW ? Math.round((width * frameH) / frameW) : Math.round((width * 9) / 16);
  const drawn = regions.filter((r) => r.kind === "changed element");
  if (!show || !frameW || drawn.length === 0) {
    return <img src={src} alt={alt} loading="lazy" width={width} height={h} />;
  }
  const sw = Math.max(2, frameW / 400);
  return (
    <svg viewBox={`0 0 ${frameW} ${frameH}`} width={width} height={h} className="frame" role="img" aria-label={`${alt}, changed element outlined`}>
      <image href={src} width={frameW} height={frameH} />
      {drawn.map((r, i) => (
        <rect key={i} x={r.x1} y={r.y1} width={r.x2 - r.x1} height={r.y2 - r.y1} fill="var(--brand)" fillOpacity={0.1} stroke="var(--brand)" strokeWidth={sw} />
      ))}
    </svg>
  );
}

/** A magnified crop of one region, the "close-up" SAM handed to Muse Spark. */
export function RegionCloseup({ src, region, width, pad = 12 }: { src: string; region: Region; width: number; pad?: number }) {
  const x = Math.max(0, region.x1 - pad), y = Math.max(0, region.y1 - pad);
  const w = region.x2 - region.x1 + 2 * pad, h = region.y2 - region.y1 + 2 * pad;
  const height = Math.round((width * h) / w);
  return (
    <svg viewBox={`${x} ${y} ${w} ${h}`} width={width} height={height} className="frame closeup" role="img" aria-label="Close-up of the changed element">
      <image href={src} />
      <rect x={region.x1} y={region.y1} width={region.x2 - region.x1} height={region.y2 - region.y1} fill="none" stroke="var(--brand)" strokeWidth={Math.max(1.5, w / 200)} />
    </svg>
  );
}
