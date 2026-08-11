/**
 * SpeechToTextService - dictation, and the API keys behind it.
 *
 * Keys live in the same secret store as provider environment variables, never
 * in settings.json and never on the wire back to the renderer. The only thing
 * a client can learn is whether a key exists.
 *
 * @module SpeechToTextService
 */
import {
  MAX_SPEECH_AUDIO_BYTES,
  SPEECH_TO_TEXT_PROVIDERS,
  SpeechToTextError,
  speechToTextSecretName,
  type SpeechToTextKeyStatus,
  type SpeechToTextProvider,
  type SpeechToTextSetKeyInput,
  type SpeechToTextTranscribeInput,
  type SpeechToTextTranscript,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import { modelFor, transcribeWith } from "./speechToTextProviders.ts";

export class SpeechToTextService extends Context.Service<
  SpeechToTextService,
  {
    readonly transcribe: (
      input: SpeechToTextTranscribeInput,
    ) => Effect.Effect<SpeechToTextTranscript, SpeechToTextError>;
    readonly keyStatus: Effect.Effect<SpeechToTextKeyStatus, SpeechToTextError>;
    readonly setKey: (
      input: SpeechToTextSetKeyInput,
    ) => Effect.Effect<SpeechToTextKeyStatus, SpeechToTextError>;
  }
>()("t3/speechToText/SpeechToTextService") {}

const NO_KEYS: SpeechToTextKeyStatus = { deepgram: false, groq: false, openrouter: false };

/** Empty surface, for suites that only need the RPC to resolve. */
export const layerTest = Layer.succeed(
  SpeechToTextService,
  SpeechToTextService.of({
    transcribe: () =>
      Effect.fail(
        new SpeechToTextError({ reason: "notConfigured", detail: "Dictation is not configured." }),
      ),
    keyStatus: Effect.succeed(NO_KEYS),
    setKey: () => Effect.succeed(NO_KEYS),
  }),
);

/**
 * Decodes the renderer's base64 clip.
 *
 * The size ceiling is checked on the decoded bytes rather than the string,
 * because base64 inflates by a third and the limit is about what the provider
 * will accept, not what crossed the socket.
 */
function decodeAudio(
  input: SpeechToTextTranscribeInput,
  provider: SpeechToTextProvider,
): Effect.Effect<Uint8Array, SpeechToTextError> {
  return Effect.try({
    try: () => Buffer.from(input.audioBase64, "base64"),
    catch: () =>
      new SpeechToTextError({
        provider,
        reason: "audioRejected",
        detail: "The clip was unreadable.",
      }),
  }).pipe(
    Effect.flatMap((bytes) =>
      bytes.length === 0
        ? Effect.fail(
            new SpeechToTextError({
              provider,
              reason: "audioRejected",
              detail: "The clip was empty. Nothing was recorded.",
            }),
          )
        : bytes.length > MAX_SPEECH_AUDIO_BYTES
          ? Effect.fail(
              new SpeechToTextError({
                provider,
                reason: "audioRejected",
                detail: "The clip is too long.",
              }),
            )
          : Effect.succeed(new Uint8Array(bytes)),
    ),
  );
}

export const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const readSettings = settingsService.getSettings.pipe(
    Effect.catchCause(
      (cause) =>
        new SpeechToTextError({
          reason: "notConfigured",
          detail: "Server settings could not be read.",
          cause: Cause.squash(cause),
        }),
    ),
  );

  const readKey = (provider: SpeechToTextProvider) =>
    secretStore.get(speechToTextSecretName(provider)).pipe(
      Effect.map((stored) => (Option.isSome(stored) ? decoder.decode(stored.value).trim() : "")),
      Effect.catchCause(() => Effect.succeed("")),
    );

  const keyStatus = Effect.forEach(SPEECH_TO_TEXT_PROVIDERS, (provider) =>
    readKey(provider).pipe(Effect.map((key) => [provider, key.length > 0] as const)),
  ).pipe(Effect.map((entries) => Object.fromEntries(entries) as unknown as SpeechToTextKeyStatus));

  const setKey = Effect.fn("SpeechToTextService.setKey")(function* (
    input: SpeechToTextSetKeyInput,
  ) {
    const name = speechToTextSecretName(input.provider);
    yield* (
      input.apiKey === null
        ? secretStore.remove(name)
        : secretStore.set(name, encoder.encode(input.apiKey))
    ).pipe(
      Effect.catchCause(
        (cause) =>
          new SpeechToTextError({
            provider: input.provider,
            reason: "notConfigured",
            detail: "The key could not be stored.",
            cause: Cause.squash(cause),
          }),
      ),
    );
    return yield* keyStatus;
  });

  const transcribe = Effect.fn("SpeechToTextService.transcribe")(function* (
    input: SpeechToTextTranscribeInput,
  ) {
    const settings = yield* readSettings;
    const stt = settings.speechToText;
    // An explicit provider means the settings page is testing a key, which has
    // to work even while dictation itself is switched off.
    const provider = input.provider ?? stt.provider;

    if (!stt.enabled && input.provider === undefined) {
      return yield* Effect.fail(
        new SpeechToTextError({
          provider,
          reason: "notConfigured",
          detail: "Dictation is turned off in settings.",
        }),
      );
    }

    const apiKey = yield* readKey(provider);
    if (apiKey.length === 0) {
      return yield* Effect.fail(
        new SpeechToTextError({
          provider,
          reason: "notConfigured",
          detail: "No API key is saved for this provider.",
        }),
      );
    }

    const audio = yield* decodeAudio(input, provider);
    const model = modelFor(stt, provider);
    const startedAt = yield* Clock.currentTimeMillis;

    const text = yield* transcribeWith(provider)({
      httpClient,
      apiKey,
      audio,
      mimeType: input.mimeType,
      model,
      language: stt.language.trim(),
    });

    const finishedAt = yield* Clock.currentTimeMillis;
    return {
      text: text.trim(),
      provider,
      model,
      durationMs: Math.max(0, finishedAt - startedAt),
    } satisfies SpeechToTextTranscript;
  });

  return SpeechToTextService.of({ transcribe, keyStatus, setKey });
});

export const layer = Layer.effect(SpeechToTextService, make);
