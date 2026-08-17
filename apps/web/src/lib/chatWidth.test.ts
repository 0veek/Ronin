import { describe, expect, it } from "vite-plus/test";

import {
  cycleChatWidthMode,
  DEFAULT_CHAT_WIDTH,
  getChatWidthCssVariables,
  normalizeChatWidthMode,
} from "./chatWidth";

describe("chatWidth", () => {
  it("normalizes unknown values to the default reading column", () => {
    expect(normalizeChatWidthMode("wide")).toBe("wide");
    expect(normalizeChatWidthMode("full")).toBe("full");
    expect(normalizeChatWidthMode("focused")).toBe(DEFAULT_CHAT_WIDTH);
    expect(normalizeChatWidthMode(undefined)).toBe(DEFAULT_CHAT_WIDTH);
  });

  it("maps each preset to a CSS max-width", () => {
    expect(getChatWidthCssVariables("standard")["--app-chat-max-width"]).toBe("48rem");
    expect(getChatWidthCssVariables("wide")["--app-chat-max-width"]).toBe("72rem");
    expect(getChatWidthCssVariables("full")["--app-chat-max-width"]).toBe("100%");
  });

  it("cycles standard → wide → full → standard", () => {
    expect(cycleChatWidthMode("standard")).toBe("wide");
    expect(cycleChatWidthMode("wide")).toBe("full");
    expect(cycleChatWidthMode("full")).toBe("standard");
  });
});
