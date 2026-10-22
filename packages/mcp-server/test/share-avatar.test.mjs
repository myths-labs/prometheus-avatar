// share_avatar over stdio, the way an MCP client calls it. A share link must open a page that only shows the avatar:
// no text in the link is spoken when someone opens it (a sentence that rides in a link is not something the person who
// opens the link should trigger). The avatar id goes into the link as a path segment, so it must be a plain id.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFakeSite } from './fake-site.mjs';
import { listenOnFreePort } from './port.mjs';

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(PACKAGE, 'dist', 'index.js');
const AVATAR = '7d0f6f0e-2c1b-4f4e-9a55-3a1f0c9d8b21';
const SKILL_PATH = join(PACKAGE, '..', '..', 'skills', 'prometheus-companion', 'SKILL.md');

/** Start the built server against `site` (anything with url, key and close), run `body`, stop both. */
async function withSite(site, body) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'pipe',
        env: { PROMETHEUS_API_URL: site.url, PROMETHEUS_API_KEY: site.key, PROMETHEUS_MCP_STATE_DIR: 'off' } });
    const client = new Client({ name: 'share-avatar-test', version: '0' });
    try {
        await client.connect(transport);
        return await body({ client, site });
    } finally { await client.close(); await site.close(); }
}
/** The fake website (share_avatar with an avatar_id makes no request at all). */
const withServer = async body => withSite(await startFakeSite({}), body);

