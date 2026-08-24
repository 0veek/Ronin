/**
 * Builds the JSON Schema an MCP client is *told* about, which is not the same
 * thing as the schema the server decodes with.
 *
 * Every tool definition Ronin registers is re-serialized into the system prompt
 * of every turn, on every provider that gets the `ronin` server. The preview
 * toolkit alone was 17k characters — roughly 4,700 tokens an agent pays for on
 * turns that never open a browser. Most of that was not information: it was
 * `anyOf [T, null]` wrappers around optional fields, `allOf` boxes around a
 * lone `maximum`, the trimmed-string regex, and descriptions repeated verbatim
 * on both halves of a nullable pair.
 *
 * Slimming happens here rather than in `@t3tools/contracts` because the two
 * audiences want different things. The decoder must keep accepting everything
 * it accepts today — an explicit `null`, a legacy `selector` — or in-flight
 * sessions and the desktop IPC path break. The model only needs the shortest
 * accurate description of how to call the tool. This module is the seam
 * between those, so the wire contract never has to bend to save tokens.
 *
 * @module mcp/advertisedToolSchema
 */

/** `Schema.String.pipe(Schema.trimmed())` — a decoder concern, not a prompt. */
const TRIMMED_STRING_PATTERN = "^\\S[\\s\\S]*\\S$|^\\S$|^$";

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Fields and union members that are real input but redundant to describe.
 *
 * Each entry costs the prompt a second way to say something the agent can
 * already say, so it is hidden from the advertised schema while staying fully
 * accepted by the decoder. Keyed by tool name so a hidden field can never leak
 * across to another tool that means something different by the same word.
 */
export const ADVERTISED_TOOL_POLICY: Record<
  string,
  {
    /** Properties to omit. */
    readonly hideFields?: ReadonlyArray<string>;
    /** Discriminated-union members to omit, by property then `kind` value. */
    readonly hideVariants?: Readonly<Record<string, ReadonlyArray<string>>>;
  }
> = {
  // `selector` is sugar the desktop manager expands to `css=<selector>` before
  // it resolves anything (apps/desktop/src/preview/Manager.ts). Advertising
  // `locator` alone loses the agent no reach: `locator: "css=button[type=submit]"`
  // is the same call, and role/text locators are what we want it reaching for.
  preview_click: { hideFields: ["selector"] },
  preview_type: { hideFields: ["selector"] },
  preview_scroll: { hideFields: ["selector"] },
  preview_wait_for: { hideFields: ["selector"] },
  // `target: {kind: "url"}` restates the sibling `url` field, and describing
  // both invites the model to deliberate over which one it is supposed to use.
  // `target` keeps the `environment-port` shape, which `url` cannot express.
  preview_navigate: { hideVariants: { target: ["url"] } },
};

/** Rewrites every object node bottom-up. */
function mapNodes(node: unknown, rewrite: (node: JsonObject) => JsonObject): unknown {
  if (Array.isArray(node)) {
    return node.map((entry) => mapNodes(entry, rewrite));
  }
  if (!isJsonObject(node)) {
    return node;
  }
  const mapped: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    mapped[key] = mapNodes(value, rewrite);
  }
  return rewrite(mapped);
}

/**
 * Hoists `allOf` members that only carry constraint keywords.
 *
 * `Schema.Int.pipe(Schema.between(240, 3840))` renders as an `allOf` box around
 * `{minimum, maximum}`. Merging it into the parent says the same thing in a
 * third of the characters, and matches how a hand-written schema would read.
 */
function hoistConstraintAllOf(node: JsonObject): JsonObject {
  const { allOf } = node;
  if (!Array.isArray(allOf) || allOf.length === 0) {
    return node;
  }
  const isConstraintOnly = allOf.every(
    (member) =>
      isJsonObject(member) &&
      member["type"] === undefined &&
      member["anyOf"] === undefined &&
      member["properties"] === undefined,
  );
  if (!isConstraintOnly) {
    return node;
  }
  const { allOf: _dropped, ...rest } = node;
  const merged: JsonObject = { ...rest };
  for (const member of allOf) {
    Object.assign(merged, member);
  }
  return merged;
}

/**
 * Collapses `anyOf: [T, null]` down to `T`.
 *
 * An optional field renders as a nullable union, which doubles the node and
 * usually repeats the description on both halves. Omitting the key and passing
 * `null` mean the same thing to every handler here, so the advertised schema
 * describes the one the agent should reach for. The decoder still takes `null`.
 */
