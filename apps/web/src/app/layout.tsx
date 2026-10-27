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
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="top">
          <div className="wrap">
            <Link href="/" className="wordmark"><i aria-hidden />WorkLens</Link>
            <nav>
              <Link href="/">Runs</Link>
              <a href="https://github.com/mohvin/worklens" target="_blank" rel="noreferrer">Source</a>
            </nav>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
