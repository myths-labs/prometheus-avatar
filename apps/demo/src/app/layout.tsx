import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Prometheus — Give Your AI a Body",
  description: "Open-source SDK to give any LLM agent a Live2D / 3D avatar with real-time lip-sync, emotion expressions, and TTS.",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  metadataBase: new URL("https://prometheus.mythslabs.ai"),
  openGraph: {
    title: "Prometheus — Give Your AI a Body",
    description: "Open-source SDK to give any LLM agent a Live2D / 3D avatar with real-time lip-sync, emotion expressions, and TTS.",
    url: "https://prometheus.mythslabs.ai",
    siteName: "Prometheus by Myths Labs",
    images: [
      {
        url: "/images/og-image.png",
        width: 1200,
        height: 630,
        alt: "Prometheus — Give Your AI a Body",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Prometheus — Give Your AI a Body",
    description: "Open-source SDK to give any LLM agent a Live2D / 3D avatar with real-time lip-sync, emotion expressions, and TTS.",
    images: ["/images/og-image.png"],
    creator: "@MythsLabs",
  },
};

import StarfieldBackground from "@/components/StarfieldBackground";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${playfair.variable}`} suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="theme-color" content="#050508" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Prometheus" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <StarfieldBackground />
        {children}
        <PWAInstallPrompt />
        <script dangerouslySetInnerHTML={{
          __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
          }
        `}} />
      </body>
    </html>
  );
}
