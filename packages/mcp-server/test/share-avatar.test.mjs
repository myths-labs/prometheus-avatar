// share_avatar over stdio, the way an MCP client calls it. A share link must open a page that only shows the avatar:
// no text in the link is spoken when someone opens it (the page does not read `?speak=` any more, and a sentence
// that rides in a link should not be something the person who opens the link triggers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFakeSite } from './fake-site.mjs';

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(PACKAGE, 'dist', 'index.js');
const AVATAR = '7d0f6f0e-2c1b-4f4e-9a55-3a1f0c9d8b21';

/** Start the built server against the fake site (share_avatar with an avatar_id makes no request at all), run `body`, stop both. */
async function withServer(body) {
    const site = await startFakeSite({});
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'pipe',
        env: { PROMETHEUS_API_URL: site.url, PROMETHEUS_API_KEY: site.key, PROMETHEUS_MCP_STATE_DIR: 'off' } });
    const client = new Client({ name: 'share-avatar-test', version: '0' });
    try {
        await client.connect(transport);
        return await body({ client, site });
    } finally { await client.close(); await site.close(); }
}
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
            assert.doesNotMatch(json.instructions, /auto-?speak|speaks? (your|the|a) message|reads? (it|your message) (out|aloud)|talks? when/i, json.instructions);
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
        assert.ok(!/[?&]speak=/i.test(text), `${name}: no ?speak= link`);
        assert.ok(!/greet on load|auto-?speaks? (your|the) message|speaks? (your|the) message on open/i.test(text), `${name}: no greeting on load`);
        assert.ok(!/qp\.set\(\s*["']speak["']/.test(text), `${name}: the share link is not built with a speak parameter`);
    }
});
