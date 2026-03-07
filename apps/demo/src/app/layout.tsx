import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prometheus — Give Your AI an Embodied Avatar",
  description:
    "Open-source SDK to give any LLM agent a Live2D avatar with real-time lip-sync, emotion expressions, and TTS. The fire that brings AI to life.",
  keywords: [
    "AI avatar",
    "Live2D",
    "LLM",
    "embodied intelligence",
    "OpenClaw",
    "TTS",
    "lip sync",
    "virtual avatar",
    "SDK",
  ],
  openGraph: {
    title: "Prometheus — Embodied Intelligence for AI Agents",
    description: "Give your AI agent a face, a voice, and a soul. 5-minute setup.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
