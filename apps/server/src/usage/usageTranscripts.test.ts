import { describe, expect, it } from "@effect/vitest";

import {
  EMPTY_TOTALS,
  initialCodexScanState,
  parseClaudeLine,
  parseCodexLine,
  parseGrokLine,
  totalTokens,
} from "./usageTranscripts.ts";

/** Shaped after a real Claude Code assistant record. */
function claudeLine(overrides: {
  messageId: string;
  contentType: string;
  model?: string;
  outputTokens?: number;
}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-07T04:05:13.944Z",
    sessionId: "5a128faa-8253-489e-b935-6c08e8e670c0",
    cwd: "/home/theo/project",
    message: {
      id: overrides.messageId,
      role: "assistant",
      model: overrides.model ?? "claude-fable-5",
      content: [{ type: overrides.contentType }],
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 66818,
        cache_read_input_tokens: 1000,
        output_tokens: overrides.outputTokens ?? 286,
      },
    },
  });
}

describe("parseClaudeLine", () => {
  it("extracts token totals and a dedupe key", () => {
    const record = parseClaudeLine(claudeLine({ messageId: "msg_1", contentType: "text" }));

    expect(record).not.toBeNull();
    expect(record?.provider).toBe("claude");
    expect(record?.model).toBe("claude-fable-5");
    expect(record?.totals).toEqual({
      uncachedInputTokens: 2,
      cachedInputTokens: 1000,
      cacheCreationTokens: 66818,
      outputTokens: 286,
      reasoningTokens: 0,
    });
    expect(record?.dedupeKey).toBe("msg_1:");
  });

  it("gives every content block of one message the same dedupe key", () => {
    // Ronin writes one record per content block, each repeating the parent
    // message's full usage. Summing them would overcount ~2.4x on real data.
    const text = parseClaudeLine(claudeLine({ messageId: "msg_2", contentType: "text" }));
    const toolUse = parseClaudeLine(claudeLine({ messageId: "msg_2", contentType: "tool_use" }));

    expect(text?.dedupeKey).toBe(toolUse?.dedupeKey);
    expect(text?.totals).toEqual(toolUse?.totals);
  });

  it("drops the local notices Claude Code files under <synthetic>", () => {
    // Rate-limit and API-error messages are written as assistant records with
    // an all-zero usage block. Counting them put a $0.00 / 0 token row in the
    // model breakdown for work that never left the machine.
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-08-12T21:42:58.436Z",
      sessionId: "ff2fd7ad-8151-4b97-a1e3-29f181914d2b",
      requestId: "req_011CdyaoBgi9E2J4hpEqPWGr",
      isApiErrorMessage: true,
      message: {
        id: "9d13e9fe-cef9-4ea1-9e76-b65731725eb6",
        role: "assistant",
        model: "<synthetic>",
        content: [{ type: "text", text: "You've hit your session limit" }],
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 0,
        },
      },
    });

    expect(parseClaudeLine(line)).toBeNull();
  });

  it("ignores records that are not assistant messages", () => {
    expect(parseClaudeLine(JSON.stringify({ type: "user", message: {} }))).toBeNull();
    expect(parseClaudeLine("not json")).toBeNull();
  });
});

