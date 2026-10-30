import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAudioBufferToWav, toWav } from "./audioToWav";
import { useVoiceInput } from "./useVoiceInput";
import { transcribeAudio } from "../api/client";

vi.mock("../api/client", () => ({ transcribeAudio: vi.fn() }));

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: "recording" | "inactive" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    readonly stream: MediaStream,
    readonly options?: MediaRecorderOptions,
  ) {}
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["recorded audio"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

const decodedBuffer = {
  duration: 0.25,
  sampleRate: 16_000,
  numberOfChannels: 1,
  length: 4_000,
  getChannelData: () => new Float32Array(4_000).fill(0.25),
};

let decodeAudioData: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;
let stoppedTrack: ReturnType<typeof vi.fn>;
const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  decodeAudioData = vi.fn().mockResolvedValue(decodedBuffer);
  vi.stubGlobal(
    "AudioContext",
    class {
      decodeAudioData = decodeAudioData;
      close = vi.fn().mockResolvedValue(undefined);
    },
  );
  stoppedTrack = vi.fn();
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stoppedTrack }] });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.mocked(transcribeAudio).mockResolvedValue({
    text: "supermercado 15200",
    duration_seconds: 0.25,
    unclear: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (mediaDevicesDescriptor) {
    Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

describe("audioToWav", () => {
  it("encodes mono PCM WAV at 16 kHz", () => {
    const wav = encodeAudioBufferToWav({
      duration: 0.00025,
      sampleRate: 16_000,
      numberOfChannels: 1,
      length: 4,
      getChannelData: () => new Float32Array([-1, -0.5, 0.5, 1]),
    } as unknown as AudioBuffer);
    const view = new DataView(wav);

    expect(wav.byteLength).toBe(52);
    expect(new TextDecoder().decode(new Uint8Array(wav, 0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(new Uint8Array(wav, 8, 4))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getInt16(44, true)).toBe(-32768);
  });

  it("downmixes multichannel audio and resamples non-16-kHz input", () => {
    const wav = encodeAudioBufferToWav({
      duration: 0.0005,
      sampleRate: 8_000,
      numberOfChannels: 2,
      length: 4,
      getChannelData: (channel: number) => new Float32Array(4).fill(channel === 0 ? 1 : 0),
    } as unknown as AudioBuffer);
    const view = new DataView(wav);

    expect(wav.byteLength).toBe(60);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getInt16(44, true)).toBe(16_383);
  });

  it("decodes browser audio and returns its duration with a WAV blob", async () => {
    const result = await toWav(new Blob(["webm"], { type: "audio/webm" }));

    expect(decodeAudioData).toHaveBeenCalledOnce();
    expect(result.blob.type).toBe("audio/wav");
    expect(result.duration).toBe(0.25);
  });
});

describe("useVoiceInput", () => {
  it("reports unsupported when MediaRecorder is missing", () => {
    vi.stubGlobal("MediaRecorder", undefined);

    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn() }));

    expect(result.current.supported).toBe(false);
  });

  it("reports unsupported when mediaDevices is missing", () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });

    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn() }));

    expect(result.current.supported).toBe(false);
  });

  it("transcribes a WAV on stop and calls onTranscript", async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    await act(() => result.current.start());
    act(() => result.current.stop());

    expect(stoppedTrack).toHaveBeenCalledOnce();
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("supermercado 15200"));
    expect(transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ type: "audio/wav" }),
      0.25,
    );
    expect(stoppedTrack).toHaveBeenCalledOnce();
  });

  it("surfaces permission denied", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn() }));

    await act(() => result.current.start());

    expect(result.current.state).toBe("error");
    expect(result.current.error).toMatch(/permiso/i);
  });

  it("cancel stops the tracks without transcribing", async () => {
    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn() }));

    await act(() => result.current.start());
    act(() => result.current.cancel());

    expect(result.current.state).toBe("idle");
    expect(stoppedTrack).toHaveBeenCalledOnce();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("releases the stream when the hook unmounts while recording", async () => {
    const { result, unmount } = renderHook(() => useVoiceInput({ onTranscript: vi.fn() }));

    await act(() => result.current.start());
    unmount();

    expect(stoppedTrack).toHaveBeenCalledOnce();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("automatically stops at the default 60-second maximum", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVoiceInput({ onTranscript: vi.fn() }));
    await act(() => result.current.start());

    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(stoppedTrack).toHaveBeenCalledOnce();

    vi.useRealTimers();
    await waitFor(() => expect(transcribeAudio).toHaveBeenCalledOnce());
  });

  it("does not pass an unclear transcription to the composer", async () => {
    vi.mocked(transcribeAudio).mockResolvedValueOnce({
      text: "",
      duration_seconds: 0.25,
      unclear: true,
    });
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    await act(() => result.current.start());
    act(() => result.current.stop());

    await waitFor(() => expect(result.current.error).toMatch(/No pude entender el audio/));
    expect(onTranscript).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });
});
