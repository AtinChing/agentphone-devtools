import type { Metadata } from "next";
import "./globals.css";
import { LiveProvider } from "@/lib/live";
import { Shell } from "@/components/dashboard/Shell";

export const metadata: Metadata = {
  title: "AgentPhone DevTools",
  description: "Local AgentPhone webhook simulator, step debugger and iMessage campaign lab"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Browser extensions stamp attributes on <html> before hydration; that is
    // not a mismatch worth an overlay.
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <LiveProvider>
          <Shell>{children}</Shell>
        </LiveProvider>
      </body>
    </html>
  );
}
