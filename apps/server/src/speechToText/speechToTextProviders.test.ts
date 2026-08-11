import { describe, it } from "@effect/vitest";
import { expect } from "vite-plus/test";

import { HttpClient } from "effect/unstable/http";
import * as Effect from "effect/Effect";

import {
  audioFileName,
  audioFormat,
  stripChatPreamble,
  transcribeWithOpenRouter,
} from "./speechToTextProviders.ts";

describe("audioFormat", () => {
  it("drops the codec parameters MediaRecorder attaches", () => {
    // The renderer reports `audio/webm;codecs=opus`. Groq infers the container
    // from the filename extension, so a codec suffix there is a rejected upload.
    expect(audioFormat("audio/webm;codecs=opus")).toBe("webm");
    expect(audioFileName("audio/webm;codecs=opus")).toBe("dictation.webm");
  });

  it("normalizes the aliases these APIs do not accept", () => {
    expect(audioFormat("audio/mpeg")).toBe("mp3");
    expect(audioFormat("audio/x-wav")).toBe("wav");
    expect(audioFormat("audio/x-m4a")).toBe("m4a");
  });

  it("falls back to webm when the type is missing or unusable", () => {
    // Safari has shipped an empty type on recorder blobs; webm is the format
    // the renderer asks for, so it is the right guess rather than a random one.
    expect(audioFormat("")).toBe("webm");
    expect(audioFormat("audio")).toBe("webm");
  });
});

describe("stripChatPreamble", () => {
  it("removes the scaffolding a chat model wraps a transcript in", () => {
    // OpenRouter output goes straight into the composer, so a stray "Sure,
    // here's the transcript:" would be typed into the user's prompt.
    expect(stripChatPreamble("Sure, here is the transcript: ship the fix")).toBe("ship the fix");
    expect(stripChatPreamble("Here's the transcript:\nship the fix")).toBe("ship the fix");
    expect(stripChatPreamble('"ship the fix"')).toBe("ship the fix");
    expect(stripChatPreamble("“ship the fix”")).toBe("ship the fix");
  });

  it("keeps a quotation that is part of the speech", () => {
    // Only a quote enclosing the whole reply is scaffolding. Stripping quotes
    // anywhere would corrupt someone dictating a quoted phrase.
    expect(stripChatPreamble('he said "ship it" and left')).toBe('he said "ship it" and left');
  });

  it("leaves a clean transcript alone", () => {
    expect(stripChatPreamble("  ship the fix  ")).toBe("ship the fix");
    expect(stripChatPreamble("")).toBe("");
  });

  it("does not mistake ordinary speech for a preamble", () => {
    // "here is the" is a normal thing to say; only the transcript-announcing
    // form is removed.
    expect(stripChatPreamble("here is the file you wanted")).toBe("here is the file you wanted");
  });
});

describe("OpenRouter container support", () => {
  const deps = (mimeType: string) => ({
    // Never reached: the format check fails before any request is built.
    httpClient: null as unknown as HttpClient.HttpClient,
    apiKey: "test-key",
    audio: new Uint8Array([1, 2, 3]),
    mimeType,
    model: "google/gemini-2.0-flash-001",
    language: "",
  });

  it.effect("rejects webm before spending a request on it", () =>
    Effect.gen(function* () {
      // Chromium records WebM by default and OpenRouter does not list it, so
      // without this the clip goes out and returns as an opaque model failure.
      const error = yield* transcribeWithOpenRouter(deps("audio/webm;codecs=opus")).pipe(
        Effect.flip,
      );

      expect(error.reason).toBe("audioRejected");
      expect(error.detail).toContain("does not accept webm audio");
    }),
  );

  it("accepts the containers OpenRouter documents", () => {
    // m4a is what the renderer records for this provider; the rest are the
    // formats a user could reach with a different browser.
    for (const mimeType of ["audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg"]) {
      expect(["m4a", "ogg", "wav", "mp3"]).toContain(audioFormat(mimeType));
    }
  });
});
