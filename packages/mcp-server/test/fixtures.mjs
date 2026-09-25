import { createHash } from "node:crypto";

// Deterministic local WAV fixture; this is not a live TTS-provider response.
export function wavFixture(frames = 9) {
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) wav.writeInt16LE(100 * (i + 1), 44 + i * 2);
  return wav;
}

export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function floatWavFixture(samples, bits = 32) {
  const sampleBytes = bits / 8;
  const wav = wavFixture(samples.length * sampleBytes / 2);
  wav.writeUInt16LE(3, 20);
  wav.writeUInt32LE(24000 * sampleBytes, 28);
  wav.writeUInt16LE(sampleBytes, 32);
  wav.writeUInt16LE(bits, 34);
  for (const [index, sample] of samples.entries()) {
    if (bits === 32) wav.writeFloatLE(sample, 44 + index * sampleBytes);
    else wav.writeDoubleLE(sample, 44 + index * sampleBytes);
  }
  return wav;
}
