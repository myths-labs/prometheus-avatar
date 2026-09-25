import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { speechResult } from '../.test-build/speech-result.js';

const read = name => readFileSync(new URL(`./audio/${name}.mp3`, import.meta.url));
const source = read('mpeg2');
const convert = audio => speechResult({ audio: audio.toString('base64'), mimeType: 'audio/mpeg' }, 'Test tone');
const changed = (bytes, position, value) => { const copy = Buffer.from(bytes); copy[position] = value; return copy; };

for (const version of ['mpeg1', 'mpeg2', 'mpeg25']) {
    test(`preserves locally encoded ${version} tone as MP3 content`, () => {
        const bytes = read(version), result = convert(bytes);
        const audio = result.content.find(item => item.type === 'audio');
        assert.equal(audio.mimeType, 'audio/mpeg');
        assert.deepEqual(Buffer.from(audio.data, 'base64'), bytes);
        const info = JSON.parse(result.content[0].text);
        assert.equal(info.audio_format, 'audio/mpeg');
        assert.equal(info.audio_bytes, bytes.length);
        assert.equal(info.playback_confirmed, false);
    });
}

function tag(version = 4, footer = false) {
    const title = Buffer.from([0, 84, 111, 110, 101]);
    const frame = Buffer.concat([Buffer.from('TIT2'), Buffer.from([0, 0, 0, title.length, 0, 0]), title]);
    const header = Buffer.from([73, 68, 51, version, 0, footer ? 16 : 0, 0, 0, 0, frame.length]);
    return Buffer.concat([header, frame, ...(footer ? [Buffer.concat([Buffer.from('3DI'), header.subarray(3)])] : [])]);
}

for (const [name, metadata] of [['v2.3', tag(3)], ['v2.4', tag()], ['v2.4 footer', tag(4, true)]]) {
    test(`preserves ID3 ${name} and complete original audio frames`, () => {
        const bytes = Buffer.concat([metadata, source]);
        const audio = convert(bytes).content.find(item => item.type === 'audio');
        assert.deepEqual(Buffer.from(audio.data, 'base64'), bytes);
    });
}

test('preserves a terminal ID3v1 tag', () => {
    const bytes = Buffer.concat([source, Buffer.from('TAG'), Buffer.alloc(125)]);
    const audio = convert(bytes).content.find(item => item.type === 'audio');
    assert.deepEqual(Buffer.from(audio.data, 'base64'), bytes);
});

for (const [name, bytes] of [
    ['non-audio payload', Buffer.from('not an MPEG stream')],
    ['incomplete frame header', source.subarray(0, 3)],
    ['incomplete final frame', source.subarray(0, -1)],
    ['invalid frame sync', changed(source, 0, 0)],
    ['reserved MPEG version', changed(source, 1, (source[1] & 0xe7) | 0x08)],
    ['non-MP3 layer', changed(source, 1, (source[1] & 0xf9) | 0x04)],
    ['free-format bitrate', changed(source, 2, source[2] & 0x0f)],
    ['reserved bitrate', changed(source, 2, source[2] | 0xf0)],
    ['reserved sample rate', changed(source, 2, source[2] | 0x0c)],
    ['changed channel count', changed(source, 192 + 3, source[192 + 3] & 0x3f)],
    ['changed sample rate', changed(source, 192 + 2, source[192 + 2] & 0xf3)],
    ['trailing garbage', Buffer.concat([source, Buffer.from([0])])],
    ['ID3 without audio', tag()],
    ['truncated ID3 header', Buffer.from('ID3')],
    ['reserved ID3 version', Buffer.concat([changed(tag(), 3, 5), source])],
    ['invalid ID3 revision', Buffer.concat([changed(tag(), 4, 255), source])],
    ['reserved ID3 flags', Buffer.concat([changed(tag(), 5, 1), source])],
    ['invalid synchsafe tag size', Buffer.concat([changed(tag(), 6, 128), source])],
    ['oversized ID3 tag', Buffer.concat([changed(tag(), 8, 127), source])],
    ['missing ID3 footer', Buffer.concat([changed(tag(), 5, 16), source])],
    ['mismatched ID3 footer', Buffer.concat([changed(tag(4, true), 28, 3), source])],
]) {
    test(`rejects ${name} instead of returning MP3`, () => assert.throws(() => convert(bytes)));
}
