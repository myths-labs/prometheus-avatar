/**
 * React Example — Prometheus Avatar in a React component
 *
 * Install: npm install @prometheusavatar/core react react-dom
 */

import { useEffect, useRef, useState } from 'react';
import { createAvatar, type PrometheusAvatar, type Emotion } from '@prometheusavatar/core';

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@0.4.0/test/assets/haru/haru_greeter_t03.model3.json';

export default function AvatarDemo() {
    const containerRef = useRef<HTMLDivElement>(null);
    const avatarRef = useRef<PrometheusAvatar | null>(null);
    const [emotion, setEmotion] = useState<Emotion>('neutral');
    const [input, setInput] = useState('');

    useEffect(() => {
        if (!containerRef.current) return;

        let mounted = true;
        createAvatar({
            container: containerRef.current,
            modelUrl: MODEL_URL,
        }).then((avatar) => {
            if (!mounted) return avatar.destroy();
            avatarRef.current = avatar;

            avatar.on('emotion:change', ({ result }) => {
                setEmotion(result.emotion);
            });
        });

        return () => {
            mounted = false;
            avatarRef.current?.destroy();
        };
    }, []);

    const handleSpeak = () => {
        if (avatarRef.current && input.trim()) {
            avatarRef.current.speak(input);
            setInput('');
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div ref={containerRef} style={{ width: 800, height: 600, borderRadius: 16, overflow: 'hidden' }} />
            <p>Current emotion: {emotion}</p>
            <div style={{ display: 'flex', gap: 8 }}>
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSpeak()}
                    placeholder="Type something..."
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #333', background: '#111', color: '#fff' }}
                />
                <button onClick={handleSpeak} style={{ padding: '8px 16px', borderRadius: 8, background: '#00d4aa', color: '#050508', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                    Speak
                </button>
            </div>
        </div>
    );
}
