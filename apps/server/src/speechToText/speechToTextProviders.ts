/**
 * Turning a clip of audio into text, once per provider.
 *
 * The three do not share a shape. Deepgram takes raw bytes with the options in
 * the query string. Groq takes OpenAI's multipart form. OpenRouter has no
 * transcription endpoint at all, so it takes a chat completion carrying the
 * audio as a content part. Each function below owns exactly one of those
 * shapes; the parts that are genuinely common -- clamping, cleanup, error
 * classification -- live at the bottom.
 *
 * Nothing here logs, stores, or echoes the API key, and no failure message
 * carries the audio or the key.
 *
 * @module speechToTextProviders
 */
import {
  SpeechToTextError,
  type SpeechToTextProvider,
  type SpeechToTextSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

const REQUEST_TIMEOUT_MS = 60_000;

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * The instruction OpenRouter's model is given.
 *
 * A chat model asked to transcribe will happily add "Sure, here is the
 * transcript:" or wrap the result in quotes, and dictation output goes
 * straight into the composer, so any of that would land in the user's prompt.
 * This asks for nothing but the words, and {@link stripChatPreamble} cleans up
 * what the instruction fails to prevent.
 */
const OPENROUTER_INSTRUCTION =
  "Transcribe the speech in this audio verbatim. Reply with the transcript only: " +
  "no preamble, no quotation marks, no commentary, no translation. " +
  "If there is no intelligible speech, reply with nothing at all.";

export type TranscriptionDeps = {
  readonly httpClient: HttpClient.HttpClient;
  readonly apiKey: string;
  readonly audio: Uint8Array;
  readonly mimeType: string;
  readonly model: string;
  readonly language: string;
};

function fail(
  provider: SpeechToTextProvider,
  reason: SpeechToTextError["reason"],
  detail: string,
): SpeechToTextError {
  return new SpeechToTextError({ provider, reason, detail });
}

/**
 * Sends a prepared request and hands back parsed JSON.
 *
 * The status split matters to the caller: 4xx means the key, the model name,
 * or the audio is wrong and retrying changes nothing, while a transport
 * failure may be worth another go.
 */
const send = Effect.fn("speechToText.send")(function* (
  provider: SpeechToTextProvider,
  httpClient: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
) {
  const response = yield* httpClient.execute(request).pipe(
    Effect.timeout(REQUEST_TIMEOUT_MS),
    Effect.catchCause(() =>
      Effect.fail(fail(provider, "providerUnreachable", "The provider could not be reached.")),
    ),
  );

  if (response.status >= 400) {
    // The body can quote the request, so it is never forwarded verbatim.
    return yield* fail(
      provider,
      "providerRejected",
      response.status === 401 || response.status === 403
        ? "The API key was rejected."
        : response.status === 404
          ? "The model was not found. Check the model name."
          : response.status === 429
            ? "The provider is rate limiting or out of quota."
            : `The provider returned HTTP ${response.status}.`,
    );
  }

  return yield* response.json.pipe(
    Effect.catchCause(() =>
      Effect.fail(fail(provider, "providerRejected", "The provider returned an unreadable body.")),
    ),
  );
});

// ---------------------------------------------------------------------------
// Deepgram
// ---------------------------------------------------------------------------

/**
 * Deepgram takes the audio as the raw request body and everything else as
 * query parameters. `smart_format` is what supplies punctuation and casing --
 * without it the transcript arrives as an unbroken lowercase run, which is
 * unusable as prompt text.
 */
export const transcribeWithDeepgram = Effect.fn("speechToText.deepgram")(function* (
  deps: TranscriptionDeps,
) {
  const query = new URLSearchParams({ model: deps.model, smart_format: "true" });
  if (deps.language.length > 0) query.set("language", deps.language);

  const request = HttpClientRequest.post(`${DEEPGRAM_URL}?${query.toString()}`).pipe(
    HttpClientRequest.setHeaders({
      authorization: `Token ${deps.apiKey}`,
      "content-type": deps.mimeType,
    }),
    HttpClientRequest.bodyUint8Array(deps.audio, deps.mimeType),
  );

  const body = (yield* send("deepgram", deps.httpClient, request)) as {
    results?: {
      channels?: ReadonlyArray<{ alternatives?: ReadonlyArray<{ transcript?: unknown }> }>;
    };
  };

  const transcript = body.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (typeof transcript !== "string") {
    return yield* fail("deepgram", "providerRejected", "The response carried no transcript.");
  }
  return transcript;
});

// ---------------------------------------------------------------------------
// Groq
// ---------------------------------------------------------------------------

/**
 * Groq mirrors OpenAI's transcription endpoint, so the audio goes as a
 * multipart file field. The filename is not cosmetic: the service infers the
 * container from its extension, and a name without one is rejected.
 */
export const transcribeWithGroq = Effect.fn("speechToText.groq")(function* (
  deps: TranscriptionDeps,
) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([deps.audio], { type: deps.mimeType }),
    audioFileName(deps.mimeType),
  );
  form.append("model", deps.model);
  form.append("response_format", "json");
  if (deps.language.length > 0) form.append("language", deps.language);

  const request = HttpClientRequest.post(GROQ_URL).pipe(
    HttpClientRequest.setHeaders({ authorization: `Bearer ${deps.apiKey}` }),
    HttpClientRequest.bodyFormData(form),
  );

  const body = (yield* send("groq", deps.httpClient, request)) as { text?: unknown };
  if (typeof body.text !== "string") {
    return yield* fail("groq", "providerRejected", "The response carried no transcript.");
  }
  return body.text;
});

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

