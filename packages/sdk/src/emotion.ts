/**
 * Rule-based Emotion Analyzer
 *
 * Analyzes text for emotional cues using punctuation, emojis, and keywords.
 * MVP approach — v2 will use LLM-based analysis.
 */

import type { Emotion, EmotionResult } from './types';

/** Emoji → emotion mapping */
const EMOJI_MAP: Record<string, Emotion> = {
    '😊': 'happy', '😄': 'happy', '😃': 'happy', '🥰': 'happy', '❤️': 'happy',
    '😂': 'happy', '🤣': 'happy', '😁': 'happy', '💕': 'happy', '✨': 'happy',
    '🎉': 'happy', '👍': 'happy', '😍': 'happy', '🙂': 'happy', '☺️': 'happy',
    '😢': 'sad', '😭': 'sad', '😞': 'sad', '😔': 'sad', '💔': 'sad',
    '🥺': 'sad', '😿': 'sad', '😟': 'sad',
    '😠': 'angry', '😡': 'angry', '🤬': 'angry', '💢': 'angry', '👊': 'angry',
    '😤': 'angry', '🔥': 'angry',
    '😲': 'surprised', '😮': 'surprised', '🤯': 'surprised', '😱': 'surprised',
    '❗': 'surprised', '⁉️': 'surprised', '‼️': 'surprised', '😳': 'surprised',
    '🤔': 'thinking', '💭': 'thinking', '🧐': 'thinking', '📝': 'thinking',
};

/** Keyword → emotion mapping (lowercase) */
const KEYWORD_MAP: Record<string, Emotion> = {
    // Happy
    'happy': 'happy', 'glad': 'happy', 'great': 'happy', 'awesome': 'happy',
    'wonderful': 'happy', 'love': 'happy', 'amazing': 'happy', 'excellent': 'happy',
    'fantastic': 'happy', 'beautiful': 'happy', 'perfect': 'happy', 'haha': 'happy',
    'lol': 'happy', 'yay': 'happy', 'hooray': 'happy', 'congratulations': 'happy',
    '开心': 'happy', '高兴': 'happy', '太好了': 'happy', '棒': 'happy', '哈哈': 'happy',

    // Sad
    'sad': 'sad', 'sorry': 'sad', 'unfortunately': 'sad', 'miss': 'sad',
    'disappointed': 'sad', 'depressed': 'sad', 'unhappy': 'sad', 'cry': 'sad',
    'tragic': 'sad', 'heartbroken': 'sad',
    '难过': 'sad', '伤心': 'sad', '可惜': 'sad', '遗憾': 'sad',

    // Angry
    'angry': 'angry', 'furious': 'angry', 'hate': 'angry', 'terrible': 'angry',
    'awful': 'angry', 'stupid': 'angry', 'ridiculous': 'angry', 'unacceptable': 'angry',
    '生气': 'angry', '愤怒': 'angry', '讨厌': 'angry',

    // Surprised
    'wow': 'surprised', 'whoa': 'surprised', 'omg': 'surprised', 'incredible': 'surprised',
    'unbelievable': 'surprised', 'shocking': 'surprised', 'unexpected': 'surprised',
    '哇': 'surprised', '天哪': 'surprised', '不可思议': 'surprised',

    // Thinking
    'think': 'thinking', 'consider': 'thinking', 'perhaps': 'thinking', 'maybe': 'thinking',
    'hmm': 'thinking', 'interesting': 'thinking', 'wonder': 'thinking', 'analyze': 'thinking',
    '想想': 'thinking', '也许': 'thinking', '有意思': 'thinking',
};

export class EmotionAnalyzer {
    /**
     * Analyze text and return the detected emotion
     */
    analyze(text: string): EmotionResult {
        const triggers: string[] = [];
        const scores: Record<Emotion, number> = {
            neutral: 0.3,  // baseline — neutral wins when nothing else triggers
            happy: 0,
            sad: 0,
            angry: 0,
            surprised: 0,
            thinking: 0,
        };

        // 1. Check emojis
        for (const [emoji, emotion] of Object.entries(EMOJI_MAP)) {
            if (text.includes(emoji)) {
                scores[emotion] += 0.5;
                triggers.push(`emoji:${emoji}`);
            }
        }

        // 2. Check keywords
        const lowerText = text.toLowerCase();
        for (const [keyword, emotion] of Object.entries(KEYWORD_MAP)) {
            if (lowerText.includes(keyword)) {
                scores[emotion] += 0.3;
                triggers.push(`keyword:${keyword}`);
            }
        }

        // 3. Punctuation analysis
        const exclamationCount = (text.match(/!/g) || []).length;
        const questionCount = (text.match(/\?/g) || []).length;
        const capsRatio = text.replace(/[^a-zA-Z]/g, '').length > 0
            ? (text.match(/[A-Z]/g) || []).length / text.replace(/[^a-zA-Z]/g, '').length
            : 0;

        if (exclamationCount >= 2) {
            scores.surprised += 0.3;
            triggers.push('punctuation:!!');
        } else if (exclamationCount === 1) {
            scores.happy += 0.15;
            triggers.push('punctuation:!');
        }

        if (questionCount >= 1) {
            scores.thinking += 0.2;
            triggers.push('punctuation:?');
        }

        if (capsRatio > 0.6 && text.length > 5) {
            scores.angry += 0.2;
            scores.surprised += 0.15;
            triggers.push('caps:high');
        }

        // 4. Ellipsis → thinking
        if (text.includes('...') || text.includes('…')) {
            scores.thinking += 0.15;
            triggers.push('punctuation:...');
        }

        // Find the winning emotion
        let maxEmotion: Emotion = 'neutral';
        let maxScore = 0;
        for (const [emotion, score] of Object.entries(scores)) {
            if (score > maxScore) {
                maxScore = score;
                maxEmotion = emotion as Emotion;
            }
        }

        return {
            emotion: maxEmotion,
            confidence: Math.min(maxScore, 1),
            triggers,
        };
    }
}
