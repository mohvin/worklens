import type { Metadata } from "next";
import "./globals.css";
import { Rail, TopBar } from "@/components/Shell";

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
        <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <meta name="theme-color" content="#5b3fe0" />
      </head>
      <body>
        <div className="shell">
          <Rail />
          <div style={{ minWidth: 0 }}>
            <TopBar />
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
