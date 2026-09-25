# MPEG transport fixtures

These short 440 Hz test tones were generated locally with FFmpeg/libmp3lame; they contain no recorded user speech. `mpeg1.mp3` is 44.1 kHz stereo VBR, `mpeg2.mp3` is 24 kHz mono at 64 kbps, and `mpeg25.mp3` is 8 kHz mono at 16 kbps. Each uses a 0.12-second sine input, stripped metadata, no ID3v2 tag and no Xing header. Tests add bounded tags and malformed copies without changing the originals.

The fixtures require no runtime encoder or provider call. MPEG frame validation checks the transport container; decoded playback and physical-device acceptance remain separate.
