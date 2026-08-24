import { describe, expect, it } from "vite-plus/test";

import { parseAntigravityStreamLine } from "./AntigravityStream.ts";

// Lines copied from `agy 1.1.13 --output-format stream-json`.
const INIT = `{"event":"init","conversation_id":"12b6afac-1e3d-42ea-8610-99b792048f8e","init":{"cwd":"/tmp/agy-probe","tools":["run_command"],"permission_mode":"always-proceed"}}`;
const TEXT = `{"event":"step_update","step_update":{"conversation_id":"c","step_index":2,"state":"ACTIVE","step_type":"agent_response","text_delta":"Hello there"}}`;
const TOOL_ACTIVE = `{"event":"step_update","step_update":{"conversation_id":"c","step_index":3,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo hi"}}}}`;
const TOOL_DONE = `{"event":"step_update","step_update":{"conversation_id":"c","step_index":3,"state":"DONE","step_type":"tool","tool_name":"run_command","duration_seconds":0.05,"tool_info":{"name":"run_command","parameters":{"CommandLine":"echo hi"},"output":"hi\\r\\n"}}}`;
const VIEW_FILE = `{"event":"step_update","step_update":{"conversation_id":"c","step_index":4,"state":"DONE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/tmp/agy-probe/MARKER.txt"},"output":"2 lines, 7 bytes"}}}`;
const RESULT = `{"event":"result","result":{"conversation_id":"12b6afac-1e3d-42ea-8610-99b792048f8e","status":"SUCCESS","response":"Hello there, friend!","duration_seconds":3.5,"num_turns":1,"usage":{"input_tokens":15069,"output_tokens":136,"thinking_tokens":128,"cache_read_tokens":12,"total_tokens":15205}}}`;
// A turn the agent finished after recovering from a failed tool call: `status`
// is ERROR, the stale step error sits in `error`, and the finished answer is
// right there in `response`. Copied from `agy 1.1.19`.
const RECOVERED_RESULT = `{"event":"result","result":{"conversation_id":"29d66633-1b9b-4acf-acf2-9627f9923f7e","status":"ERROR","response":"I have successfully created the file done.txt.","error":"declaring permissions: cortex tool write_to_file: model output error: invalid tool call error (invalid_args)","duration_seconds":60.4,"num_turns":2,"usage":{"input_tokens":38130,"output_tokens":240,"thinking_tokens":100,"cache_read_tokens":12182,"total_tokens":38370}}}`;
// A launch the CLI rejected outright: nothing answered, and the only
// explanation is in `error`. Copied from `agy 1.1.19`.
const FAILED_RESULT = `{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"invalid model selection (--model \\"bogus\\"): model bogus is not recognized as a known model","duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0}}}`;

