// Everything under packages/ goes to npm and GitHub, where any developer's code can read it. The SDK, the MCP server and the
// plugin ship no third-party motion clips, and nothing here may name where the platform keeps its own motion files: the hosted
// player plays motions inside its own page, and a host page reaches that page only through the embed bridge (emotion, state, speech).
// This scan fails on a motion or 3D scene file of any kind, and on the names a library clip or its storage go by, in any file,
// binary included, built output included (CI builds the SDK before this step).
// Run: node --test packages/sdk/tests-node/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const PACKAGES = join(dirname(HERE), '..', '..');

const MOTION_FILE = /\.(?:glb|gltf|fbx|bvh|vrm|vrma|dae|blend)$/i;
const NAMES = [
    /mixamo/i,                                             // the library, and the bone names (mixamorig:Hips) of a clip stored under any extension
    /motion-library/i,                                     // the platform's motion folders
    /humanoid_(?:greeting|tap|dance|intro|idle)_\d{3}/,    // a library clip's id
    /base-motions/,                                        // the player's own route for its signed clip addresses
];
// creator.ts tells a seller why such a clip cannot be listed; that sentence, and its copies in the generated docs and types, is the
// one place the name may stand. Any other occurrence still fails.
const ALLOWED_SENTENCE = 'A library clip (Mixamo or similar) or an unsure source cannot be listed:';

function scan(root, { skip = () => false } = {}) {
    const hits = [];
    let files = 0;
    const walk = (at) => {
        for (const entry of readdirSync(at, { withFileTypes: true })) {
            const full = join(at, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules') walk(full);
                continue;
            }
            if (!entry.isFile() || skip(full)) continue;
            files += 1;
            const where = relative(root, full).split(sep).join('/');
            if (MOTION_FILE.test(entry.name)) hits.push(`${where}: motion or 3D scene file`);
            const text = readFileSync(full, 'latin1').split(ALLOWED_SENTENCE).join('');
            for (const name of NAMES) {
                const found = name.exec(text);
                if (found) hits.push(`${where}: names ${found[0]}`);
            }
        }
    };
    walk(root);
    return { hits, files };
}

test('nothing under packages/ is a motion file or names a library clip or its storage', () => {
    const { hits, files } = scan(PACKAGES, { skip: (file) => file === HERE });
    assert.ok(files > 100, `the scan must read the packages (read ${files} files)`);
    assert.deepEqual(hits, []);
});

test('the scan catches each kind of file, in any folder, whatever its extension says', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-motion-files-'));
    try {
        mkdirSync(join(dir, 'mcp-server', 'assets'), { recursive: true });
        const plant = (name, bytes) => { writeFileSync(join(dir, 'mcp-server', 'assets', name), bytes); };
        assert.deepEqual(scan(dir).hits, [], 'an empty folder has no hit');
        plant('clean.txt', ALLOWED_SENTENCE);
        assert.deepEqual(scan(dir).hits, [], 'the one allowed sentence passes');

        const cases = [
            ['clip.glb', Buffer.from([0x67, 0x6c, 0x54, 0x46])],
            ['clip.FBX', 'Kaydara FBX Binary'],
            ['clip.bvh', 'HIERARCHY'],
            ['body.vrm', 'glTF'],
            ['renamed.bin', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('mixamorig:Hips')])],
            ['note.md', 'Mixamo clips are here'],
            ['second.txt', `${ALLOWED_SENTENCE} but Mixamo again`],
            ['paths.js', 'const u = "marketplace/motion-library/humanoid/x.glb";'],
            ['ids.json', '{"motion_id":"humanoid_tap_005"}'],
            ['client.ts', 'fetch("/api/avatar/base-motions")'],
        ];
        for (const [name, bytes] of cases) {
            plant(name, bytes);
            assert.equal(scan(dir).hits.length > 0, true, `${name} must fail the scan`);
            rmSync(join(dir, 'mcp-server', 'assets', name));
        }
        assert.deepEqual(scan(dir).hits, [], 'clean again');

        mkdirSync(join(dir, 'sdk', 'node_modules', 'dep'), { recursive: true });
        writeFileSync(join(dir, 'sdk', 'node_modules', 'dep', 'clip.glb'), 'glTF');
        assert.deepEqual(scan(dir).hits, [], 'a dependency folder is not ours');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