describe("parseCodexLine", () => {
  const sessionMeta = JSON.stringify({
    type: "session_meta",
    timestamp: "2026-08-01T05:17:41.289Z",
    payload: { type: "session_meta", id: "019fbbc1-b12c-7360-a685-28c181f0025f" },
  });
  const turnContext = JSON.stringify({
    type: "turn_context",
    timestamp: "2026-08-01T05:17:42.694Z",
    payload: { type: "turn_context", model: "gpt-5.6-sol" },
  });
  const tokenCount = (inputTokens: number, cached: number, output: number, reasoning: number) =>
    JSON.stringify({
      type: "event_msg",
      timestamp: "2026-08-01T05:17:49.919Z",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: inputTokens,
            cached_input_tokens: cached,
            cache_write_input_tokens: 0,
            output_tokens: output,
            reasoning_output_tokens: reasoning,
          },
        },
      },
    });

  it("attributes usage to the model from the preceding turn context", () => {
    const state = initialCodexScanState();
    parseCodexLine(sessionMeta, state);
    parseCodexLine(turnContext, state);
    const record = parseCodexLine(tokenCount(19239, 11008, 299, 116), state);

    expect(record?.provider).toBe("codex");
    expect(record?.model).toBe("gpt-5.6-sol");
    expect(record?.sessionId).toBe("019fbbc1-b12c-7360-a685-28c181f0025f");
    // Codex reports input_tokens inclusive of the cached portion.
    expect(record?.totals.uncachedInputTokens).toBe(19239 - 11008);
    expect(record?.totals.cachedInputTokens).toBe(11008);
    expect(record?.totals.reasoningTokens).toBe(116);
  });

  it("skips a repeated token_count so deltas are not double counted", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    const first = parseCodexLine(tokenCount(100, 0, 10, 0), state);
    const repeat = parseCodexLine(tokenCount(100, 0, 10, 0), state);

    expect(first).not.toBeNull();
    expect(repeat).toBeNull();
  });

  it("drops usage that arrives before any model is known", () => {
    const state = initialCodexScanState();
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).toBeNull();
  });

  it("does not let a pre-model event poison the duplicate signature", () => {
    // A token_count before its turn_context is dropped; the identical event
    // re-emitted once the model is known must still be counted.
    const state = initialCodexScanState();
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).toBeNull();
    parseCodexLine(turnContext, state);
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).not.toBeNull();
  });

  // A forked/subagent rollout opens with the parent's history copied in and
  // every line re-stamped to the fork instant, then the ancestors' session
  // metas. Counting those again multiplied usage ~1.85x on real data (#5758).
  describe("forked rollouts", () => {
    const meta = (overrides: {
      id: string;
      timestamp: string;
      forkedFromId?: string;
      spawnParentId?: string;
    }) =>
      JSON.stringify({
        type: "session_meta",
        timestamp: overrides.timestamp,
        payload: {
          type: "session_meta",
          id: overrides.id,
          ...(overrides.forkedFromId === undefined
            ? {}
            : { forked_from_id: overrides.forkedFromId }),
          ...(overrides.spawnParentId === undefined
            ? {}
            : {
                source: {
                  subagent: { thread_spawn: { parent_thread_id: overrides.spawnParentId } },
                },
              }),
        },
      });
    const stamped = (timestamp: string, line: string) => {
      const parsed = JSON.parse(line) as { timestamp: string };
      parsed.timestamp = timestamp;
      return JSON.stringify(parsed);
    };

    it("keeps the child session id over copied ancestor metas", () => {
      const state = initialCodexScanState();
      parseCodexLine(meta({ id: "child", timestamp: "2026-08-01T05:00:00.000Z" }), state);
      parseCodexLine(meta({ id: "parent", timestamp: "2026-08-01T05:00:00.000Z" }), state);
      parseCodexLine(turnContext, state);
      const record = parseCodexLine(tokenCount(100, 0, 10, 0), state);

      expect(record?.sessionId).toBe("child");
    });

    it("drops the re-stamped copied burst and keeps the first real event", () => {
      const state = initialCodexScanState();
      const forkInstant = "2026-08-01T05:00:00.000Z";
      parseCodexLine(meta({ id: "child", timestamp: forkInstant, forkedFromId: "parent" }), state);
      parseCodexLine(meta({ id: "parent", timestamp: forkInstant }), state);
      parseCodexLine(stamped(forkInstant, turnContext), state);

      // Copied history: written in one burst at the fork instant.
      expect(
        parseCodexLine(stamped("2026-08-01T05:00:00.001Z", tokenCount(100, 0, 10, 0)), state),
      ).toBeNull();
      expect(
        parseCodexLine(stamped("2026-08-01T05:00:00.002Z", tokenCount(200, 0, 20, 0)), state),
      ).toBeNull();

      // The child's first genuine turn lands seconds later and must count.
      const real = parseCodexLine(
        stamped("2026-08-01T05:00:06.000Z", tokenCount(300, 0, 30, 0)),
        state,
      );
      expect(real).not.toBeNull();
      expect(real?.totals.outputTokens).toBe(30);

      // Suppression never restarts, even for closely spaced later events.
      const next = parseCodexLine(
        stamped("2026-08-01T05:00:06.100Z", tokenCount(400, 0, 40, 0)),
        state,
      );
      expect(next).not.toBeNull();
    });

    it("recognizes subagent spawns without forked_from_id", () => {
      const state = initialCodexScanState();
      const spawnInstant = "2026-08-01T05:00:00.000Z";
      parseCodexLine(
        meta({ id: "child", timestamp: spawnInstant, spawnParentId: "parent" }),
        state,
      );
      parseCodexLine(stamped(spawnInstant, turnContext), state);
      expect(
        parseCodexLine(stamped("2026-08-01T05:00:00.001Z", tokenCount(100, 0, 10, 0)), state),
      ).toBeNull();
    });

    it("does not suppress anything in a rollout that is not a fork", () => {
      const state = initialCodexScanState();
      parseCodexLine(meta({ id: "root", timestamp: "2026-08-01T05:00:00.000Z" }), state);
      parseCodexLine(stamped("2026-08-01T05:00:00.100Z", turnContext), state);
      const record = parseCodexLine(
        stamped("2026-08-01T05:00:00.200Z", tokenCount(100, 0, 10, 0)),
        state,
      );
      expect(record).not.toBeNull();
    });
  });
});

