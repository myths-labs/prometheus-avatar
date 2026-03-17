"use client";

import { useEffect, useRef } from "react";

/**
 * Starfield / Milky Way particle background
 * Canvas-based for smooth 60fps performance
 * Creates a slowly drifting field of stars with varying brightness
 */
export default function StarfieldBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let animationId: number;
        let stars: Star[] = [];

        interface Star {
            x: number;
            y: number;
            size: number;
            brightness: number;
            twinkleSpeed: number;
            twinklePhase: number;
            drift: number;
            color: string;
        }

        function resize() {
            canvas!.width = window.innerWidth;
            canvas!.height = window.innerHeight;
            initStars();
        }

        function initStars() {
            const count = Math.floor((canvas!.width * canvas!.height) / 2500); // density
            stars = [];

            for (let i = 0; i < count; i++) {
                const isBright = Math.random() < 0.08;
                const isMilkyWay = isMilkyWayRegion(
                    Math.random() * canvas!.width,
                    Math.random() * canvas!.height,
                    canvas!.width,
                    canvas!.height
                );

                stars.push({
                    x: Math.random() * canvas!.width,
                    y: Math.random() * canvas!.height,
                    size: isBright ? 1.2 + Math.random() * 1.5 : 0.3 + Math.random() * 0.8,
                    brightness: isMilkyWay
                        ? 0.4 + Math.random() * 0.6
                        : 0.1 + Math.random() * 0.5,
                    twinkleSpeed: 0.015 + Math.random() * 0.04,
                    twinklePhase: Math.random() * Math.PI * 2,
                    drift: (Math.random() - 0.5) * 0.6,
                    color: getStarColor(),
                });
            }

            // Add extra density in the milky way band
            const milkyWayExtra = Math.floor(count * 0.4);
            for (let i = 0; i < milkyWayExtra; i++) {
                const angle = Math.random() * Math.PI * 2;
                const cx = canvas!.width * 0.5;
                const cy = canvas!.height * 0.4;
                const spreadX = canvas!.width * 0.5;
                const spreadY = canvas!.height * 0.12;
                const x = cx + Math.cos(angle + 0.3) * spreadX * (0.3 + Math.random() * 0.7);
                const y = cy + Math.sin(angle + 0.3) * spreadY * (0.3 + Math.random() * 0.7);

                stars.push({
                    x: ((x % canvas!.width) + canvas!.width) % canvas!.width,
                    y: ((y % canvas!.height) + canvas!.height) % canvas!.height,
                    size: 0.2 + Math.random() * 0.6,
                    brightness: 0.15 + Math.random() * 0.35,
                    twinkleSpeed: 0.008 + Math.random() * 0.03,
                    twinklePhase: Math.random() * Math.PI * 2,
                    drift: (Math.random() - 0.5) * 0.4,
                    color: getMilkyWayColor(),
                });
            }
        }

        function isMilkyWayRegion(x: number, y: number, w: number, h: number): boolean {
            const cy = h * 0.4;
            const bandHeight = h * 0.15;
            return Math.abs(y - cy) < bandHeight;
        }

        function getStarColor(): string {
            const r = Math.random();
            if (r < 0.3) return "200, 220, 255"; // blue-white
            if (r < 0.6) return "255, 250, 240"; // warm white
            if (r < 0.8) return "180, 210, 255"; // blue
            if (r < 0.9) return "255, 220, 180"; // orange
            return "0, 212, 170"; // prometheus teal (subtle branding)
        }

        function getMilkyWayColor(): string {
            const r = Math.random();
            if (r < 0.4) return "180, 200, 240"; // pale blue
            if (r < 0.7) return "220, 210, 240"; // pale lavender
            if (r < 0.9) return "200, 220, 255"; // blue-white
            return "0, 212, 170"; // teal accent
        }

        let time = 0;

        function draw() {
            ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
            time += 0.016;

            // Draw subtle milky way glow
            const gradient = ctx!.createRadialGradient(
                canvas!.width * 0.5, canvas!.height * 0.38,
                0,
                canvas!.width * 0.5, canvas!.height * 0.38,
                canvas!.width * 0.45
            );
            gradient.addColorStop(0, "rgba(100, 120, 180, 0.03)");
            gradient.addColorStop(0.5, "rgba(80, 100, 160, 0.015)");
            gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx!.fillStyle = gradient;
            ctx!.fillRect(0, 0, canvas!.width, canvas!.height);

            // Draw stars
            for (const star of stars) {
                const twinkle = Math.sin(time * star.twinkleSpeed * 60 + star.twinklePhase);
                const alpha = star.brightness * (0.6 + 0.4 * twinkle);

                if (alpha <= 0) continue;

                // Drift — noticeable streaming movement
                star.x += star.drift * 0.8;
                star.y -= 0.15 + star.size * 0.1; // faster upward drift, bigger = faster

                // Wrap
                if (star.x < 0) star.x += canvas!.width;
                if (star.x > canvas!.width) star.x -= canvas!.width;
                if (star.y < 0) star.y += canvas!.height;

                ctx!.beginPath();
                ctx!.arc(star.x, star.y, star.size, 0, Math.PI * 2);
                ctx!.fillStyle = `rgba(${star.color}, ${alpha})`;
                ctx!.fill();

                // Glow for bright stars
                if (star.size > 1) {
                    ctx!.beginPath();
                    ctx!.arc(star.x, star.y, star.size * 3, 0, Math.PI * 2);
                    ctx!.fillStyle = `rgba(${star.color}, ${alpha * 0.08})`;
                    ctx!.fill();
                }
            }

            animationId = requestAnimationFrame(draw);
        }

        resize();
        draw();

        window.addEventListener("resize", resize);
        return () => {
            window.removeEventListener("resize", resize);
            cancelAnimationFrame(animationId);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 z-0 pointer-events-none"
            style={{ opacity: 0.85 }}
        />
    );
}
