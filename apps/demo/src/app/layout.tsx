import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Prometheus — Give Your AI an Embodied Avatar",
  description: "Open-source SDK to give any LLM agent a Live2D avatar with real-time lip-sync, emotion expressions, and TTS.",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
};

import StarfieldBackground from "@/components/StarfieldBackground";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${playfair.variable}`} suppressHydrationWarning>
      <head>
        <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <StarfieldBackground />
        {children}
      </body>
    </html>
  );
}
