import assert from "node:assert/strict";
import { test } from "node:test";
import { speechResult } from "../.test-build/speech-result.js";
import { digest, floatWavFixture, wavFixture } from "./fixtures.mjs";

const response = (wav = wavFixture(), extra = {}) => ({ audio: wav.toString("base64"), mimeType: "audio/wav", ...extra });
const convert = (wav) => speechResult(response(wav), "Test speech");
const rewrite = (fn) => { const wav = wavFixture(); fn(wav); return wav; };
const resized = (wav) => { wav.writeUInt32LE(wav.length - 8, 4); return wav; };
const chunk = (kind, data, padding = true) => {
  const result = Buffer.alloc(8 + data.length + (padding ? data.length % 2 : 0));
  result.write(kind); result.writeUInt32LE(data.length, 4); data.copy(result, 8);
  return result;
};

for (const frames of [8, 9, 10]) {
  test(`audio bytes and metadata survive base64 padding (${frames} frames)`, () => {
    const wav = wavFixture(frames);
    const result = speechResult(response(wav, { voice: "Puck" }), "Test speech");
    const audio = result.content.find((x) => x.type === "audio");
    const info = JSON.parse(result.content.find((x) => x.type === "text").text);
    assert.equal(digest(Buffer.from(audio.data, "base64")), digest(wav));
    assert.equal(info.audio_bytes, wav.length);
    assert.equal(info.voice, "Puck");
    assert.equal(info.status, "audio_generated");
    assert.equal(info.playback_confirmed, false);
    assert.equal(info.emotion_control, "unsupported");
  });
}

test("WAV metadata chunks with odd padding preserve all original bytes", () => {
  const source = wavFixture();
  const wav = resized(Buffer.concat([source.subarray(0, 12), chunk("JUNK", Buffer.from([1, 2, 3])), source.subarray(12)]));
  const out = convert(wav).content.find((x) => x.type === "audio");
  assert.equal(digest(Buffer.from(out.data, "base64")), digest(wav));
});

test("recognizes a valid WAV without inventing an unknown voice", () => {
  const result = speechResult({ audio: wavFixture().toString("base64") }, "Test");
  assert.equal(result.content.find((x) => x.type === "audio").mimeType, "audio/wav");
  assert.equal(JSON.parse(result.content[0].text).voice, null);
});

test("accepts IEEE float WAV used by retained local speech fixtures", () => {
  const wav = wavFixture(10);
  wav.writeUInt16LE(3, 20); wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(32, 34); wav.writeUInt32LE(96000, 28);
  assert.ok(convert(wav).content.some((x) => x.type === "audio"));
});

for (const bits of [32, 64]) {
  test(`preserves finite ${bits}-bit float samples exactly`, () => {
    const wav = floatWavFixture([0, .25, -.25], bits);
    const audio = convert(wav).content.find(x => x.type === "audio");
    assert.equal(digest(Buffer.from(audio.data, "base64")), digest(wav));
  });
  for (const [name, sample] of [["NaN", NaN], ["positive infinity", Infinity], ["negative infinity", -Infinity]]) {
    test(`rejects ${name} in ${bits}-bit float audio`, () => {
      assert.throws(() => convert(floatWavFixture([.25, sample, -.25], bits)), /non-finite/i);
    });
  }
}

test("does not combine incomplete frames from separate data chunks", () => {
  const source = wavFixture();
  const wav = resized(Buffer.concat([source.subarray(0, 36), chunk("data", Buffer.from([1])), chunk("data", Buffer.from([2]))]));
  assert.throws(() => convert(wav), /partial audio frame/i);
});

for (const [name, invalid] of [
  ["null response", null], ["nonobject response", "audio"], ["array response", []],
  ["missing audio", {}], ["nonstrings", { audio: 42 }], ["empty string", { audio: "" }],
  ["invalid base64 alphabet", { audio: "not!base64" }], ["base64 containing no bytes", { audio: "====" }],
  ["wrong padding", { audio: wavFixture().toString("base64") + "=" }],
  ["mismatched MIME", response(wavFixture(), { mimeType: "text/html" })],
]) {
  test(`rejects ${name}`, () => assert.throws(() => speechResult(invalid, "Test")));
}

const valid = wavFixture();
for (const [name, wav] of [
  ["short header", valid.subarray(0, 6)],
  ["wrong RIFF magic", rewrite((b) => b.write("RIFX", 0))],
  ["non-ASCII RIFF magic", rewrite((b) => { b[1] |= 128; })],
  ["wrong WAVE magic", rewrite((b) => b.write("MP3!", 8))],
  ["inconsistent file length", rewrite((b) => b.writeUInt32LE(1, 4))],
  ["short chunk header", resized(Buffer.concat([valid, Buffer.from([0])]))],
  ["oversized chunk", rewrite((b) => b.writeUInt32LE(0xffffffff, 40))],
  ["short format chunk", rewrite((b) => b.writeUInt32LE(2, 16))],
  ["duplicate format", resized(Buffer.concat([valid, valid.subarray(12, 36)]))],
  ["unsupported sample format", rewrite((b) => b.writeUInt16LE(999, 20))],
  ["invalid channel count", rewrite((b) => b.writeUInt16LE(0, 22))],
  ["invalid sample rate", rewrite((b) => b.writeUInt32LE(0, 24))],
  ["invalid byte rate", rewrite((b) => b.writeUInt32LE(1, 28))],
  ["invalid block alignment", rewrite((b) => b.writeUInt16LE(3, 32))],
  ["zero block alignment", rewrite((b) => b.writeUInt16LE(0, 32))],
  ["unsupported sample width", rewrite((b) => b.writeUInt16LE(12, 34))],
  ["missing audio data", rewrite((b) => b.write("JUNK", 36))],
  ["non-ASCII data chunk", rewrite((b) => { b[36] |= 128; })],
  ["missing format", rewrite((b) => b.write("JUNK", 12))],
  ["empty data frames", wavFixture(0)],
  ["partial sample frame", rewrite((b) => b.writeUInt32LE(17, 40))],
]) {
  test(`rejects WAV with ${name}`, () => assert.throws(() => convert(wav)));
}
