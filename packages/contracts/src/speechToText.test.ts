import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  MAX_SPEECH_API_KEY_CHARS,
  MAX_SPEECH_AUDIO_BASE64_CHARS,
  SpeechToTextSetKeyInput,
  SpeechToTextTranscribeInput,
} from "./speechToText.ts";

const decodeTranscription = Schema.decodeUnknownExit(SpeechToTextTranscribeInput);
const decodeSetKey = Schema.decodeUnknownExit(SpeechToTextSetKeyInput);

describe("speech-to-text payload limits", () => {
  it("rejects audio strings larger than the decoded audio budget can require", () => {
    expect(
      decodeTranscription({
        audioBase64: "A".repeat(MAX_SPEECH_AUDIO_BASE64_CHARS + 1),
        mimeType: "audio/webm",
      })._tag,
    ).toBe("Failure");
  });

  it("rejects implausibly large secret values", () => {
    expect(
      decodeSetKey({
        provider: "deepgram",
        apiKey: "k".repeat(MAX_SPEECH_API_KEY_CHARS + 1),
      })._tag,
    ).toBe("Failure");
  });
});