/** A stand-in for the two avatar calls the fake workspace site does not answer: GET /api/agent/avatar (the account's current avatar) and POST /api/agent/speak. Records every request. */
async function startAvatarStub({ avatarId }) {
    const requests = [];
    const server = http.createServer((req, res) => {
        requests.push(`${req.method} ${req.url}`);
        res.setHeader('connection', 'close');
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET' && req.url === '/api/agent/avatar') { res.end(JSON.stringify({ avatarId })); return; }
        if (req.method === 'POST' && req.url === '/api/agent/speak') {
            req.resume();
            req.on('end', () => res.end(JSON.stringify({ audio: Buffer.from('RIFF0000WAVE').toString('base64'), mimeType: 'audio/wav', voice: 'Kore' })));
            return;
        }
        res.statusCode = 404; res.end('{}');
    });
    await listenOnFreePort(server);
    return { url: `http://127.0.0.1:${server.address().port}`, key: 'stub-agent-key', requests,
        close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
const withStub = async (avatarId, body) => withSite(await startAvatarStub({ avatarId }), body);
const share = async (client, args) => {
    const result = await client.callTool({ name: 'share_avatar', arguments: args });
    assert.ok(!result.isError, `share_avatar must not fail: ${result.content?.[0]?.text}`);
    return JSON.parse(result.content[0].text);
};

/** Every reading of a string a browser, an HTML parser or a server could arrive at: percent-decoded to a fixed point, HTML character references decoded, lower-cased. */
function readings(text) {
    const out = new Set();
    let current = String(text);
    for (let round = 0; round < 6; round++) {
        out.add(current.toLowerCase());
        const html = current
            .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
            .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
            .replace(/&amp;/gi, '&');
        out.add(html.toLowerCase());
        let decoded = html;
        try { decoded = decodeURIComponent(html.replace(/\+/g, ' ')); } catch { /* not valid percent-encoding: keep as is */ }
        if (decoded === current) break;
        current = decoded;
    }
    return [...out];
}
const SPEAK = /s\s*p\s*e\s*a\s*k/i;
function assertNoSpeak(label, text) {
    for (const reading of readings(text)) assert.doesNotMatch(reading, SPEAK, `${label} must not carry "speak" in any encoding: ${reading.slice(0, 120)}`);
}
const queryNames = url => [...new URL(url).searchParams.keys()];
// The query that asks an embed page to speak, built from pieces: this file must not spell it out (the repository keeps no
// text that spells it, and the pattern below is how the tests tell a document that does).
const SPEAK_NAME = ['spe', 'ak'].join('');
const SPEAK_QUERY = new RegExp(`[?&]${SPEAK_NAME}=`, 'i');
const speakQuery = value => ['?', SPEAK_NAME, '=', value].join('');

test('share links carry no speak parameter, even when an older caller still passes a message', async () => {
    await withServer(async ({ client, site }) => {
        const message = 'Hello from the sharer, please read this out';
        for (const args of [{ avatar_id: AVATAR }, { avatar_id: AVATAR, message }, { avatar_id: AVATAR, message, referral_code: 'friend-42' }]) {
            const json = await share(client, args);
            assert.equal(json.success, true);
            assert.equal(json.avatar_id, AVATAR);
            for (const field of ['share_url', 'embed_url', 'embed_html']) assertNoSpeak(`${field} for ${JSON.stringify(Object.keys(args))}`, json[field]);
            // the sentence itself must not ride in the link in any form either
            for (const field of ['share_url', 'embed_url', 'embed_html'])
                for (const reading of readings(json[field])) assert.ok(!reading.includes('hello from the sharer'), `${field} must not carry the message`);
            assert.ok(json.share_url.startsWith(`${site.url}/embed/${AVATAR}`), 'the link still opens the embed page of this avatar');
            assert.equal(json.embed_url, json.share_url);
            assert.ok(json.embed_html.includes(`src="${json.share_url}"`), 'the iframe points at the same link');
        }
    });
});

test('the only query parameter a share link can carry is ref (the referral code), and it is passed through as before', async () => {
    await withServer(async ({ client }) => {
        const plain = await share(client, { avatar_id: AVATAR });
        assert.equal(new URL(plain.share_url).search, '', 'no referral code: no query string at all');
        const referred = await share(client, { avatar_id: AVATAR, referral_code: 'friend 42&x=y' });
        assert.deepEqual(queryNames(referred.share_url), ['ref']);
        assert.equal(new URL(referred.share_url).searchParams.get('ref'), 'friend 42&x=y', 'the code arrives intact, encoded as one value');
        assert.deepEqual(queryNames(referred.embed_url), ['ref']);
        assert.match(referred.embed_html, /src="[^"]+\?ref=/);
    });
});

test('the result no longer says opening the link makes the avatar talk, and does not offer a message to deliver', async () => {
    await withServer(async ({ client }) => {
        const withMessage = await share(client, { avatar_id: AVATAR, message: 'Hi there' });
        const without = await share(client, { avatar_id: AVATAR });
        for (const json of [withMessage, without]) {
            assert.doesNotMatch(json.instructions, /auto-speak|autospeak|speaks? (your|the|a) message|reads? (it|your message) (out|aloud)|talks? when/i, json.instructions);
            assert.doesNotMatch(json.instructions, /Hi there/);
            assert.match(json.instructions, /share_url/, 'still tells the model what to hand over');
        }
        assert.equal(withMessage.instructions, without.instructions, 'an old caller that passes a message gets the same answer as one that does not');
        const { tools } = await client.listTools();
        const tool = tools.find(t => t.name === 'share_avatar');
        assert.ok(tool, 'share_avatar is still registered');
        assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['avatar_id', 'referral_code'], 'the message parameter is gone from the tool schema');
        assert.doesNotMatch(tool.description, /speak|message|talk/i, tool.description);
    });
});

