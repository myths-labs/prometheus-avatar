import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');
const srcDir = resolve(pkgDir, 'src');
const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));

/** Bare specifiers (and relative files) imported or re-exported by a source file. */
function importsOf(file: string): { relative: string[]; bare: string[] } {
    // Type-only imports vanish at build time, so they never reach a bundler.
    const text = readFileSync(file, 'utf8').replace(/^\s*(?:import|export)\s+type\b[\s\S]*?from\s*['"][^'"]+['"];?/gm, '');
    const specs = [...text.matchAll(/(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g)]
        .map((m) => m[1] ?? m[2] ?? m[3]);
    return {
        relative: specs.filter((s) => s.startsWith('.')),
        bare: specs.filter((s) => !s.startsWith('.')),
    };
}

/** Every bare specifier reachable from an entry file, following relative imports. */
function reachableBareImports(entry: string): Set<string> {
    const seen = new Set<string>();
    const bare = new Set<string>();
    const walk = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        const { relative, bare: b } = importsOf(file);
        b.forEach((s) => bare.add(s));
        relative.forEach((r) => walk(resolve(dirname(file), r.endsWith('.ts') ? r : `${r}.ts`)));
    };
    walk(entry);
    return bare;
}

const NODE_ONLY = /^(node:.*|fs|path|events|net|http|https|os|crypto|stream|child_process|ws)$/;

describe('browser-safe entry', () => {
    it('src/index.ts reaches no Node built-in and no `ws`', () => {
        const nodeOnly = [...reachableBareImports(resolve(srcDir, 'index.ts'))].filter((s) => NODE_ONLY.test(s));
        expect(nodeOnly).toEqual([]);
    });

    it('src/node.ts is where MemoryBridge keeps its Node imports', () => {
        const bare = reachableBareImports(resolve(srcDir, 'node.ts'));
        expect([...bare].filter((s) => NODE_ONLY.test(s)).sort()).toEqual(['events', 'fs', 'path', 'ws']);
    });

    it('src/index.node.ts keeps the 0.11.0-0.11.4 surface (browser entry + MemoryBridge)', () => {
        const text = readFileSync(resolve(srcDir, 'index.node.ts'), 'utf8');
        expect(text).toMatch(/export \* from '\.\/index'/);
        expect(text).toMatch(/export \* from '\.\/node'/);
    });
});

describe('package.json exports', () => {
    it('puts "types" before "default" in every branch and exports ./package.json', () => {
        const exp = pkg.exports as Record<string, Record<string, unknown>>;
        expect(Object.keys(exp)).toEqual(['.', './node', './package.json']);
        const branches = [exp['.'].node, exp['.'], exp['./node']] as Record<string, unknown>[];
        for (const b of branches) {
            const keys = Object.keys(b);
            expect(keys.indexOf('types')).toBeGreaterThanOrEqual(0);
            expect(keys.indexOf('types')).toBeLessThan(keys.indexOf('default'));
        }
        expect(exp['./package.json']).toBe('./package.json');
    });

    it('builds every file that exports points at', () => {
        const script: string = pkg.scripts.build;
        for (const entry of ['src/index.ts', 'src/node.ts', 'src/index.node.ts']) {
            expect(script).toContain(entry);
            expect(existsSync(resolve(pkgDir, entry))).toBe(true);
        }
        const targets = JSON.stringify(pkg.exports).match(/\.\/dist\/[\w.-]+\.(?:js|d\.ts)/g) ?? [];
        expect(new Set(targets)).toEqual(new Set([
            './dist/index.node.d.ts', './dist/index.node.js', './dist/index.d.ts', './dist/index.js',
            './dist/node.d.ts', './dist/node.js',
        ]));
    });
});

describe('licence files travel with the package', () => {
    it('lists LICENSE and THIRD_PARTY_LICENSES.md in "files"', () => {
        expect(pkg.files).toEqual(expect.arrayContaining(['dist', 'README.md', 'LICENSE', 'THIRD_PARTY_LICENSES.md']));
    });

    it('keeps the packaged copies identical to the repository root files', () => {
        for (const name of ['LICENSE', 'THIRD_PARTY_LICENSES.md']) {
            const root = readFileSync(resolve(pkgDir, '..', '..', name), 'utf8');
            const copy = readFileSync(resolve(pkgDir, name), 'utf8');
            expect(copy, `${name} in packages/sdk drifted from the root copy`).toBe(root);
        }
    });
});