describe("parseAntigravityStreamLine", () => {
  it("reads the conversation id off the init event", () => {
    expect(parseAntigravityStreamLine(INIT)).toEqual({
      kind: "init",
      conversationId: "12b6afac-1e3d-42ea-8610-99b792048f8e",
    });
  });

  it("forwards assistant text deltas verbatim", () => {
    expect(parseAntigravityStreamLine(TEXT)).toEqual({ kind: "text", delta: "Hello there" });
  });

  it("opens a command tool with the command it is about to run", () => {
    expect(parseAntigravityStreamLine(TOOL_ACTIVE)).toEqual({
      kind: "tool",
      stepIndex: 3,
      completed: false,
      toolName: "run_command",
      itemType: "command_execution",
      title: "Command run",
      detail: "echo hi",
      data: {
        toolName: "run_command",
        command: "echo hi",
        parameters: { CommandLine: "echo hi" },
      },
    });
  });

  it("closes a command tool with its output", () => {
    const event = parseAntigravityStreamLine(TOOL_DONE);
    expect(event).toMatchObject({
      kind: "tool",
      stepIndex: 3,
      completed: true,
      data: { command: "echo hi", output: "hi" },
    });
  });

  it("marks a tool the CLI could not get permission for as declined", () => {
    // Exactly what `agy` emits for a supervised (headless) run: print mode
    // cannot prompt, so the permission is denied on the user's behalf.
    const event = parseAntigravityStreamLine(
      `{"event":"step_update","step_update":{"step_index":3,"state":"ERROR","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo should-not-run"},"error":{"type":"TOOL_ERROR","message":"User denied permission to run command:\\necho should-not-run"}}}}`,
    );
    expect(event).toMatchObject({ kind: "tool", completed: true, status: "declined" });
  });

  it("marks any other tool error as failed", () => {
    const event = parseAntigravityStreamLine(
      `{"event":"step_update","step_update":{"step_index":3,"state":"ERROR","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/nope"},"error":{"type":"TOOL_ERROR","message":"no such file"}}}}`,
    );
    expect(event).toMatchObject({
      kind: "tool",
      status: "failed",
      data: { error: "no such file" },
    });
  });

  it("classifies unmapped tools as generic tool calls and titles them by path", () => {
    expect(parseAntigravityStreamLine(VIEW_FILE)).toMatchObject({
      kind: "tool",
      itemType: "dynamic_tool_call",
      title: "Tool call",
      detail: "/tmp/agy-probe/MARKER.txt",
    });
  });

  it("reports success and token usage from the result event", () => {
    expect(parseAntigravityStreamLine(RESULT)).toEqual({
      kind: "result",
      succeeded: true,
      answered: true,
      conversationId: "12b6afac-1e3d-42ea-8610-99b792048f8e",
      usage: {
        usedTokens: 15205,
        inputTokens: 15069,
        outputTokens: 136,
        cachedInputTokens: 12,
        reasoningOutputTokens: 128,
      },
    });
  });

  it("marks a turn that answered as answered, however the CLI graded the steps", () => {
    // The whole reason `answered` exists: `status` goes ERROR for any step that
    // errored, so a recovered turn would otherwise be reported as a failure
    // whose message is the assistant's own success notice.
    const event = parseAntigravityStreamLine(RECOVERED_RESULT);
    expect(event).toMatchObject({ kind: "result", succeeded: false, answered: true });
    expect(event && "message" in event ? event.message : undefined).toContain(
      "declaring permissions",
    );
  });

  it("explains a failed result from the CLI's error rather than its empty response", () => {
    const event = parseAntigravityStreamLine(FAILED_RESULT);
    expect(event).toMatchObject({ kind: "result", succeeded: false, answered: false });
    expect(event && "message" in event ? event.message : undefined).toContain(
      "invalid model selection",
    );
  });

  it("falls back to the response when a failure carries no error field", () => {
    const event = parseAntigravityStreamLine(
      `{"event":"result","result":{"status":"ERROR","response":"quota exhausted"}}`,
    );
    expect(event).toMatchObject({ kind: "result", succeeded: false });
    expect(event && "message" in event ? event.message : undefined).toContain("quota exhausted");
  });

  it("ignores chatter, partial lines, and steps with nothing to show", () => {
    expect(parseAntigravityStreamLine("Fetching...")).toBeNull();
    expect(parseAntigravityStreamLine('{"event":"result","resu')).toBeNull();
    expect(parseAntigravityStreamLine("")).toBeNull();
    expect(
      parseAntigravityStreamLine(
        `{"event":"step_update","step_update":{"step_index":0,"state":"DONE","step_type":"user_input"}}`,
      ),
    ).toBeNull();
  });

  it("reassembles the reply exactly from its deltas", () => {
    const deltas = ["Hel", "lo ", "world"].map(
      (delta) =>
        `{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"agent_response","text_delta":"${delta}"}}`,
    );
    const text = deltas
      .map(parseAntigravityStreamLine)
      .map((event) => (event?.kind === "text" ? event.delta : ""))
      .join("");
    expect(text).toBe("Hello world");
  });
});