/**
 * OpenRouter routes chat completions and has no transcription endpoint, so
 * this is a chat turn whose user message carries the audio.
 *
 * Two consequences the other two providers do not have. The model has to be
 * one that accepts audio input -- a text-only model answers as though the clip
 * were not there, which reads as a nonsense transcript rather than an error.
 * And the reply is chat output, so it gets the preamble stripping below.
 */
/**
 * Containers OpenRouter's audio content part accepts.
 *
 * WebM is deliberately absent because OpenRouter does not list it, and that is
 * exactly what Chromium records by default -- so without this check the clip
 * goes out and comes back as an opaque model failure.
 */
const OPENROUTER_AUDIO_FORMATS: ReadonlySet<string> = new Set([
  "wav",
  "mp3",
  "aiff",
  "aac",
  "ogg",
  "flac",
  "m4a",
  "pcm16",
  "pcm24",
]);

export const transcribeWithOpenRouter = Effect.fn("speechToText.openrouter")(function* (
  deps: TranscriptionDeps,
) {
  const format = audioFormat(deps.mimeType);
  if (!OPENROUTER_AUDIO_FORMATS.has(format)) {
    return yield* fail(
      "openrouter",
      "audioRejected",
      `OpenRouter does not accept ${format} audio. Deepgram or Groq will take this recording.`,
    );
  }

  const instruction =
    deps.language.length > 0
      ? `${OPENROUTER_INSTRUCTION} The audio is in ${deps.language}.`
      : OPENROUTER_INSTRUCTION;

  const request = HttpClientRequest.post(OPENROUTER_URL).pipe(
    HttpClientRequest.setHeaders({
      authorization: `Bearer ${deps.apiKey}`,
      "content-type": "application/json",
    }),
    HttpClientRequest.bodyJsonUnsafe({
      model: deps.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instruction },
            {
              type: "input_audio",
              input_audio: { data: toBase64(deps.audio), format },
            },
          ],
        },
      ],
    }),
  );

  const body = (yield* send("openrouter", deps.httpClient, request)) as {
    choices?: ReadonlyArray<{ message?: { content?: unknown } }>;
  };

  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return yield* fail(
      "openrouter",
      "providerRejected",
      "The model returned no text. It may not accept audio input.",
    );
  }
  return stripChatPreamble(content);
});

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export function transcribeWith(
  provider: SpeechToTextProvider,
): (deps: TranscriptionDeps) => Effect.Effect<string, SpeechToTextError, never> {
  switch (provider) {
    case "deepgram":
      return transcribeWithDeepgram;
    case "groq":
      return transcribeWithGroq;
    case "openrouter":
      return transcribeWithOpenRouter;
  }
}

export function modelFor(settings: SpeechToTextSettings, provider: SpeechToTextProvider): string {
  return settings.models[provider];
}

/**
 * The container, as a bare extension.
 *
 * MediaRecorder reports a full media type with codec parameters attached
 * (`audio/webm;codecs=opus`), and neither the filename nor OpenRouter's
 * `format` field wants any of that.
 */
export function audioFormat(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const subtype = base.split("/")[1] ?? "";
  if (subtype === "mpeg" || subtype === "mp3") return "mp3";
  if (subtype === "x-wav" || subtype === "wave") return "wav";
  if (subtype === "mp4" || subtype === "x-m4a") return "m4a";
  return subtype.length > 0 ? subtype : "webm";
}

export function audioFileName(mimeType: string): string {
  return `dictation.${audioFormat(mimeType)}`;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Removes the scaffolding a chat model wraps a transcript in.
 *
 * Only the outermost layer, and only when it encloses the whole reply: a
 * transcript can legitimately contain a quotation, and stripping quotes
 * anywhere would corrupt it.
 */
export function stripChatPreamble(raw: string): string {
  let text = raw.trim();

  const lead =
    /^(?:sure[,!.]?\s*)?(?:here(?:'s| is)\s+(?:the\s+)?(?:verbatim\s+)?transcript(?:ion)?\s*:?\s*)/i;
  text = text.replace(lead, "").trim();

  const quoted =
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith("“") && text.endsWith("”"));
  if (quoted && text.length >= 2) text = text.slice(1, -1).trim();

  return text;
}
