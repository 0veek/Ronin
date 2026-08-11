/**
 * Speech-to-text contract.
 *
 * Dictation runs server-side, not in the renderer. The renderer captures audio
 * and hands the bytes over the existing socket; the server holds the API key,
 * calls the provider, and returns text. That split is not incidental:
 *
 *   - The key never reaches the renderer, so it cannot leak through devtools,
 *     a screenshot, or a bundle. It lives in the same secret store as provider
 *     environment variables and never appears in settings.json.
 *   - None of these three endpoints is designed to be called from a browser
 *     origin, so a renderer-side fetch would be at the mercy of their CORS
 *     headers. The server has no origin.
 *
 * @module speechToText
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Transcription backends.
 *
 * Two of these are purpose-built speech APIs. OpenRouter is not: it routes
 * chat completions and has no transcription endpoint, so audio goes to a
 * multimodal chat model as an `input_audio` part with an instruction to
 * transcribe. That is why its model names look like chat models, and why its
 * output needs more cleanup than the other two.
 */
export const SpeechToTextProvider = Schema.Literals(["deepgram", "groq", "openrouter"]);
export type SpeechToTextProvider = typeof SpeechToTextProvider.Type;

export const SPEECH_TO_TEXT_PROVIDERS: ReadonlyArray<SpeechToTextProvider> = [
  "deepgram",
  "groq",
  "openrouter",
];

/**
 * Default model per provider. Deliberately the cheap, fast tier: dictation is
 * a short clip of one person speaking clearly into a microphone, which is the
 * easiest case these models handle.
 */
export const DEFAULT_SPEECH_TO_TEXT_MODELS: Readonly<Record<SpeechToTextProvider, string>> = {
  deepgram: "nova-3",
  groq: "whisper-large-v3-turbo",
  openrouter: "google/gemini-2.0-flash-001",
};

/** Longest clip accepted, as raw bytes before base64. Roughly 10 minutes of Opus. */
export const MAX_SPEECH_AUDIO_BYTES = 8 * 1024 * 1024;

export const SpeechToTextModels = Schema.Struct({
  deepgram: TrimmedNonEmptyString.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SPEECH_TO_TEXT_MODELS.deepgram)),
  ),
  groq: TrimmedNonEmptyString.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SPEECH_TO_TEXT_MODELS.groq)),
  ),
  openrouter: TrimmedNonEmptyString.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SPEECH_TO_TEXT_MODELS.openrouter)),
  ),
});
export type SpeechToTextModels = typeof SpeechToTextModels.Type;

/**
 * Note what is absent: the API keys. Settings are written to settings.json in
 * plain text, so a key here would be a key on disk in the clear. Keys go to
 * the secret store under {@link speechToTextSecretName} and are set through
 * their own RPC.
 */
export const SpeechToTextSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  provider: SpeechToTextProvider.pipe(
    Schema.withDecodingDefault(Effect.succeed("deepgram" as const)),
  ),
  models: SpeechToTextModels.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  /** Spoken language hint. Empty means let the provider detect it. */
  language: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type SpeechToTextSettings = typeof SpeechToTextSettings.Type;

/** Secret-store key for a provider's API key. One namespace, one per provider. */
export function speechToTextSecretName(provider: SpeechToTextProvider): string {
  return `speech-to-text:${provider}:api-key`;
}

export const SpeechToTextTranscribeInput = Schema.Struct({
  /**
   * Base64 audio. The renderer records Opus in a WebM container where it can,
   * which is what every one of these providers accepts and is an order of
   * magnitude smaller than WAV over the socket.
   */
  audioBase64: TrimmedNonEmptyString,
  mimeType: TrimmedNonEmptyString,
  /** Overrides the configured provider; the settings page uses it to test a key. */
  provider: Schema.optional(SpeechToTextProvider),
});
export type SpeechToTextTranscribeInput = typeof SpeechToTextTranscribeInput.Type;

export const SpeechToTextTranscript = Schema.Struct({
  text: Schema.String,
  provider: SpeechToTextProvider,
  model: TrimmedNonEmptyString,
  /** Wall-clock cost of the provider call, surfaced in diagnostics. */
  durationMs: NonNegativeInt,
});
export type SpeechToTextTranscript = typeof SpeechToTextTranscript.Type;

/** Whether each provider has a key stored. Never the key itself. */
export const SpeechToTextKeyStatus = Schema.Struct({
  deepgram: Schema.Boolean,
  groq: Schema.Boolean,
  openrouter: Schema.Boolean,
});
export type SpeechToTextKeyStatus = typeof SpeechToTextKeyStatus.Type;

export const SpeechToTextSetKeyInput = Schema.Struct({
  provider: SpeechToTextProvider,
  /** Null clears the stored key. */
  apiKey: Schema.NullOr(TrimmedNonEmptyString),
});
export type SpeechToTextSetKeyInput = typeof SpeechToTextSetKeyInput.Type;

/**
 * Failure reasons the UI can act on differently.
 *
 * - `notConfigured` - no key stored for the selected provider. The settings
 *   page is the fix, so the message points there.
 * - `audioRejected` - the clip was empty, too large, or a format the provider
 *   refused. Recording again may work; changing the key will not.
 * - `providerRejected` - the provider answered with an error. Usually a bad or
 *   out-of-quota key, or a model name that does not exist.
 * - `providerUnreachable` - the request never completed.
 */
export class SpeechToTextError extends Schema.TaggedErrorClass<SpeechToTextError>()(
  "SpeechToTextError",
  {
    reason: Schema.Literals([
      "notConfigured",
      "audioRejected",
      "providerRejected",
      "providerUnreachable",
    ]),
    provider: Schema.optional(SpeechToTextProvider),
    /** Bounded and non-identifying. Never contains the key or the audio. */
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const provider = this.provider === undefined ? "" : ` (${this.provider})`;
    return `Transcription failed${provider}: ${this.detail}`;
  }
}
