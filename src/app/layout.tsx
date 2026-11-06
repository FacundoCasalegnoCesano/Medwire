import type { Metadata } from "next";
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import MotionProvider from "@/components/ui/motion-provider";

export const metadata: Metadata = {
  title: { default: "Mendwire — API source monitoring", template: "%s | Mendwire" },
  description: "Manage private monitors for public OpenAPI contracts and Git repositories, with clear source validation states.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" data-theme="dark">
      <body>
        {/*
          THESIS: API source monitoring should feel like a precise engineering tool.
          OWN-WORLD: A graphite code workbench with ice-blue actions and source-first hierarchy.
          STORY: Understand Mendwire, sign in, then manage real API monitors and account access.
          FIRST VIEWPORT: Dark editor surface, direct product statement, precise action, and a real example panel.
          FORM: User-pinned graphite and ice-blue direction, built code-first; keep effects restrained and honor reduced motion.
          unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
        */}
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
