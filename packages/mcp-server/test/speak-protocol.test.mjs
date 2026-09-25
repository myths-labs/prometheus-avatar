import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { digest, floatWavFixture, wavFixture } from "./fixtures.mjs";

let client, api, baseUrl;
const requests = [];
let reply = {};
const spokenText = process.env.MCP_SPEECH_FIXTURE_TEXT || "Hello from the local MCP delivery test.";
const fixtureMimeType = process.env.MCP_SPEECH_FIXTURE_MIME || "audio/wav";
const mp3 = await readFile(new URL('./audio/mpeg2.mp3', import.meta.url));
const fixture = process.env.MCP_SPEECH_FIXTURE_PATH
  ? await readFile(process.env.MCP_SPEECH_FIXTURE_PATH) : wavFixture();
const validReply = () => ({ audio: fixture.toString("base64"), mimeType: fixtureMimeType, voice: null, engine: 'volcengine' });

async function connect(apiKey = "pak_fixture_local_only") {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: process.cwd(),
    env: { PROMETHEUS_API_URL: baseUrl, PROMETHEUS_API_KEY: apiKey },
    stderr: "pipe",
  });
  const connected = new Client({ name: "speech-delivery-test", version: "1.0.0" });
  await connected.connect(transport);
  return connected;
}

