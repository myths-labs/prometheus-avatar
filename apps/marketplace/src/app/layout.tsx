import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prometheus Marketplace — AI Avatar Assets",
  description:
    "Browse, buy, and sell AI avatar skins, voices, effects, and accessories. The world's largest marketplace for AI agent avatars.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
