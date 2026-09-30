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
    <html lang="en">
      <body>
        <LiveProvider>
          <Shell>{children}</Shell>
        </LiveProvider>
      </body>
    </html>
  );
}
