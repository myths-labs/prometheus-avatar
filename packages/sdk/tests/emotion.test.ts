import { describe, it, expect } from 'vitest';
import { EmotionAnalyzer } from '../src/emotion';

describe('EmotionAnalyzer', () => {
    const analyzer = new EmotionAnalyzer();

    it('detects happy emotion from positive text', () => {
        const result = analyzer.analyze('I am so happy! 😊');
        expect(result.emotion).toBe('happy');
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.triggers.length).toBeGreaterThan(0);
    });

    it('detects sad emotion', () => {
        const result = analyzer.analyze('I feel really sad and heartbroken...');
        expect(result.emotion).toBe('sad');
    });

    it('detects angry emotion', () => {
        const result = analyzer.analyze('This makes me so angry! I hate this!');
        expect(result.emotion).toBe('angry');
    });

    it('detects surprised emotion', () => {
        const result = analyzer.analyze('Oh wow! I can\'t believe it! 😱');
        expect(result.emotion).toBe('surprised');
    });

    it('returns neutral for plain text', () => {
        const result = analyzer.analyze('The weather is fine today.');
        expect(result.emotion).toBe('neutral');
    });

    it('has correct EmotionResult shape', () => {
        const result = analyzer.analyze('Hello');
        expect(result).toHaveProperty('emotion');
        expect(result).toHaveProperty('confidence');
        expect(result).toHaveProperty('triggers');
        expect(typeof result.confidence).toBe('number');
        expect(Array.isArray(result.triggers)).toBe(true);
    });

    it('confidence is between 0 and 1', () => {
        const result = analyzer.analyze('Very happy!! 🎉🎊😊');
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
    });
});
