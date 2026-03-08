import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

import Script from "next/script";

export const metadata: Metadata = {
  title: "Prometheus — Give Your AI an Embodied Avatar",
  description: "Open-source SDK to give any LLM agent a Live2D avatar with real-time lip-sync, emotion expressions, and TTS.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${playfair.variable}`} suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        {/* Live2D Cubism 2 runtime — for Cubism 2 models */}
        <Script
          src="https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js"
          strategy="beforeInteractive"
        />
        {/* Live2D Cubism 4 Core — for Cubism 4 models */}
        <Script
          src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}
