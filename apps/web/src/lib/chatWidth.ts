import {
  CHAT_MAX_WIDTH_BY_MODE,
  cycleChatWidthMode,
  DEFAULT_CHAT_WIDTH,
  isChatWidthMode,
  normalizeChatWidthMode,
  type ChatWidthMode,
} from "@t3tools/contracts/settings";

export {
  CHAT_MAX_WIDTH_BY_MODE,
  cycleChatWidthMode,
  DEFAULT_CHAT_WIDTH,
  isChatWidthMode,
  normalizeChatWidthMode,
  type ChatWidthMode,
};

export const CHAT_COLUMN_MAX_WIDTH_CLASS_NAME = "max-w-[var(--app-chat-max-width,48rem)]";

export function getChatWidthCssVariables(mode: ChatWidthMode = DEFAULT_CHAT_WIDTH) {
  return {
    "--app-chat-max-width": CHAT_MAX_WIDTH_BY_MODE[mode],
  } as const;
}

export type ChatWidthCssVariable = keyof ReturnType<typeof getChatWidthCssVariables>;
