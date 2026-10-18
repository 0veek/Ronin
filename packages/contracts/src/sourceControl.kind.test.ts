import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { SourceControlProviderKind } from "./sourceControl.ts";
const decode = Schema.decodeUnknownSync(SourceControlProviderKind);
describe("source control host slugs", () => {
  it.each(["github", "custom-forge", "constructor"])(
    "accepts %s without knowing its integration",
    (slug) => {
      expect(decode(slug)).toBe(slug);
    },
  );
  it.each(["", "Custom", "a/b", "_host", "a".repeat(65)])(
    "rejects malformed host slug %s",
    (slug) => {
      expect(() => decode(slug)).toThrow();
    },
  );
});
