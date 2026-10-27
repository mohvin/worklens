import type { Run, Step, Node, Finding } from "./types";

// Application -> palette slot, in order of first appearance in the recording.
export function appColors(run: Run): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of run.steps) {
    const app = s.label?.application ?? "Unknown";
    if (!m.has(app)) m.set(app, `var(--app-${m.size % 6})`);
  }
  return m;
}

export const nodeOfStep = (run: Run, stepIndex: number): Node | undefined =>
  run.graph.nodes.find((n) => n.step_indexes.includes(stepIndex));

// Where a run's frames are served from, and which of them exist (a replay
// sample ships only the kept and evidence frames).
export interface FrameSource { base: string; available: number[] | null }

export const hasFrame = (src: FrameSource, i: number): boolean => src.available === null || src.available.includes(i);

/** URL of a frame; a missing frame falls back to the nearest earlier one that exists. */
export const frameUrl = (run: Run, src: FrameSource, frameIndex: number): string => {
  let i = Math.max(0, Math.min(run.frames.length - 1, frameIndex));
  if (src.available !== null && !src.available.includes(i)) {
    const earlier = src.available.filter((a) => a <= i);
    i = earlier.length ? Math.max(...earlier) : Math.min(...src.available);
  }
  return `${src.base}/${run.frames[i].path.replace(/^frames\//, "")}`;
};

export const stepsOf = (run: Run, node: Node): Step[] => node.step_indexes.map((i) => run.steps[i]);

export const findingLabel: Record<Finding["rule"], string> = {
  "long-step": "Long step",
  loop: "Loop",
  "app-switch-copy": "Re-keying",
};

export function wrapText(text: string, maxChars: number, maxLines = 2): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}
