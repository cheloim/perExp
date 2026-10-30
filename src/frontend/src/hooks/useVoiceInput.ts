import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "../api/client";
import { toWav } from "./audioToWav";

export type VoiceInputState = "idle" | "requesting" | "recording" | "transcribing" | "error";

type VoiceInputOptions = {
  onTranscript: (text: string) => void;
  maxSeconds?: number;
};

type VoiceInput = {
  supported: boolean;
  state: VoiceInputState;
  error: string | null;
  elapsed: number;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
};

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];

function chooseMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function microphoneError(error: unknown): string {
  const errorName =
    typeof error === "object" && error !== null && "name" in error ? error.name : undefined;
  if (errorName === "NotAllowedError") {
    return "No tengo permiso para usar el micrófono. Habilitalo en el navegador.";
  }
  if (errorName === "NotFoundError") {
    return "No encontré un micrófono.";
  }
  return "No pude procesar el audio. Probá de nuevo.";
}

export function useVoiceInput({ onTranscript, maxSeconds = 60 }: VoiceInputOptions): VoiceInput {
  const supported =
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function";
  const [state, setState] = useState<VoiceInputState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const canceledRef = useRef(false);
  const mountedRef = useRef(true);

  const clearTimers = useCallback(() => {
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    stopTimeoutRef.current = null;
    elapsedIntervalRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  }, [clearTimers]);

  const cancel = useCallback(() => {
    canceledRef.current = true;
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    releaseStream();
    chunksRef.current = [];
    setElapsed(0);
    setError(null);
    setState("idle");
  }, [clearTimers, releaseStream]);

  const start = useCallback(async () => {
    if (!supported || ["requesting", "recording", "transcribing"].includes(state)) return;
    canceledRef.current = false;
    setError(null);
    setElapsed(0);
    setState("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!mountedRef.current || canceledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = chooseMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        clearTimers();
        if (canceledRef.current) {
          releaseStream();
          return;
        }

        setState("transcribing");
        const recording = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
        chunksRef.current = [];
        releaseStream();
        void (async () => {
          let wav: Awaited<ReturnType<typeof toWav>>;
          try {
            if (recording.size === 0) throw new Error("Empty recording");
            wav = await toWav(recording);
          } catch {
            if (!mountedRef.current || canceledRef.current) return;
            setError("No pude procesar el audio. Probá de nuevo.");
            setState("error");
            releaseStream();
            return;
          }

          try {
            const result = await transcribeAudio(wav.blob, wav.duration);
            if (!mountedRef.current || canceledRef.current) return;
            if (result.unclear) {
              setError("No pude entender el audio. Probá de nuevo.");
              setState("idle");
              return;
            }
            onTranscript(result.text);
            setState("idle");
          } catch {
            if (!mountedRef.current || canceledRef.current) return;
            setError("No pude transcribir el audio. Probá de nuevo.");
            setState("error");
          } finally {
            releaseStream();
          }
        })();
      };

      recorder.start();
      startedAtRef.current = Date.now();
      setState("recording");
      elapsedIntervalRef.current = setInterval(() => {
        setElapsed(Math.min(maxSeconds, Math.floor((Date.now() - startedAtRef.current) / 1000)));
      }, 250);
      stopTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) stop();
      }, maxSeconds * 1000);
    } catch (cause) {
      releaseStream();
      setError(microphoneError(cause));
      setState("error");
    }
  }, [clearTimers, maxSeconds, onTranscript, releaseStream, state, stop, supported]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      canceledRef.current = true;
      clearTimers();
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      releaseStream();
    };
  }, [clearTimers, releaseStream]);

  return { supported, state, error, elapsed, start, stop, cancel };
}
