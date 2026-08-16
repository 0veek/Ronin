import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DroidSettings } from "@t3tools/contracts";

import { buildInitialDroidProviderSnapshot } from "./DroidProvider.ts";

const decodeDroidSettings = Schema.decodeSync(DroidSettings);

describe("buildInitialDroidProviderSnapshot", () => {
  it.effect("does not make a model change cost a new thread", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialDroidProviderSnapshot(
        decodeDroidSettings({ enabled: true }),
      );
      // `DroidAdapter` applies the selection through `session/set_config_option`
      // at session start and again on every turn, and reports
      // `sessionModelSwitch: "in-session"`. Claiming a new thread is required
      // contradicts that, and also blocks handing a thread to or from Droid.
      expect(snapshot.requiresNewThreadForModelChange).toBeUndefined();
    }),
  );

  it.effect("reports a disabled provider without inventing a probe result", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialDroidProviderSnapshot(
        decodeDroidSettings({ enabled: false }),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.installed).toBe(false);
    }),
  );
});
