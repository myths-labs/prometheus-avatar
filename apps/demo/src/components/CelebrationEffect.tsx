"use client";

import { useEffect, useState, useRef } from "react";

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    size: number;
    life: number;
    maxLife: number;
}

const CELEBRATION_COLORS = {
    fireworks: ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#ff6b9d", "#c9a84c", "#00d4aa"],
    rainbow: ["#ff0000", "#ff7700", "#ffff00", "#00ff00", "#0000ff", "#8b00ff"],
    golden: ["#c9a84c", "#e8c84a", "#ffd700", "#daa520", "#f4c430"],
};

export default function CelebrationEffect({ type = "fireworks", duration = 5000 }: { type?: "fireworks" | "rainbow" | "golden"; duration?: number }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [active, setActive] = useState(true);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const particles: Particle[] = [];
        const colors = CELEBRATION_COLORS[type];
        let animId: number;
        let spawnTimer: NodeJS.Timeout;

        function spawnBurst(cx: number, cy: number) {
            const count = 30 + Math.floor(Math.random() * 20);
            for (let i = 0; i < count; i++) {
                const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3;
                const speed = 2 + Math.random() * 4;
                particles.push({
                    x: cx,
                    y: cy,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    size: 2 + Math.random() * 3,
                    life: 1,
                    maxLife: 60 + Math.random() * 40,
                });
            }
        }

        // Spawn bursts periodically
        function scheduleBurst() {
            const x = Math.random() * canvas!.width;
            const y = Math.random() * canvas!.height * 0.6;
            spawnBurst(x, y);
            spawnTimer = setTimeout(scheduleBurst, 300 + Math.random() * 500);
        }
        scheduleBurst();

        function animate() {
            ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.05; // gravity
                p.vx *= 0.99; // friction
                p.life++;

                const alpha = Math.max(0, 1 - p.life / p.maxLife);
                if (alpha <= 0) {
                    particles.splice(i, 1);
                    continue;
                }

                ctx!.beginPath();
                ctx!.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
                ctx!.fillStyle = p.color + Math.floor(alpha * 255).toString(16).padStart(2, "0");
                ctx!.fill();

                // Trail
                ctx!.beginPath();
                ctx!.moveTo(p.x, p.y);
                ctx!.lineTo(p.x - p.vx * 2, p.y - p.vy * 2);
                ctx!.strokeStyle = p.color + Math.floor(alpha * 128).toString(16).padStart(2, "0");
                ctx!.lineWidth = p.size * alpha * 0.5;
                ctx!.stroke();
            }

            animId = requestAnimationFrame(animate);
        }
        animate();

        // Auto-stop after duration
        const stopTimer = setTimeout(() => {
            setActive(false);
            clearTimeout(spawnTimer);
        }, duration);

        const handleResize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        window.addEventListener("resize", handleResize);

        return () => {
            cancelAnimationFrame(animId);
            clearTimeout(spawnTimer);
            clearTimeout(stopTimer);
            window.removeEventListener("resize", handleResize);
        };
    }, [type, duration]);

    if (!active) return null;

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 z-[200] pointer-events-none"
            style={{ mixBlendMode: "screen" }}
        />
    );
}