before(async () => {
  api = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const record = { path: req.url, method: req.method, body: JSON.parse(body), auth: req.headers.authorization };
    requests.push(record);
    if (reply.hold) {
      record.closed = false;
      res.once('close', () => { record.closed = true; });
      reply.release = () => { if (!res.destroyed) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(validReply())); } };
      return;
    }
    if (reply.disconnect) { req.socket.destroy(); return; }
    res.writeHead(reply.status || 200, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.body ?? reply));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${api.address().port}`;
  client = await connect();
});

after(async () => {
  await client?.close();
  if (api) await new Promise((resolve) => api.close(resolve));
});

const speak = (args = {}) => client.callTool({ name: "speak", arguments: { text: spokenText, ...args } });
const metadata = (result) => JSON.parse(result.content.find((x) => x.type === "text").text);
function expectError(result) {
  assert.equal(result.isError, true, "Invalid speech must be a tool error");
  assert.equal(result.content.some((x) => x.type === "audio"), false);
}

test("returns exact upstream audio through the real MCP stdio transport", async () => {
  reply = { ...validReply(), voice: 'Puck', engine: 'gemini-tts-fixed' };
  const start = requests.length;
  const result = await speak({ voice: "Puck" });
  assert.notEqual(result.isError, true);
  assert.equal(result.content[0].type, "text", "Keep the original metadata block first for existing clients");
  const audio = result.content.find((x) => x.type === "audio");
  assert.ok(audio, "MCP client must receive the generated audio content");
  assert.equal(audio.mimeType, fixtureMimeType);
  const bytes = Buffer.from(audio.data, "base64");
  assert.equal(digest(bytes), digest(fixture));
  const info = metadata(result);
  assert.equal(info.audio_bytes, fixture.length);
  assert.equal(info.audio_generated, true);
  assert.equal(info.playback_confirmed, false);
  assert.equal(info.delivery, "mcp_audio_content");
  assert.equal(requests.length, start + 1);
  assert.deepEqual(requests.at(-1), { path: "/api/agent/speak", method: "POST", body: { text: spokenText, voice: "Puck", format: "base64" }, auth: "Bearer pak_fixture_local_only" });
  if (process.env.MCP_SPEECH_CAPTURE_PATH) await writeFile(process.env.MCP_SPEECH_CAPTURE_PATH, bytes);
});

test("discovery describes audio delivery without promising avatar playback", async () => {
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 18);
  assert.equal(tools.tools.filter(tool => tool.name.startsWith('prometheus_')).length, 9);
  const tool = tools.tools.find((x) => x.name === "speak");
  assert.match(tool.description, /audio/i);
  assert.doesNotMatch(tool.description, /played with lip-sync|supports emotion detection/i);
  assert.ok(tool.inputSchema.properties.voice_asset_id);
});

test('returns complete MP3 through the actual stdio client', async () => {
  reply = { audio: mp3.toString('base64'), mimeType: 'audio/mpeg', engine: 'volcengine' };
  const result = await speak();
  assert.notEqual(result.isError, true);
  const audio = result.content.find(item => item.type === 'audio');
  assert.equal(audio.mimeType, 'audio/mpeg');
  assert.deepEqual(Buffer.from(audio.data, 'base64'), mp3);
  assert.equal(metadata(result).playback_confirmed, false);
});

test('selected voice asset reaches the agent route and remains in delivery metadata', async () => {
  const voiceAssetId = '550e8400-e29b-41d4-a716-446655440000';
  reply = { audio: mp3.toString('base64'), mimeType: 'audio/mpeg', voiceAssetId, engine: 'volcengine-v3', voice: 'S_private_provider_identity' };
  const result = await speak({ voice_asset_id: voiceAssetId, avatar: 'haru' });
  assert.notEqual(result.isError, true);
  assert.equal(requests.at(-1).body.voiceAssetId, voiceAssetId);
  assert.equal(requests.at(-1).body.avatar, 'haru');
  assert.equal(metadata(result).voice_asset_id, voiceAssetId);
  assert.equal(metadata(result).engine, 'volcengine-v3');
  assert.equal(metadata(result).voice, null);
});

for (const voiceAssetId of [undefined, '650e8400-e29b-41d4-a716-446655440000']) {
  test(`withholds audio when the server ${voiceAssetId ? 'changes' : 'omits'} the selected asset acknowledgement`, async () => {
    reply = { ...validReply(), voiceAssetId };
    const result = await speak({ voice_asset_id: '550e8400-e29b-41d4-a716-446655440000' });
    expectError(result);
    assert.match(result.content[0].text, /did not confirm the requested voice asset/);
  });
}

test('withholds audio for a substituted explicit legacy voice', async () => {
  reply = { ...validReply(), voice: 'Kore' };
  expectError(await speak({ voice: 'Puck' }));
});

for (const engine of [undefined, 'gemini']) {
  test(`withholds unbound audio when the backend ${engine ? 'substitutes' : 'omits'} the Doubao default acknowledgement`, async () => {
    reply = { ...validReply(), engine, voice: 'Kore' };
    expectError(await speak());
  });
}

for (const [name, args] of [
  ['blank text', { text: '  ' }],
  ['oversized text', { text: 'a'.repeat(2001) }],
  ['unsupported voice', { voice: 'S_unknown' }],
  ['invalid voice asset', { voice_asset_id: 'invalid' }],
]) {
  test(`rejects ${name} before upstream HTTP`, async () => {
    const before = requests.length;
    expectError(await speak(args));
    assert.equal(requests.length, before);
  });
}

test('cancelling the MCP request closes its pending speech HTTP request', async () => {
  const held = reply = { hold: true };
  const controller = new AbortController();
  const start = requests.length;
  let rejection;
  const pending = client.callTool({ name: 'speak', arguments: { text: spokenText } }, undefined,
    { signal: controller.signal }).catch(error => { rejection = error; return null; });
  const until = async predicate => {
    const deadline = Date.now() + 1000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(predicate(), 'Expected the owned request state before the deadline');
  };
  try {
    await until(() => requests.length === start + 1);
    const record = requests.at(-1);
    controller.abort();
    await pending;
    assert.equal(rejection?.code, ErrorCode.RequestTimeout);
    assert.ok(rejection.message.includes(String(controller.signal.reason)));
    await until(() => record.closed);
    assert.equal(requests.length, start + 1);
  } finally {
    controller.abort();
    held.release?.();
    await pending;
  }
});

for (const [name, body] of [
  ["missing audio", { mimeType: "audio/wav" }],
  ["empty audio", { audio: "", mimeType: "audio/wav" }],
  ["invalid base64", { audio: "not!base64", mimeType: "audio/wav" }],
  ["non-audio bytes", { audio: Buffer.from("this is not audio").toString("base64"), mimeType: "audio/wav" }],
  ["truncated WAV", { audio: fixture.subarray(0, 20).toString("base64"), mimeType: "audio/wav" }],
  ["non-finite float audio", { audio: floatWavFixture([.25, NaN, -.25]).toString("base64"), mimeType: "audio/wav" }],
  ['truncated MP3', { audio: mp3.subarray(0, -1).toString('base64'), mimeType: 'audio/mpeg' }],
]) {
  test(`rejects ${name} without success or playable audio`, async () => {
    reply = { engine: 'volcengine', ...body };
    expectError(await speak());
  });
}

test("unsupported emotion fails before any upstream synthesis request", async () => {
  reply = validReply();
  const start = requests.length;
  expectError(await speak({ emotion: "happy" }));
  assert.equal(requests.length, start, "Unsupported controls must not trigger synthesis");
});

test("missing API key fails locally and does not use another credential", async () => {
  const noKey = await connect("");
  const start = requests.length;
  try { expectError(await noKey.callTool({ name: "speak", arguments: { text: spokenText } })); }
  finally { await noKey.close(); }
  assert.equal(requests.length, start);
});

test("backend failure is followed by a valid independent request", async () => {
  reply = { status: 503, body: { error: "local fixture unavailable" } };
  expectError(await speak());
  reply = validReply();
  const result = await speak();
  assert.notEqual(result.isError, true);
  const audio = result.content.find((x) => x.type === "audio");
  assert.ok(audio, "A later request must deliver its audio after an earlier failure");
  assert.equal(digest(Buffer.from(audio.data, "base64")), digest(fixture));
});

test("broken upstream connection returns an error without audio", async () => {
  reply = { disconnect: true };
  expectError(await speak());
});