/** Shaped after a real Grok CLI `updates.jsonl` turn. */
function grokLine(overrides: {
  readonly promptId?: string;
  readonly sessionId?: string;
  readonly modelUsage?: Record<string, Record<string, number>> | null;
  readonly agentTimestampMs?: number | null;
}): string {
  const modelUsage =
    overrides.modelUsage === undefined
      ? {
          "grok-4.5-build": {
            inputTokens: 158057,
            outputTokens: 2414,
            totalTokens: 160471,
            cachedReadTokens: 151040,
            cacheCreationTokens: 0,
            reasoningTokens: 1306,
            costUsdTicks: 738300000,
          },
        }
      : overrides.modelUsage;

  return JSON.stringify({
    timestamp: 1786293444,
    method: "_x.ai/session/update",
    params: {
      sessionId: overrides.sessionId ?? "019fe760-1c7e-7170-a5d5-5e2390002cd7",
      update: {
        sessionUpdate: "turn_completed",
        prompt_id: overrides.promptId ?? "83885ed7-7dbc-4f09-9fd8-1d8b5ff077be",
        stop_reason: "end_turn",
        usage: {
          inputTokens: 158057,
          outputTokens: 2414,
          cachedReadTokens: 151040,
          cacheCreationTokens: 0,
          reasoningTokens: 1306,
          costUsdTicks: 738300000,
          ...(modelUsage === null ? {} : { modelUsage }),
        },
      },
      _meta: {
        eventId: "019fe760-1c7e-7170-a5d5-5e2390002cd7-787",
        ...(overrides.agentTimestampMs === null
          ? {}
          : { agentTimestampMs: overrides.agentTimestampMs ?? 1786293444933 }),
      },
    },
  });
}

