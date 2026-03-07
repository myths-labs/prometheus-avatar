"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import AvatarCanvas from "@/components/AvatarCanvas";
import ChatPanel from "@/components/ChatPanel";
import AvatarSelector from "@/components/AvatarSelector";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import FeatureCards from "@/components/FeatureCards";

// Available demo avatars
const AVATARS = [
  {
    id: "haru",
    name: "Haru",
    description: "Friendly and expressive",
    modelUrl: "/models/haru/haru_greeter_t03.model3.json",
    thumbnail: "🧑‍🎤",
    badge: "official",
  },
  {
    id: "shizuku",
    name: "Shizuku",
    description: "Calm and elegant",
    modelUrl: "/models/shizuku/shizuku.model3.json",
    thumbnail: "👩",
    badge: "official",
  },
  {
    id: "mark",
    name: "Mark",
    description: "Cool and composed",
    modelUrl: "/models/mark/mark_free_t02.model3.json",
    thumbnail: "🧑‍💼",
    badge: "official",
  },
];

export default function Home() {
  const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0]);
  const [currentEmotion, setCurrentEmotion] = useState("neutral");
  const [isAvatarReady, setIsAvatarReady] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const avatarRef = useRef<any>(null);
  const demoRef = useRef<HTMLDivElement>(null);

  const handleSpeak = useCallback(async (text: string) => {
    if (avatarRef.current) {
      try {
        await avatarRef.current.speak(text);
      } catch (e) {
        console.error("Avatar speak error:", e);
      }
    }
  }, []);

  const handleEmotionChange = useCallback((emotion: string) => {
    setCurrentEmotion(emotion);
  }, []);

  const scrollToDemo = useCallback(() => {
    setShowDemo(true);
    setTimeout(() => {
      demoRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }, []);

  return (
    <main className="min-h-screen">
      <Header />
      <HeroSection onTryDemo={scrollToDemo} />

      {/* Feature Cards */}
      <FeatureCards />

      {/* Demo Section */}
      <section
        ref={demoRef}
        id="demo"
        className="max-w-7xl mx-auto px-6 py-20"
      >
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Try It Live
            </span>
          </h2>
          <p className="text-gray-400 text-lg">
            Type a message and watch the avatar respond with emotion
          </p>
        </div>

        {/* Avatar Selector */}
        <AvatarSelector
          avatars={AVATARS}
          selected={selectedAvatar}
          onSelect={setSelectedAvatar}
        />

        {/* Demo Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          {/* Avatar Canvas */}
          <div className="glass-strong p-2 relative">
            <div className="avatar-container w-full aspect-[4/3]">
              <AvatarCanvas
                ref={avatarRef}
                modelUrl={selectedAvatar.modelUrl}
                onReady={() => setIsAvatarReady(true)}
                onEmotionChange={handleEmotionChange}
              />
              {/* Emotion Badge */}
              <div className="absolute top-4 right-4">
                <div
                  className={`emotion-badge ${currentEmotion === "happy"
                      ? "bg-yellow-500/20 text-yellow-300"
                      : currentEmotion === "sad"
                        ? "bg-blue-500/20 text-blue-300"
                        : currentEmotion === "angry"
                          ? "bg-red-500/20 text-red-300"
                          : currentEmotion === "surprised"
                            ? "bg-orange-500/20 text-orange-300"
                            : currentEmotion === "thinking"
                              ? "bg-cyan-500/20 text-cyan-300"
                              : "bg-gray-500/20 text-gray-300"
                    }`}
                >
                  {currentEmotion === "happy" && "😊"}
                  {currentEmotion === "sad" && "😢"}
                  {currentEmotion === "angry" && "😠"}
                  {currentEmotion === "surprised" && "😲"}
                  {currentEmotion === "thinking" && "🤔"}
                  {currentEmotion === "neutral" && "😐"}
                  <span className="ml-1 capitalize">{currentEmotion}</span>
                </div>
              </div>
            </div>
            <div className="text-center mt-3 pb-2">
              <h3 className="text-lg font-semibold">{selectedAvatar.name}</h3>
              <p className="text-sm text-gray-400">
                {selectedAvatar.description}
              </p>
            </div>
          </div>

          {/* Chat Panel */}
          <ChatPanel onSendMessage={handleSpeak} isAvatarReady={isAvatarReady} />
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <div className="glass-strong p-12 relative overflow-hidden">
          <div className="ambient-glow -top-20 -right-20" />
          <h2 className="text-3xl md:text-4xl font-bold mb-4 relative z-10">
            Ready to give your AI a body?
          </h2>
          <p className="text-gray-400 text-lg mb-8 relative z-10">
            One command. Five minutes. Infinite possibilities.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 relative z-10">
            <code className="bg-black/40 border border-gray-700 rounded-lg px-6 py-3 font-mono text-sm text-purple-300">
              npm install @prometheus-avatar/core
            </code>
            <a
              href="https://github.com/myths-labs/prometheus"
              className="btn-primary"
              target="_blank"
              rel="noopener"
            >
              ⭐ Star on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-8 text-center">
        <p className="text-gray-500 text-sm">
          Built with 🔥 by{" "}
          <a
            href="https://github.com/myths-labs"
            className="text-purple-400 hover:text-purple-300 transition-colors"
          >
            Myths Labs
          </a>{" "}
          — Open Source under MIT License
        </p>
      </footer>
    </main>
  );
}
