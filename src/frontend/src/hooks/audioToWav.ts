const TARGET_SAMPLE_RATE = 16_000;

/** Convert decoded browser audio to interleaved-free, mono, 16-bit PCM WAV. */
export function encodeAudioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
  if (
    audioBuffer.length === 0 ||
    audioBuffer.numberOfChannels === 0 ||
    !Number.isFinite(audioBuffer.duration) ||
    audioBuffer.duration <= 0
  ) {
    throw new Error("The decoded audio buffer is empty");
  }
  const outputLength = Math.max(1, Math.round(audioBuffer.duration * TARGET_SAMPLE_RATE));
  const mono = new Float32Array(outputLength);

  for (let frame = 0; frame < outputLength; frame += 1) {
    const sourcePosition = (frame * audioBuffer.sampleRate) / TARGET_SAMPLE_RATE;
    const lower = Math.min(Math.floor(sourcePosition), audioBuffer.length - 1);
    const upper = Math.min(lower + 1, audioBuffer.length - 1);
    const fraction = sourcePosition - lower;
    let mixed = 0;

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      const samples = audioBuffer.getChannelData(channel);
      const sample = samples[lower] * (1 - fraction) + samples[upper] * fraction;
      mixed += sample / audioBuffer.numberOfChannels;
    }
    mono[frame] = Math.max(-1, Math.min(1, mixed));
  }

  const bytesPerSample = 2;
  const dataLength = outputLength * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);

  for (let index = 0; index < outputLength; index += 1) {
    const sample = mono[index];
    view.setInt16(
      44 + index * bytesPerSample,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
  }

  return buffer;
}

/** Decode a MediaRecorder container and return the server-supported WAV payload. */
export async function toWav(blob: Blob): Promise<{ blob: Blob; duration: number }> {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) throw new Error("Web Audio is unavailable");

  const context = new AudioContextConstructor();
  try {
    const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer());
    const wav = encodeAudioBufferToWav(audioBuffer);
    return {
      blob: new Blob([wav], { type: "audio/wav" }),
      duration: audioBuffer.duration,
    };
  } finally {
    await context.close();
  }
}
