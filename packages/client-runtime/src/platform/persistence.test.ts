import { OrchestrationShellSnapshot, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { encodeShellSnapshotForCache } from "./persistence.ts";

const encodeSnapshot = Schema.encodeEffect(OrchestrationShellSnapshot);

describe("encodeShellSnapshotForCache", () => {
  it.effect("preserves the cache schema's project icon encoding", () =>
    Effect.gen(function* () {
      const snapshot: OrchestrationShellSnapshot = {
        snapshotSequence: 1,
        projects: [
          {
            id: ProjectId.make("monogram"),
            title: "Monogram",
            workspaceRoot: "/tmp/monogram",
            defaultModelSelection: null,
            scripts: [],
            projectIcon: { kind: "monogram", text: "क्ष्म", color: "violet" },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        threads: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      expect(yield* encodeShellSnapshotForCache(snapshot)).toEqual(yield* encodeSnapshot(snapshot));
    }),
  );
});
