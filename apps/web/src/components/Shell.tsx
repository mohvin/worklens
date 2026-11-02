"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Left icon rail + top bar, shared with the PurpleAI partner portal's shell.
// Rail: Overview, Runs, Processes, Record (extension), Guide. Active item follows the path.

const I = {
  home: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
  runs: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" /></svg>,
  procs: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="5" rx="1.2" /><rect x="14" y="4" width="7" height="5" rx="1.2" /><rect x="8.5" y="15" width="7" height="5" rx="1.2" /><path d="M6.5 9v3h11V9M12 12v3" /></svg>,
  record: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" /></svg>,
  guide: <svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5V5.5M8 7h8M8 11h6" /></svg>,
  caret: <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>,
};

const ITEMS: { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean; external?: boolean }[] = [
  { href: "/", label: "Overview", icon: I.home, match: (p) => p === "/" },
  { href: "/#runs", label: "Runs", icon: I.runs, match: (p) => p.startsWith("/runs") },
  { href: "/#processes", label: "Processes", icon: I.procs, match: (p) => p.startsWith("/processes") },
  { href: "https://github.com/mohvin/worklens/tree/main/apps/extension#readme", label: "Record", icon: I.record, match: () => false, external: true },
  { href: "https://github.com/mohvin/worklens#readme", label: "Guide", icon: I.guide, match: () => false, external: true },
];

export function Rail() {
  const path = usePathname() ?? "/";
  return (
    <aside className="rail" aria-label="Sections">
      <Link href="/" className="mark" aria-label="WorkLens home" />
      {ITEMS.slice(0, 3).map((it) => <Link key={it.label} href={it.href} className="item" aria-current={it.match(path) ? "page" : undefined}>{it.icon}{it.label}</Link>)}
      <span className="grow" />
      {ITEMS.slice(3).map((it) => <a key={it.label} href={it.href} className="item" target="_blank" rel="noreferrer">{it.icon}{it.label}</a>)}
    </aside>
  );
}

export function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <Link className="wordmark" href="/"><b>WorkLens</b><span>Process intelligence · PurpleAI Labs</span></Link>
        <span className="ws" title="Workspace">Demo workspace {I.caret}</span>
        <div className="right">
          <a className="btn ghost" href="https://github.com/mohvin/worklens" target="_blank" rel="noreferrer">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>
            Source
          </a>
          <span className="avatar" aria-label="Mohan" title="Mohan">ML</span>
        </div>
      </div>
    </header>
  );
}
