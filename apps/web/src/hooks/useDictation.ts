/**
 * Push-to-talk microphone capture for the composer.
 *
 * Recording happens here because only the renderer can reach a microphone;
 * transcription happens on the server because only it holds the API key. This
 * hook owns the half in between: permission, the recorder, and turning the
 * result into base64 for the socket.
 *
 * Hold to speak, release to send. A toggle would be fewer events, but it also
 * leaves the microphone live when attention moves elsewhere -- the whole point
 * of push-to-talk is that letting go is the same gesture as being done, so
 * there is no state to forget about.
 *
 * @module hooks/useDictation
 */
import type { SpeechToTextProvider } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { serverEnvironment } from "../state/server";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";

export type DictationStatus = "idle" | "recording" | "transcribing";

export interface DictationController {
  readonly status: DictationStatus;
  readonly error: string | null;
  readonly isSupported: boolean;
  /** Key or button went down. Idempotent while already recording. */
  readonly beginHold: () => void;
  /** Key or button came up. Stops and transcribes what was captured. */
  readonly endHold: () => void;
  /** Drops the clip without transcribing it. Escape, or losing the window. */
  readonly cancel: () => void;
  readonly dismissError: () => void;
}

/**
 * Container preference, best first, per provider.
 *
 * Deepgram and Groq both take WebM/Opus, which is roughly a tenth the size of
 * the WAV a naive capture would produce -- and the clip crosses the socket
 * base64-encoded, so size is not academic.
 *
 * OpenRouter is the exception and the reason this is a per-provider list at
 * all: its audio content part accepts wav, mp3, aiff, aac, ogg, flac, m4a,
 * pcm16 and pcm24, and WebM is not among them. So for OpenRouter the order
 * starts at MP4, which Chromium records as m4a.
 */
const PREFERRED_MIME_TYPES: Readonly<Record<SpeechToTextProvider, ReadonlyArray<string>>> = {
  deepgram: ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"],
  groq: ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"],
  openrouter: ["audio/mp4", "audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"],
};

/**
 * How long to wait on the permission prompt before giving up.
 *
 * Electron does not always reject getUserMedia when a session denies it
 * (electron#42714); the promise can simply never settle, which reads to the
 * user as the button doing nothing at all.
 */
const PERMISSION_TIMEOUT_MS = 15_000;

/**
 * A press shorter than this is a fumble, not speech.
 *
 * Push-to-talk invites accidental taps, and a 40ms clip costs a round trip to
 * the provider to be told there is no speech in it.
 */
const MIN_HOLD_MS = 250;

function pickMimeType(provider: SpeechToTextProvider): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of PREFERRED_MIME_TYPES[provider]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  // An empty string is valid: it tells MediaRecorder to choose for itself.
  return "";
}

function isSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    typeof MediaRecorder !== "undefined"
  );
}

/**
 * Bytes to base64 without blowing the stack.
 *
 * `String.fromCharCode(...bytes)` is the obvious spelling and throws on a clip
 * of any real length, because the argument list becomes the whole recording.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function describeCaptureFailure(error: unknown): string {
  if (error instanceof Error && error.message === "MicrophonePermissionTimeout") {
    return "The microphone permission prompt never answered.";
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was denied.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found.";
  }
  return "The microphone could not be opened.";
}

export function useDictation(options: {
  readonly onTranscript: (text: string) => void;
  /** Decides which container to record, since the providers disagree. */
  readonly provider: SpeechToTextProvider;
}): DictationController {
  const environmentId = usePrimaryEnvironmentId();
  const transcribe = useAtomCommand(serverEnvironment.transcribeAudio, "dictation transcribe");

  const [status, setStatus] = useState<DictationStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);
  /**
   * Set the moment the hold begins and cleared when it ends. `status` cannot
   * do this job: getUserMedia takes a permission round trip, so a quick tap
   * can release before the recorder ever starts, and this is what remembers
   * that the release already happened.
   */
  const holdingRef = useRef(false);
  // Kept in a ref so the recorder's stop handler always calls the current
  // consumer rather than the one captured when recording began.
  const onTranscriptRef = useRef(options.onTranscript);
  onTranscriptRef.current = options.onTranscript;

  const releaseStream = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    chunksRef.current = [];
    // Every track has to be stopped explicitly, or the OS keeps showing the
    // microphone as in use long after dictation ended.
    for (const track of recorder?.stream.getTracks() ?? []) track.stop();
  }, []);

  useEffect(() => releaseStream, [releaseStream]);

  const stopRecorder = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder !== null && recorder.state !== "inactive") recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    holdingRef.current = false;
    cancelledRef.current = true;
    stopRecorder();
    setStatus("idle");
  }, [stopRecorder]);

  const beginHold = useCallback(() => {
    if (holdingRef.current || status !== "idle") return;
    holdingRef.current = true;

    if (!isSupported()) {
      holdingRef.current = false;
      setError("This build cannot record audio.");
      return;
    }
    if (environmentId === null) {
      holdingRef.current = false;
      setError("Not connected to an environment.");
      return;
    }

    setError(null);
    cancelledRef.current = false;

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({ audio: true }),
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () => reject(new Error("MicrophonePermissionTimeout")),
              PERMISSION_TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (captureError) {
        holdingRef.current = false;
        setError(describeCaptureFailure(captureError));
        return;
      }

      // The permission prompt can outlast the hold. Releasing before the
      // stream arrives means there is nothing to record, so hand the device
      // straight back rather than starting a recorder nobody is holding.
      if (!holdingRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      const mimeType = pickMimeType(options.provider);
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(
          stream,
          mimeType === null || mimeType === "" ? undefined : { mimeType },
        );
      } catch {
        for (const track of stream.getTracks()) track.stop();
        holdingRef.current = false;
        setError("This build cannot record audio.");
        return;
      }

      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });

      recorder.addEventListener("stop", () => {
        const chunks = chunksRef.current;
        const recordedType = recorder.mimeType || mimeType || "audio/webm";
        const heldMs = Date.now() - startedAtRef.current;
        releaseStream();

        if (cancelledRef.current) {
          setStatus("idle");
          return;
        }
        if (chunks.length === 0 || heldMs < MIN_HOLD_MS) {
          setStatus("idle");
          // Silent on a fumble: an error banner for a mis-tap is noise.
          if (chunks.length > 0) return;
          setError("Nothing was recorded.");
          return;
        }

        setStatus("transcribing");
        void (async () => {
          try {
            const buffer = await new Blob(chunks, { type: recordedType }).arrayBuffer();
            const result = await transcribe({
              environmentId,
              input: {
                audioBase64: toBase64(new Uint8Array(buffer)),
                mimeType: recordedType,
              },
            });

            if (result._tag !== "Success") {
              setError("Transcription failed.");
              return;
            }
            const text = result.value.text.trim();
            if (text.length === 0) {
              setError("No speech was detected.");
              return;
            }
            onTranscriptRef.current(text);
          } catch {
            setError("Transcription failed.");
          } finally {
            setStatus("idle");
          }
        })();
      });

      startedAtRef.current = Date.now();
      recorder.start();
      setStatus("recording");

      // Released while the recorder was being constructed.
      if (!holdingRef.current) stopRecorder();
    })();
  }, [environmentId, options.provider, releaseStream, status, stopRecorder, transcribe]);

  const endHold = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    stopRecorder();
  }, [stopRecorder]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    status,
    error,
    isSupported: isSupported(),
    beginHold,
    endHold,
    cancel,
    dismissError,
  };
}
