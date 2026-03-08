"use client";

import { useState, useRef, useCallback } from "react";
import AvatarCanvas, { AvatarCanvasHandle } from "@/components/AvatarCanvas";
import ChatPanel from "@/components/ChatPanel";
import AvatarSelector from "@/components/AvatarSelector";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import FeatureCards from "@/components/FeatureCards";

const AVATARS = [
  { id: "haru", name: "Haru", description: "Friendly and expressive", modelUrl: "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@0.4.0/test/assets/haru/haru_greeter_t03.model3.json", thumbnail: "🧑‍🎤", badge: "official" },
  { id: "shizuku", name: "Shizuku", description: "Calm and elegant", modelUrl: "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@0.4.0/test/assets/shizuku/shizuku.model.json", thumbnail: "👩", badge: "official" },
  { id: "koharu", name: "Koharu", description: "Sweet and gentle", modelUrl: "https://cdn.jsdelivr.net/npm/live2d-widget-model-koharu/assets/koharu.model.json", thumbnail: "🌸", badge: "official" },
];

export default function HomeClient() {
  const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0]);
  const [currentEmotion, setCurrentEmotion] = useState("neutral");
  const [isAvatarReady, setIsAvatarReady] = useState(false);
  const avatarRef = useRef<AvatarCanvasHandle>(null);
  const demoRef = useRef<HTMLDivElement>(null);

  const handleSpeak = useCallback(async (text: string) => {
    if (avatarRef.current) { try { await avatarRef.current.speak(text); } catch (e) { console.error(e); } }
  }, []);
  const handleInterrupt = useCallback(() => {
    if (avatarRef.current) { try { avatarRef.current.interrupt?.(); } catch { } }
  }, []);
  const handleEmotionChange = useCallback((emotion: string) => { setCurrentEmotion(emotion); }, []);
  const scrollToDemo = useCallback(() => { demoRef.current?.scrollIntoView({ behavior: "smooth" }); }, []);

  return (
    <main className="min-h-screen">
      <Header />
      <HeroSection onTryDemo={scrollToDemo} />
      <FeatureCards />

      {/* Demo Section */}
      <section ref={demoRef} id="demo" className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-14">
          <div className="ornamental-divider max-w-xs mx-auto mb-8">✦</div>
          <h2 className="heading-serif text-4xl md:text-5xl mb-4">
            <em>Try It Live</em>
          </h2>
          <p className="prophecy-quote max-w-md mx-auto">
            Type a message and watch the avatar respond with emotion...
          </p>
        </div>

        <AvatarSelector avatars={AVATARS} selected={selectedAvatar} onSelect={setSelectedAvatar} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          <div className="relative">
            <div className="w-full aspect-[4/3]">
              <AvatarCanvas ref={avatarRef} modelUrl={selectedAvatar.modelUrl} onReady={() => setIsAvatarReady(true)} onEmotionChange={handleEmotionChange} />
              <div className="absolute top-4 right-4">
                <div className={`emotion-badge ${currentEmotion === "happy" ? "bg-[#c9a84c]/20 text-[#e8d48b]"
                  : currentEmotion === "sad" ? "bg-[#4a7ab5]/20 text-[#7ab5e0]"
                    : currentEmotion === "angry" ? "bg-[#c94c4c]/20 text-[#e88b8b]"
                      : currentEmotion === "surprised" ? "bg-[#c9a84c]/20 text-[#e8d48b]"
                        : currentEmotion === "thinking" ? "bg-[#00d4aa]/20 text-[#4aecd0]"
                          : "bg-[#6b7a8d]/20 text-[#a8b8d0]"
                  }`}>
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
              <h3 className="text-lg font-semibold text-[#eae6df]">{selectedAvatar.name}</h3>
              <p className="text-sm text-[#6b7a8d]">{selectedAvatar.description}</p>
            </div>
          </div>
          <ChatPanel onSendMessage={handleSpeak} onInterrupt={handleInterrupt} isAvatarReady={isAvatarReady} />
        </div>
      </section>

      {/* CTA — Aithena-style clean card */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <div className="card-dark p-14 relative">
          <div className="ambient-glow -top-40 -right-40" />
          <div className="relative z-10">
            <h2 className="heading-serif text-3xl md:text-4xl mb-4">
              Ready to give your AI <em>a body</em>?
            </h2>
            <p className="text-[#a8b8d0] text-lg mb-10 font-light">
              One command. Five minutes. Infinite possibilities.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
              <code className="bg-black/50 border border-white/5 rounded-full px-6 py-3 font-mono text-sm text-[#00d4aa]">
                npm install @prometheusavatar/core
              </code>
              <a href="https://github.com/myths-labs/prometheus-avatar" className="btn-primary" target="_blank" rel="noopener">
                ⭐ Star on GitHub
              </a>
            </div>
            <p className="prophecy-quote text-sm">
              🦞 First-class OpenClaw plugin included — millions of lobsters, meet your new body.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-10 text-center">
        <p className="text-[#6b7a8d] text-sm font-light">
          Built with 🔥 by{" "}
          <a href="https://github.com/myths-labs" className="text-[#00d4aa] hover:text-[#4aecd0] transition-colors">Myths Labs</a>
          {" "}— Open Source under MIT License
        </p>
      </footer>
    </main>
  );
}
