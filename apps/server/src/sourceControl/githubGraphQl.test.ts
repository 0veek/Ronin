import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { readGraphQlPages } from "./githubGraphQl.ts";

describe("readGraphQlPages", () => {
  const pages = (cursors: ReadonlyArray<string | null>) => {
    const asked: Array<string | null> = [];
    const read = (after: string | null) =>
      Effect.sync(() => {
        asked.push(after);
        return { next: cursors[asked.length - 1] ?? null };
      });
    return { asked, read };
  };

  it.effect("follows the cursor until GitHub has no more", () =>
    Effect.gen(function* () {
      const { asked, read } = pages(["a", "b", null]);
      const result = yield* readGraphQlPages(read, { nextCursor: (page) => page.next });
      expect(asked).toEqual([null, "a", "b"]);
      expect(result.truncated).toBe(false);
    }),
  );

  it.effect("stops as truncated at the page limit, at `until`, or on a repeated cursor", () =>
    Effect.gen(function* () {
      const limited = pages(["a", "b", "c"]);
      const atLimit = yield* readGraphQlPages(limited.read, {
        nextCursor: (page) => page.next,
        maxPages: 2,
      });
      expect(limited.asked).toEqual([null, "a"]);
      expect(atLimit.truncated).toBe(true);

      const enough = pages(["a", "b", "c"]);
      const satisfied = yield* readGraphQlPages(enough.read, {
        nextCursor: (page) => page.next,
        until: (read) => read.length === 1,
      });
      expect(enough.asked).toEqual([null]);
      expect(satisfied.truncated).toBe(true);

      const stuck = pages(["a", "a", "a"]);
      const repeated = yield* readGraphQlPages(stuck.read, {
        nextCursor: (page) => page.next,
        from: "start",
      });
      expect(stuck.asked).toEqual(["start", "a"]);
      expect(repeated.truncated).toBe(true);
    }),
  );
});
