import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "MindForum",
  description: "Shared AI workspace for collaborative brainstorming.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