describe("parseGrokLine", () => {
  it("splits the turn's tokens out of the cached total and keeps reasoning inside output", () => {
    const [record, ...rest] = parseGrokLine(grokLine({}));

    expect(rest).toEqual([]);
    expect(record?.provider).toBe("grok");
    expect(record?.model).toBe("grok-4.5-build");
    expect(record?.totals).toEqual({
      // inputTokens is inclusive of the cached read, as it is for Codex.
      uncachedInputTokens: 7017,
      cachedInputTokens: 151040,
      cacheCreationTokens: 0,
      outputTokens: 2414,
      reasoningTokens: 1306,
    });
    expect(totalTokens(record?.totals ?? EMPTY_TOTALS)).toBe(160471);
  });

  it("reads cost as ticks of 1e-10 USD", () => {
    const [record] = parseGrokLine(grokLine({}));

    // 7,017 uncached at $2/M + 151,040 cache reads at $0.30/M + 2,414 output at
    // $6/M, which is LiteLLM's published xai/grok-4.5 rate card.
    expect(record?.reportedCostUsd).toBeCloseTo(0.07383, 8);
  });

  it("keys de-duplication by session, prompt and model", () => {
    const [first] = parseGrokLine(grokLine({}));
    const [copy] = parseGrokLine(grokLine({}));
    const [other] = parseGrokLine(grokLine({ promptId: "a-different-prompt" }));

    expect(first?.dedupeKey).toBe(copy?.dedupeKey);
    expect(first?.dedupeKey).not.toBe(other?.dedupeKey);
  });

  it("emits one record per model a turn called", () => {
    const records = parseGrokLine(
      grokLine({
        modelUsage: {
          "grok-4.6-build": { inputTokens: 100, outputTokens: 10, costUsdTicks: 20 },
          "grok-4.5-build": { inputTokens: 50, outputTokens: 5, costUsdTicks: 10 },
        },
      }),
    );

    expect(records.map((record) => record.model)).toEqual(["grok-4.6-build", "grok-4.5-build"]);
    expect(new Set(records.map((record) => record.dedupeKey)).size).toBe(2);
  });

  it("falls back to the turn total when no per-model split is reported", () => {
    const records = parseGrokLine(grokLine({ modelUsage: null }));

    expect(records).toHaveLength(1);
    expect(records[0]?.model).toBe("grok");
    expect(records[0]?.totals.outputTokens).toBe(2414);
  });

  it("shares the turn's cost across models that report no cost of their own", () => {
    const records = parseGrokLine(
      grokLine({
        // 738,300,000 ticks = $0.07383 for the turn, split 2:1 by tokens.
        modelUsage: {
          "grok-4.6-build": { inputTokens: 200, outputTokens: 20 },
          "grok-4.5-build": { inputTokens: 100, outputTokens: 10 },
        },
      }),
    );

    expect(records.map((record) => record.reportedCostUsd?.toFixed(6))).toEqual([
      "0.049220",
      "0.024610",
    ]);
  });

  it("shares only what the per-model costs left behind", () => {
    const records = parseGrokLine(
      grokLine({
        modelUsage: {
          // Claims $0.05383 of the turn's $0.07383, leaving $0.02 for the rest.
          "grok-4.6-build": { inputTokens: 200, outputTokens: 20, costUsdTicks: 538300000 },
          "grok-4.5-build": { inputTokens: 100, outputTokens: 10 },
        },
      }),
    );

    expect(records.map((record) => record.reportedCostUsd?.toFixed(6))).toEqual([
      "0.053830",
      "0.020000",
    ]);
  });

  it("leaves a model's own cost alone and never shares a negative remainder", () => {
    const records = parseGrokLine(
      grokLine({
        modelUsage: {
          // Claims more than the turn total; the remainder clamps at zero.
          "grok-4.6-build": { inputTokens: 200, outputTokens: 20, costUsdTicks: 938300000 },
          "grok-4.5-build": { inputTokens: 100, outputTokens: 10 },
        },
      }),
    );

    expect(records.map((record) => record.reportedCostUsd)).toEqual([0.09383, 0]);
  });

  it("prefers the millisecond agent stamp over the whole-second wrapper", () => {
    const [precise] = parseGrokLine(grokLine({}));
    const [coarse] = parseGrokLine(grokLine({ agentTimestampMs: null }));

    expect(precise?.timestampMs).toBe(1786293444933);
    expect(coarse?.timestampMs).toBe(1786293444000);
  });

  it("ignores updates that are not a completed turn", () => {
    const line = JSON.stringify({
      timestamp: 1786293444,
      params: {
        sessionId: "s",
        update: { sessionUpdate: "agent_message_chunk", content: { text: "hi" } },
      },
    });

    expect(parseGrokLine(line)).toEqual([]);
  });
});

describe("totalTokens", () => {
  it("does not add reasoning on top of output", () => {
    expect(
      totalTokens({
        uncachedInputTokens: 10,
        cachedInputTokens: 20,
        cacheCreationTokens: 30,
        outputTokens: 40,
        reasoningTokens: 25,
      }),
    ).toBe(100);
  });
});
