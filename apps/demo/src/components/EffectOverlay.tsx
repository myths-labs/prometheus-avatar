"use client";

import { useEffect, useRef } from "react";

/**
 * EffectOverlay — Renders particle effects from marketplace assets
 * 
 * Supports multiple effect types:
 * - particles: floating particles with configurable color/density
 * - sparkle: glittering sparkle effect
 * - rain: falling rain/sakura/snow particles
 * - aura: glowing aura around the avatar
 */

interface Effect {
    type: string;
    color?: string;
    density?: number;
    speed?: number;
}

interface EffectOverlayProps {
    effects: Effect[];
}

interface Particle {
    x: number;
    y: number;
    size: number;
    speedX: number;
    speedY: number;
    alpha: number;
    color: string;
    life: number;
    maxLife: number;
}

export default function EffectOverlay({ effects }: EffectOverlayProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (effects.length === 0) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let animationId: number;
        let particles: Particle[] = [];

        function resize() {
            canvas!.width = canvas!.parentElement?.clientWidth || 800;
            canvas!.height = canvas!.parentElement?.clientHeight || 600;
        }
        resize();

        function spawnParticles(effect: Effect) {
            const count = effect.density || 30;
            const color = effect.color || "#00d4aa";
            const type = effect.type || "particles";

            for (let i = 0; i < count; i++) {
                const p: Particle = {
                    x: Math.random() * canvas!.width,
                    y: type === "rain" ? -10 : Math.random() * canvas!.height,
                    size: type === "sparkle" ? 1 + Math.random() * 3 : 1 + Math.random() * 2,
                    speedX: type === "rain" ? (Math.random() - 0.5) * 0.5 : (Math.random() - 0.5) * 1.5,
                    speedY: type === "rain" ? 1 + Math.random() * 3 : (Math.random() - 0.5) * 1,
                    alpha: 0.3 + Math.random() * 0.7,
                    color,
                    life: 0,
                    maxLife: type === "sparkle" ? 30 + Math.random() * 60 : 100 + Math.random() * 200,
                };

                if (type === "aura") {
                    // Circular around center
                    const angle = Math.random() * Math.PI * 2;
                    const radius = 80 + Math.random() * 120;
                    p.x = canvas!.width / 2 + Math.cos(angle) * radius;
                    p.y = canvas!.height / 2 + Math.sin(angle) * radius;
                    p.speedX = Math.cos(angle + Math.PI / 2) * 0.5;
                    p.speedY = Math.sin(angle + Math.PI / 2) * 0.5;
                }

                particles.push(p);
            }
        }

        // Initial spawn
        effects.forEach(e => spawnParticles(e));

        function draw() {
            ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.x += p.speedX;
                p.y += p.speedY;
                p.life++;

                const lifeRatio = p.life / p.maxLife;
                const alpha = p.alpha * (1 - lifeRatio);

                if (alpha <= 0 || p.life > p.maxLife) {
                    particles.splice(i, 1);
                    continue;
                }

                ctx!.beginPath();
                ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx!.fillStyle = `${p.color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
                ctx!.fill();

                // Glow
                if (p.size > 1.5) {
                    ctx!.beginPath();
                    ctx!.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
                    ctx!.fillStyle = `${p.color}${Math.round(alpha * 0.15 * 255).toString(16).padStart(2, "0")}`;
                    ctx!.fill();
                }
            }

            // Respawn when particles deplete
            if (particles.length < 10) {
                effects.forEach(e => spawnParticles(e));
            }

            animationId = requestAnimationFrame(draw);
        }

        draw();
        window.addEventListener("resize", resize);

        return () => {
            cancelAnimationFrame(animationId);
            window.removeEventListener("resize", resize);
        };
    }, [effects]);

    if (effects.length === 0) return null;

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 z-20 pointer-events-none"
            style={{ opacity: 0.8 }}
        />
    );
}