test('what the package and the companion skill publish do not describe a link that speaks when it is opened', () => {
    const files = { 'README.md': join(PACKAGE, 'README.md'), 'src/index.ts': join(PACKAGE, 'src', 'index.ts'),
        'skills/prometheus-companion/SKILL.md': join(PACKAGE, '..', '..', 'skills', 'prometheus-companion', 'SKILL.md') };
    for (const [name, path] of Object.entries(files)) {
        const text = readFileSync(path, 'utf8');
        // assert.ok, not doesNotMatch: a failure of doesNotMatch prints the whole file
        assert.ok(!SPEAK_QUERY.test(text), `${name}: no link that asks the page to speak`);
        assert.ok(!/greet on load|auto-speaks? (your|the) message|autospeaks? (your|the) message|speaks? (your|the) message on open/i.test(text), `${name}: no greeting on load`);
        assert.ok(!/qp\.set\(\s*["']speak["']/.test(text), `${name}: the share link is not built with a speak parameter`);
    }
});

// ── When a page may make the avatar speak ──────────────────────────────────────────────────────────────────────────
// The embed holds an emotion or a state until it is listening, but it does not keep a speak message: one posted before the
// embed has posted prometheus:loaded is lost or shows an error. So every sentence that tells a page to post
// prometheus:speak must also say "after ... prometheus:loaded".
const AFTER_LOADED = /\bafter\b[^.]*prometheus:loaded/;
function assertSpeakWaitsForLoaded(label, block) {
    const sentences = String(block).replace(/\s+/g, ' ').split(/(?<=\.)\s+(?=[A-Z`{(*])/).filter(sentence => sentence.includes('prometheus:speak'));
    assert.ok(sentences.length > 0, `${label}: says how a page makes the avatar speak`);
    for (const sentence of sentences) assert.match(sentence, AFTER_LOADED, `${label}: speak is only safe after prometheus:loaded: ${sentence.slice(0, 180)}`);
}

test('share_avatar tells the embedding page to post speak only after the iframe has posted prometheus:loaded', async () => {
    await withServer(async ({ client }) => {
        const json = await share(client, { avatar_id: AVATAR });
        assertSpeakWaitsForLoaded('share_avatar instructions', json.instructions);
        assert.match(json.instructions, /Opening the link only shows the avatar; it does not speak by itself\./);
    });
});

test('the speak tool tells the embedding page the same: post speak only after prometheus:loaded', async () => {
    await withStub(AVATAR, async ({ client, site }) => {
        const result = await client.callTool({ name: 'speak', arguments: { text: 'Tests passed!' } });
        assert.ok(!result.isError, result.content?.[0]?.text);
        const json = JSON.parse(result.content[0].text);
        assert.equal(json.success, true);
        assertSpeakWaitsForLoaded('speak instructions', json.instructions);
        assert.ok(site.requests.includes('POST /api/agent/speak'), 'the audio was asked for');
    });
});

test('the companion skill: speak is posted after prometheus:loaded, and the speak call answers audio to the caller only', () => {
    const lines = readFileSync(SKILL_PATH, 'utf8').split('\n');
    const speakLines = lines.filter(line => line.includes('prometheus:speak'));
    assert.ok(speakLines.length >= 2, 'the Show it row and the Speak row both name the message');
    for (const line of speakLines) assertSpeakWaitsForLoaded('SKILL.md', line);
    const row = lines.find(line => line.startsWith('| Speak |'));
    assert.ok(row, 'the Speak row exists');
    assert.doesNotMatch(row, /lip-?sync/i, 'the call does not make an embed lip-sync');
    assert.match(row, /Returns audio to the caller; it does not make an open embed speak/);
    assert.ok(lines.find(line => line.startsWith('| Show it |')).includes('does not speak by itself'), 'opening the link does not speak');
});

// ── The avatar id goes into the link as a path segment and into an HTML attribute ───────────────────────────────────
const BAD_IDS = [
    ['a speak query', 'abc' + speakQuery('Hello')],
    ['a fragment', 'abc#x'],
    ['an attribute escape', 'abc" onload="x'],
    ['a slash', 'a/b'],
    ['a parent path', '../x'],
    ['an empty string', ''],
    ['65 characters', 'a'.repeat(65)],
    ['a space', 'a b'],
    ['a second parameter', 'abc&ref=evil'],
    ['a percent escape', 'abc%2Fx'],
    ['a trailing newline', 'abc\n'],
    ['a non-ASCII look-alike', 'abcа'],
    ['a backslash', 'a\\b'],
    ['an angle bracket', 'abc<x>'],
];
const GOOD_IDS = [AVATAR, 'abc_DEF-123', 'a', '0', 'a'.repeat(64)];
const shareRaw = (client, args) => client.callTool({ name: 'share_avatar', arguments: args });
function assertRefused(label, result, bad) {
    assert.equal(result.isError, true, `${label}: refused`);
    const text = result.content[0].text;
    assert.match(text, /avatar_id/, `${label}: the message names the argument`);
    assert.match(text, /64/, `${label}: the message says the length limit`);
    assert.doesNotMatch(text, /\/embed\/|<iframe|share_url|embed_html|success/, `${label}: no link in the answer`);
    if (bad.length > 3) assert.ok(!text.includes(bad), `${label}: the value is not echoed back`);
}

test('share_avatar refuses an avatar_id that is not a plain id (1-64 letters, digits, "_" or "-"), gives no link, and makes no request', async () => {
    await withStub(AVATAR, async ({ client, site }) => {
        for (const [what, bad] of BAD_IDS) assertRefused(what, await shareRaw(client, { avatar_id: bad, referral_code: 'friend' }), bad);
        assert.deepEqual(site.requests, [], 'a refused id never reaches the website');
        const { tools } = await client.listTools();
        assert.match(tools.find(t => t.name === 'share_avatar').inputSchema.properties.avatar_id.description, /letters, digits/);
    });
});

test('share_avatar accepts a UUID and the other plain ids, and builds the link from exactly that id', async () => {
    await withServer(async ({ client, site }) => {
        for (const id of GOOD_IDS) {
            const json = await share(client, { avatar_id: id });
            assert.equal(json.avatar_id, id);
            assert.equal(json.share_url, `${site.url}/embed/${id}`);
            assert.ok(json.embed_html.includes(`src="${json.share_url}"`));
        }
    });
});

test('an avatar id the website returns for the account is held to the same rule, and nothing is looked up for an empty avatar_id', async () => {
    await withStub(AVATAR, async ({ client, site }) => {
        const json = await share(client, {});
        assert.equal(json.avatar_id, AVATAR);
        assert.equal(json.share_url, `${site.url}/embed/${AVATAR}`);
        assert.deepEqual(site.requests, ['GET /api/agent/avatar']);
    });
    for (const [what, bad] of [BAD_IDS[0], BAD_IDS[2], BAD_IDS[3]]) {
        await withStub(bad, async ({ client, site }) => {
            assertRefused(`${what} from the website`, await shareRaw(client, {}), bad);
            assert.deepEqual(site.requests, ['GET /api/agent/avatar']);
        });
    }
    // an account with no avatar yet: the website answers without an id (or with a null one) and no link is made
    for (const none of [undefined, null]) {
        await withStub(none, async ({ client }) => {
            const result = await shareRaw(client, {});
            assert.equal(result.isError, true);
            assert.match(result.content[0].text, /no avatar found/);
            assert.doesNotMatch(result.content[0].text, /\/embed\/|<iframe/);
        });
    }
});

// ── The changelog entry ────────────────────────────────────────────────────────────────────────────────────────────
test('the changelog describes these share links inside the one [Unreleased] section: speak only after prometheus:loaded, no claim about the website, no absolute wording', () => {
    const changelog = readFileSync(join(PACKAGE, '..', '..', 'CHANGELOG.md'), 'utf8');
    const unreleasedHeadings = changelog.split('\n').filter(line => /^## \[Unreleased\]/i.test(line));
    assert.equal(unreleasedHeadings.length, 1, `one [Unreleased] section: ${unreleasedHeadings.join(' | ')}`);
    const start = changelog.indexOf('\n## [Unreleased]');
    const section = changelog.slice(start, changelog.indexOf('\n---', start + 1));
    const bullets = section.split(/\n(?=- )/);
    const shareEntry = bullets.find(bullet => /share links no longer carry a message/.test(bullet));
    const idEntry = bullets.find(bullet => /refuses an `avatar_id`/.test(bullet));
    assert.ok(shareEntry, 'the share link entry is in the [Unreleased] section');
    assert.ok(idEntry, 'the avatar id entry is in the [Unreleased] section');
    assertSpeakWaitsForLoaded('CHANGELOG share link entry', shareEntry);
    for (const [name, entry] of [['share link entry', shareEntry], ['avatar id entry', idEntry]]) {
        assert.ok(!SPEAK_QUERY.test(entry), `${name}: does not spell out the link that asks the page to speak`);
        assert.ok(!/\bwebsite\b|embed page|does not read|ignores it/i.test(entry), `${name}: does not describe what the website does today`);
        assert.ok(!/\bnever\b|\balways\b/i.test(entry), `${name}: no absolute wording`);
    }
});
