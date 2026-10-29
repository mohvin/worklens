import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "WorkLens",
  description: "Record how work actually happens. WorkLens watches the screen and hands you the process, the timings and where it breaks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <header className="topbar">
          <Link className="mark" href="/" aria-label="WorkLens home"><i aria-hidden="true" />WorkLens</Link>
          <span className="ws">PurpleAI Labs · Demo workspace</span>
          <nav className="topnav" aria-label="Primary"><Link href="/" aria-current="page">Runs</Link></nav>
          <div className="right">
            <a href="https://github.com/mohvin/worklens" target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>Source</a>
            <span className="avatar" aria-label="Mohan">ML</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
