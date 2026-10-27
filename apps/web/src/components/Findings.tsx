"use client";

import { useState } from "react";
import type { Run } from "@/lib/types";
import { fmtClock, fmtSeconds, fmtPct } from "@/lib/types";
import { frameUrl } from "@/lib/view";

interface Props { run: Run; activeIndex: number | null; onSelect: (i: number | null) => void }

export default function Findings({ run, activeIndex, onSelect }: Props) {
  const [all, setAll] = useState(false);
  if (run.findings.length === 0) {
    return <div className="drawer empty">No long step, loop or re-keying found. Either the task is tight or the recording is short.</div>;
  }
  const shown = all ? run.findings : run.findings.slice(0, 3);
  return (
    <div className="findings">
      {shown.map((f, i) => (
        <button key={i} className={`finding${activeIndex === i ? " active" : ""}`} onClick={() => onSelect(activeIndex === i ? null : i)} aria-pressed={activeIndex === i}>
          <span className={`rank ${f.severity}`}>{i + 1}</span>
          <div>
            <h3>
              {f.title}
              <small>{fmtSeconds(f.seconds)} · {fmtPct(f.share)} · {f.severity}</small>
            </h3>
            <p>{f.detail}</p>
            <div className="thumbs">
              {f.evidence_frames.slice(0, 4).map((fi) => (
                <figure key={fi}>
                  <img src={frameUrl(run, fi)} alt={`Evidence frame ${fi}`} loading="lazy" width={132} height={74} />
                  <figcaption>{fmtClock(run.frames[Math.min(fi, run.frames.length - 1)]?.t ?? 0)}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </button>
      ))}
      {run.findings.length > 3 && (
        <button className="more" onClick={() => setAll(!all)}>
          {all ? "Show the top 3 only" : `${run.findings.length - 3} more finding${run.findings.length - 3 === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}