function collapseNullableUnion(node: JsonObject): JsonObject {
  const { anyOf } = node;
  if (!Array.isArray(anyOf) || anyOf.length !== 2) {
    return node;
  }
  const nullIndex = anyOf.findIndex(
    (member) =>
      isJsonObject(member) && member["type"] === "null" && Object.keys(member).length === 1,
  );
  if (nullIndex < 0) {
    return node;
  }
  const other = anyOf[nullIndex === 0 ? 1 : 0];
  if (!isJsonObject(other)) {
    return node;
  }
  const { anyOf: _dropped, ...rest } = node;
  const inner: JsonObject = { ...other };
  // The wrapper's description is the one written for the field as a whole; the
  // branch's is the same sentence again on most of these.
  if (typeof rest["description"] === "string") {
    delete inner["description"];
  }
  return { ...inner, ...rest };
}

function dropDecoderOnlyKeywords(node: JsonObject): JsonObject {
  if (node["pattern"] !== TRIMMED_STRING_PATTERN) {
    return node;
  }
  const { pattern: _dropped, ...rest } = node;
  return rest;
}

/** Drops `properties` entries, keeping `required` honest. */
function hideFields(schema: JsonObject, fields: ReadonlyArray<string>): JsonObject {
  const properties = schema["properties"];
  if (!isJsonObject(properties)) {
    return schema;
  }
  const kept: JsonObject = {};
  for (const [name, value] of Object.entries(properties)) {
    if (!fields.includes(name)) {
      kept[name] = value;
    }
  }
  const required = schema["required"];
  return {
    ...schema,
    properties: kept,
    ...(Array.isArray(required)
      ? { required: required.filter((name) => !fields.includes(name as string)) }
      : {}),
  };
}

/** Unwraps the `anyOf` nesting `Schema.Union` of structs produces. */
function unionMembers(node: JsonObject): ReadonlyArray<unknown> | undefined {
  const { anyOf } = node;
  if (!Array.isArray(anyOf)) {
    return undefined;
  }
  const nested = anyOf.find((member) => isJsonObject(member) && Array.isArray(member["anyOf"]));
  if (isJsonObject(nested) && Array.isArray(nested["anyOf"])) {
    return nested["anyOf"];
  }
  return anyOf;
}

function variantKind(member: unknown): string | undefined {
  if (!isJsonObject(member)) {
    return undefined;
  }
  const properties = member["properties"];
  if (!isJsonObject(properties)) {
    return undefined;
  }
  const kind = properties["kind"];
  if (!isJsonObject(kind) || !Array.isArray(kind["enum"])) {
    return undefined;
  }
  const [value] = kind["enum"];
  return typeof value === "string" ? value : undefined;
}

/** Drops named members of a discriminated union under one property. */
function hideVariants(
  schema: JsonObject,
  variants: Readonly<Record<string, ReadonlyArray<string>>>,
): JsonObject {
  const properties = schema["properties"];
  if (!isJsonObject(properties)) {
    return schema;
  }
  const rewritten: JsonObject = { ...properties };
  for (const [name, hidden] of Object.entries(variants)) {
    const property = rewritten[name];
    if (!isJsonObject(property)) {
      continue;
    }
    const members = unionMembers(property);
    if (!members) {
      continue;
    }
    const kept = members.filter((member) => {
      const kind = variantKind(member);
      return kind === undefined || !hidden.includes(kind);
    });
    if (kept.length === 0 || kept.length === members.length) {
      continue;
    }
    const description = property["description"];
    rewritten[name] =
      kept.length === 1 && isJsonObject(kept[0])
        ? { ...kept[0], ...(description === undefined ? {} : { description }) }
        : { ...property, anyOf: kept };
  }
  return { ...schema, properties: rewritten };
}

/**
 * Slims the JSON Schema generated for the tool named `toolName`.
 *
 * Structural slimming is safe for any schema; the per-tool omissions come from
 * {@link ADVERTISED_TOOL_POLICY}, which is asserted against the real toolkit in
 * `advertisedToolSchema.test.ts` so a renamed field cannot rot into a no-op.
 */
export function toAdvertisedJsonSchema(
  toolName: string,
  generated: Record<string, unknown>,
): Record<string, unknown> {
  const policy = ADVERTISED_TOOL_POLICY[toolName];
  const trimmed = policy?.hideFields ? hideFields(generated, policy.hideFields) : generated;
  const pruned = policy?.hideVariants ? hideVariants(trimmed, policy.hideVariants) : trimmed;
  return mapNodes(pruned, (node) =>
    collapseNullableUnion(hoistConstraintAllOf(dropDecoderOnlyKeywords(node))),
  ) as Record<string, unknown>;
}
