import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "OpenBench — the open workbench for electronics",
  description:
    "Design schematics, simulate circuits, and build firmware in the browser. 100% open source, powered by KiCad, ngspice, and PlatformIO behind one interchange format.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
