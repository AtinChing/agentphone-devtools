import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentPhone DevTools",
  description: "Local AgentPhone webhook simulator and inspector"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
