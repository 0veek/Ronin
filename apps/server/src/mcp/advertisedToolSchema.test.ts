import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { Tool } from "effect/unstable/ai";

import { ADVERTISED_TOOL_POLICY, toAdvertisedJsonSchema } from "./advertisedToolSchema.ts";
import { PreviewToolkit } from "./toolkits/preview/tools.ts";

const generated = (name: keyof typeof PreviewToolkit.tools) =>
  Tool.getJsonSchema(PreviewToolkit.tools[name]) as Record<string, unknown>;

const advertised = (name: keyof typeof PreviewToolkit.tools) =>
  toAdvertisedJsonSchema(name, generated(name));

const propertyOf = (schema: Record<string, unknown>, field: string) =>
  (schema["properties"] as Record<string, unknown> | undefined)?.[field] as
    | Record<string, unknown>
    | undefined;

/** Every node, so structural assertions cannot miss a nested one. */
function* nodes(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const entry of value) yield* nodes(entry);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  yield value as Record<string, unknown>;
  for (const nested of Object.values(value)) yield* nodes(nested);
}

const advertisedBytes = () =>
  Object.values(PreviewToolkit.tools).reduce(
    (total, tool) =>
      total +
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        inputSchema: toAdvertisedJsonSchema(
          tool.name,
          Tool.getJsonSchema(tool) as Record<string, unknown>,
        ),
      }).length,
    0,
  );

const generatedBytes = () =>
  Object.values(PreviewToolkit.tools).reduce(
    (total, tool) =>
      total +
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        inputSchema: Tool.getJsonSchema(tool),
      }).length,
    0,
  );

it("drops the nullable branch that optional fields render as", () => {
  const timeout = propertyOf(advertised("preview_click"), "timeoutMs");
  expect(timeout).toBeDefined();
  expect(timeout?.["anyOf"], "an optional field should advertise its own type").toBeUndefined();
  expect(timeout?.["type"]).toBe("integer");

  for (const node of nodes(advertised("preview_resize"))) {
    expect(node["type"], "no null branch should survive anywhere in the tree").not.toBe("null");
  }
});

it("hoists constraint-only allOf boxes and drops the trimmed-string regex", () => {
  const width = propertyOf(advertised("preview_resize"), "width");
  expect(width).toEqual({
    type: "integer",
    minimum: 240,
    maximum: 3840,
    description: "Freeform viewport width in CSS pixels. Required only in freeform mode.",
  });

  for (const node of nodes(advertised("preview_navigate"))) {
    expect(
      node["allOf"],
      "a constraint-only allOf should be merged into its parent",
    ).toBeUndefined();
    expect(
      String(node["pattern"] ?? ""),
      "the trimmed-string regex is a decoder concern",
    ).not.toContain("[\\s\\S]");
  }
});

it("never repeats a description on both halves of a collapsed union", () => {
  for (const tool of Object.values(PreviewToolkit.tools)) {
    const schema = toAdvertisedJsonSchema(
      tool.name,
      Tool.getJsonSchema(tool) as Record<string, unknown>,
    );
    for (const node of nodes(schema)) {
      const members = [node["anyOf"], node["allOf"]].filter(Array.isArray).flat();
      for (const member of members) {
        if (typeof member !== "object" || member === null) continue;
        expect(
          (member as Record<string, unknown>)["description"],
          `${tool.name} repeats a description on a union member`,
        ).not.toBe(node["description"]);
      }
    }
  }
});

it("hides the legacy selector alias without changing what the decoder accepts", () => {
  for (const name of [
    "preview_click",
    "preview_type",
    "preview_scroll",
    "preview_wait_for",
  ] as const) {
    expect(
      propertyOf(generated(name), "selector"),
      `${name} should still declare selector`,
    ).toBeDefined();
    expect(
      propertyOf(advertised(name), "selector"),
      `${name} should not advertise the legacy selector`,
    ).toBeUndefined();
    expect(
      propertyOf(advertised(name), "locator"),
      `${name} must still advertise locator, which selector defers to`,
    ).toBeDefined();
  }

  // The whole point of hiding rather than removing: a client that still sends
  // `selector` decodes exactly as before.
  const decodeClick = Schema.decodeUnknownSync(PreviewToolkit.tools.preview_click.parametersSchema);
  expect(decodeClick({ selector: "button[type='submit']" })).toMatchObject({
    selector: "button[type='submit']",
  });
});

it("advertises one way to navigate to a URL, and still decodes the other", () => {
  const target = propertyOf(advertised("preview_navigate"), "target");
  const kinds = [...nodes(target)]
    .map((node) => (node["properties"] as Record<string, any> | undefined)?.["kind"]?.enum?.[0])
    .filter((kind): kind is string => typeof kind === "string");
  expect(kinds, "target should only offer the shape `url` cannot express").toEqual([
    "environment-port",
  ]);
  expect(propertyOf(advertised("preview_navigate"), "url")).toBeDefined();

  const decodeNavigate = Schema.decodeUnknownSync(
    PreviewToolkit.tools.preview_navigate.parametersSchema,
  );
  expect(decodeNavigate({ target: { kind: "url", url: "t3.chat" } })).toMatchObject({
    target: { kind: "url" },
  });
});

it("keeps every policy entry pointed at a field that still exists", () => {
  for (const [toolName, policy] of Object.entries(ADVERTISED_TOOL_POLICY)) {
    const tool = PreviewToolkit.tools[toolName as keyof typeof PreviewToolkit.tools];
    expect(tool, `${toolName} is in the policy but not in the toolkit`).toBeDefined();
    const schema = Tool.getJsonSchema(tool) as Record<string, unknown>;
    for (const field of policy.hideFields ?? []) {
      expect(propertyOf(schema, field), `${toolName}.${field} no longer exists`).toBeDefined();
    }
    for (const [field, variants] of Object.entries(policy.hideVariants ?? {})) {
      const property = propertyOf(schema, field);
      expect(property, `${toolName}.${field} no longer exists`).toBeDefined();
      const kinds = [...nodes(property)]
        .map((node) => (node["properties"] as Record<string, any> | undefined)?.["kind"]?.enum?.[0])
        .filter((kind): kind is string => typeof kind === "string");
      for (const variant of variants) {
        expect(kinds, `${toolName}.${field} has no '${variant}' variant to hide`).toContain(
          variant,
        );
      }
    }
  }
});

it("leaves every tool describable and materially smaller", () => {
  for (const tool of Object.values(PreviewToolkit.tools)) {
    const schema = toAdvertisedJsonSchema(
      tool.name,
      Tool.getJsonSchema(tool) as Record<string, unknown>,
    );
    expect(schema["type"], `${tool.name} must stay a top-level object schema`).toBe("object");
    for (const [field, fieldSchema] of Object.entries(
      (schema["properties"] as Record<string, unknown>) ?? {},
    )) {
      expect(
        (fieldSchema as Record<string, unknown>)["description"],
        `${tool.name}.${field} lost the description the agent reads`,
      ).toBeTypeOf("string");
    }
  }

  // Guards the whole point of the module: if this ratio regresses, the prompt
  // silently got fatter on every turn of every thread.
  expect(advertisedBytes()).toBeLessThan(generatedBytes() * 0.8);
});
