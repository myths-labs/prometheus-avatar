"use client";

/**
 * FaceTracker — Camera-based head tracking for VTuber mode
 * 
 * Uses browser's built-in face detection (where available) or 
 * simple head position estimation to control avatar head movement.
 * Sends ParamAngleX/Y/Z to the avatar iframe via postMessage.
 */

import { useEffect, useRef, useState, useCallback } from "react";

interface FaceTrackerProps {
    /** Whether tracking is active */
    enabled: boolean;
    /** Callback when face angles change */
    onFaceAngles?: (angles: { x: number; y: number; z: number }) => void;
}

export default function FaceTracker({ enabled, onFaceAngles }: FaceTrackerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isTracking, setIsTracking] = useState(false);
    const [hasCamera, setHasCamera] = useState(true);
    const streamRef = useRef<MediaStream | null>(null);
    const animFrameRef = useRef<number>(0);

    const startTracking = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 320, height: 240, facingMode: "user" },
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            setIsTracking(true);
            setHasCamera(true);
        } catch {
            setHasCamera(false);
            console.warn("[FaceTracker] No camera access");
        }
    }, []);

    const stopTracking = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        cancelAnimationFrame(animFrameRef.current);
        setIsTracking(false);
    }, []);

    useEffect(() => {
        if (enabled) {
            startTracking();
        } else {
            stopTracking();
        }
        return () => stopTracking();
    }, [enabled, startTracking, stopTracking]);

    // Simple face detection using canvas brightness analysis
    // (Works everywhere, no external dependencies)
    useEffect(() => {
        if (!isTracking || !videoRef.current || !canvasRef.current) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = 320;
        canvas.height = 240;

        let smoothX = 0, smoothY = 0;

        function detectFace() {
            if (!video.videoWidth) {
                animFrameRef.current = requestAnimationFrame(detectFace);
                return;
            }

            ctx!.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx!.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // Detect face region using skin-color detection
            // Skin tone in RGB: R > 60, G > 40, B > 20, R > G > B (approx)
            let skinX = 0, skinY = 0, skinCount = 0;

            for (let y = 0; y < canvas.height; y += 4) {
                for (let x = 0; x < canvas.width; x += 4) {
                    const i = (y * canvas.width + x) * 4;
                    const r = data[i], g = data[i + 1], b = data[i + 2];

                    // Simple skin color detection
                    if (r > 80 && g > 50 && b > 30 && r > g && g > b &&
                        (r - g) > 15 && r > 100) {
                        skinX += x;
                        skinY += y;
                        skinCount++;
                    }
                }
            }

            if (skinCount > 50) {
                // Calculate face center relative to frame center
                const faceCenterX = skinX / skinCount;
                const faceCenterY = skinY / skinCount;

                // Normalize to -1 to 1 range (0 = center)
                const normalizedX = (faceCenterX / canvas.width - 0.5) * 2;
                const normalizedY = (faceCenterY / canvas.height - 0.5) * 2;

                // Map to avatar angle range (-30 to 30 degrees)
                // Mirror X axis (camera is mirrored)
                const angleX = -normalizedX * 30;
                const angleY = -normalizedY * 20;

                // Smooth the values
                smoothX += (angleX - smoothX) * 0.15;
                smoothY += (angleY - smoothY) * 0.15;

                onFaceAngles?.({
                    x: Math.round(smoothX * 10) / 10,
                    y: Math.round(smoothY * 10) / 10,
                    z: 0,
                });
            }

            animFrameRef.current = requestAnimationFrame(detectFace);
        }

        detectFace();

        return () => cancelAnimationFrame(animFrameRef.current);
    }, [isTracking, onFaceAngles]);

    if (!enabled) return null;

    return (
        <div className="fixed bottom-4 right-4 z-50">
            {/* Compact camera preview */}
            <div className="relative w-24 h-18 rounded-xl overflow-hidden border border-white/10 bg-black/50 backdrop-blur-sm">
                <video
                    ref={videoRef}
                    className="w-full h-full object-cover transform scale-x-[-1]"
                    playsInline
                    muted
                />
                <canvas ref={canvasRef} className="hidden" />
                {isTracking && (
                    <div className="absolute top-1 left-1 w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                )}
                {!hasCamera && (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-red-400">
                        No Camera
                    </div>
                )}
            </div>
            <div className="text-[10px] text-[#7a8a9d] text-center mt-1">
                {isTracking ? "🎥 VTuber Mode" : "Starting..."}
            </div>
        </div>
    );
}
