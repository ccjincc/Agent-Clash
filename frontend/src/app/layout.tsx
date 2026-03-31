import type { Metadata } from "next";
import "./globals.css";
import ThemeSync from "@/components/ui/ThemeSync";

export const metadata: Metadata = {
  title: "Agent-Clash",
  description: "Agent-Clash: Multi-agent arena",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
