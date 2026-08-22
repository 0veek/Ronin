import type { MessageId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectShowsMessageSource, useMessageSourceStore } from "./messageSourceStore";

const first = "message-1" as MessageId;
const second = "message-2" as MessageId;

describe("useMessageSourceStore", () => {
  beforeEach(() => {
    useMessageSourceStore.setState({ sourceMessageIds: new Set<MessageId>() });
  });

  it("shows rendered output until a message is toggled", () => {
    expect(selectShowsMessageSource(useMessageSourceStore.getState(), first)).toBe(false);

    useMessageSourceStore.getState().toggleMessageSource(first);

    expect(selectShowsMessageSource(useMessageSourceStore.getState(), first)).toBe(true);
  });

  it("toggles back to rendered output", () => {
    useMessageSourceStore.getState().toggleMessageSource(first);
    useMessageSourceStore.getState().toggleMessageSource(first);

    expect(selectShowsMessageSource(useMessageSourceStore.getState(), first)).toBe(false);
  });

  it("keeps each message independent", () => {
    useMessageSourceStore.getState().toggleMessageSource(first);

    expect(selectShowsMessageSource(useMessageSourceStore.getState(), second)).toBe(false);
  });

  it("replaces the set so subscribers see the change", () => {
    const before = useMessageSourceStore.getState().sourceMessageIds;
    useMessageSourceStore.getState().toggleMessageSource(first);

    expect(useMessageSourceStore.getState().sourceMessageIds).not.toBe(before);
  });
});
