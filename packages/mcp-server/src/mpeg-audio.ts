/** Check MP3 transport framing; decoding and playback remain the host's responsibility. */
export function validateMpegAudio(bytes: Buffer): void {
    let offset = 0;
    let end = bytes.length;
    if (bytes.toString("latin1", 0, 3) === "ID3") {
        if (bytes.length < 10) throw new Error("Truncated MP3 ID3 header");
        const version = bytes[3];
        const flags = bytes[5];
        if (![2, 3, 4].includes(version) || bytes[4] === 255
            || (flags & (version === 2 ? 0x3f : version === 3 ? 0x1f : 0x0f))) {
            throw new Error("Unsupported MP3 ID3 header");
        }
        let tagSize = 0;
        for (let index = 6; index < 10; index++) {
            if (bytes[index] & 0x80) throw new Error("Invalid MP3 ID3 size");
            tagSize = tagSize * 128 + bytes[index];
        }
        const tagEnd = 10 + tagSize;
        const footer = version === 4 && (flags & 0x10) !== 0;
        offset = tagEnd + (footer ? 10 : 0);
        if (offset > end) throw new Error("Truncated MP3 ID3 tag");
        if (footer && (bytes.toString("latin1", tagEnd, tagEnd + 3) !== "3DI"
            || !bytes.subarray(tagEnd + 3, offset).equals(bytes.subarray(3, 10)))) {
            throw new Error("Invalid MP3 ID3 footer");
        }
    }
    if (end - offset >= 128 && bytes.toString("latin1", end - 128, end - 125) === "TAG") end -= 128;

    const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    const lowRateBitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    let profile: string | null = null;
    let frames = 0;
    while (offset < end) {
        if (end - offset < 4) throw new Error("Truncated MP3 frame header");
        const header = bytes.readUInt32BE(offset);
        const version = (header >>> 19) & 3;
        const layer = (header >>> 17) & 3;
        const bitrateIndex = (header >>> 12) & 15;
        const rateIndex = (header >>> 10) & 3;
        if (header >>> 21 !== 0x7ff || version === 1 || layer !== 1
            || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
            throw new Error("Unsupported or invalid MP3 frame header");
        }
        const sampleRate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
        const bitrate = (version === 3 ? mpeg1Bitrates : lowRateBitrates)[bitrateIndex];
        const frameSize = Math.floor((version === 3 ? 144000 : 72000) * bitrate / sampleRate) + ((header >>> 9) & 1);
        const channels = ((header >>> 6) & 3) === 3 ? 1 : 2;
        const nextProfile = `${version}:${sampleRate}:${channels}`;
        if (profile !== null && profile !== nextProfile) throw new Error("Inconsistent MP3 stream profile");
        profile = nextProfile;
        if (offset + frameSize > end) throw new Error("Truncated MP3 audio frame");
        offset += frameSize;
        frames++;
    }
    if (frames === 0) throw new Error("Speech MP3 has no complete audio frames");
}
