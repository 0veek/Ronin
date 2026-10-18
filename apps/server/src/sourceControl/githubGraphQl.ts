import * as Effect from "effect/Effect";

/**
 * The pages of a GraphQL connection, read one after another from `from` (the first page by
 * default) until GitHub has no more, `until` is satisfied, or `maxPages` have been read. `read` is
 * handed the pages so far, for reads that size or check the next page by what has already arrived.
 *
 * `truncated` says pages remained when reading stopped. A cursor GitHub hands back a second time
 * would page forever, so it stops the read as truncated too.
 */
export const readGraphQlPages = <Page, E, R>(
  read: (after: string | null, pages: ReadonlyArray<Page>) => Effect.Effect<Page, E, R>,
  options: {
    readonly nextCursor: (page: NoInfer<Page>) => string | null;
    readonly from?: string | null;
    readonly maxPages?: number;
    readonly until?: (pages: ReadonlyArray<NoInfer<Page>>) => boolean;
  },
): Effect.Effect<{ readonly pages: ReadonlyArray<Page>; readonly truncated: boolean }, E, R> =>
  Effect.gen(function* () {
    const pages: Page[] = [];
    const seen = new Set<string>();
    let after = options.from ?? null;
    while (true) {
      const page: Page = yield* read(after, pages);
      pages.push(page);
      const next = options.nextCursor(page);
      if (next === null) return { pages, truncated: false };
      if (
        seen.has(next) ||
        pages.length >= (options.maxPages ?? Infinity) ||
        options.until?.(pages) === true
      ) {
        return { pages, truncated: true };
      }
      seen.add(next);
      after = next;
    }
  });
