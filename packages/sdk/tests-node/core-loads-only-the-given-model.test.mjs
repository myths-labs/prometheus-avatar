// Core ships no model and chooses none. The two files that load a model pass the caller's modelUrl
// through bare: no `||` / `??` / ternary fallback, no model or CDN literal. The behaviour is pinned in
// tests/no-default-model.test.ts (vitest); this scan keeps the source shape honest in the plain-node CI step too.
// Run: node --experimental-strip-types --test packages/sdk/tests-node/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function code(file) {
    return readFileSync(join(src, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/^\s*\/\/.*$/, ''))
        .join('\n');
}

// What may be passed to a model-loading call: the caller's value, nothing derived from it.
const BARE_ARGUMENT = /^(?:this\.config\.)?modelUrl(?:: string)?$/;
const LOAD_CALL = /\b(?:L2DModel\.from|loadModel)\(([^()]*)\)/g;
const LITERAL = /\.model3?\.json|\.moc3?\b|\/models\/|jsdelivr|unpkg|\bcdn\b|https?:\/\//i;

function problems(text) {
    const found = [];
    for (const match of text.matchAll(LOAD_CALL)) {
        if (!BARE_ARGUMENT.test(match[1].trim())) found.push(`call argument is not the bare modelUrl: ${match[0]}`);
    }
    text.split('\n').forEach((line, index) => {
        if (LITERAL.test(line)) found.push(`line ${index + 1} carries a model or CDN literal: ${line.trim().slice(0, 100)}`);
    });
    return found;
}

test('avatar.ts and renderer.ts pass the caller\'s modelUrl to the loader unchanged and carry no model or CDN literal', () => {
    for (const file of ['avatar.ts', 'renderer.ts']) assert.deepEqual(problems(code(file)), [], file);
});

test('the loading calls are still where the scan looks for them (so it cannot pass by finding nothing)', () => {
    assert.match(code('avatar.ts'), /this\.renderer\.loadModel\(this\.config\.modelUrl\)/);
    assert.match(code('avatar.ts'), /this\.renderer\.loadModel\(modelUrl\)/);
    assert.match(code('renderer.ts'), /L2DModel\.from\(modelUrl\)/);
});

test('the scan catches a default model written into the loader (reverse check)', () => {
    for (const bad of [
        "await this.renderer.loadModel(this.config.modelUrl || '/models/haru/haru.model3.json');",
        "this.model = await L2DModel.from(modelUrl || '/models/sample/sample.model3.json');",
        "this.model = await L2DModel.from(modelUrl ?? DEFAULT_MODEL);",
        "await this.renderer.loadModel(modelUrl ? modelUrl : fallback);",
        "const DEFAULT = 'https://cdn.jsdelivr.net/gh/x/y/m.model3.json';",
    ]) {
        assert.notDeepEqual(problems(bad), [], bad);
    }
    assert.deepEqual(problems('await this.renderer.loadModel(this.config.modelUrl);\nasync loadModel(modelUrl: string): Promise<void> {'), []);
});
