import { AutomationCreateInput } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { draftSchedule, draftToCreateInput, isDraftComplete } from "./automationDraft";
import { AUTOMATION_RECIPES, draftFromAutomationRecipe } from "./automationRecipes";

const decodeCreateInput = Schema.decodeUnknownSync(AutomationCreateInput);

describe("automation recipes", () => {
  it.each(AUTOMATION_RECIPES)(
    "$title can be saved through the existing automation contract",
    (recipe) => {
      const draft = draftFromAutomationRecipe(recipe, "remote-project");
      expect(isDraftComplete(draft)).toBe(true);
      const input = decodeCreateInput(draftToCreateInput(draft));
      expect(input.projectId).toBe("remote-project");
      expect(input.modelSelection).toBeNull();
      expect(input.stopAfterConsecutiveFailures).toBe(3);
      expect(draft.editing).toBeNull();
    },
  );
  it("does not allow one draft's weekday edits to change later recipes", () => {
    const recipe = AUTOMATION_RECIPES[0];
    const first = draftFromAutomationRecipe(recipe, "a");
    const weekdays = first.weekdays as number[];
    weekdays.splice(0, weekdays.length, 6);
    expect(draftSchedule(draftFromAutomationRecipe(recipe, "b"))).toEqual({
      _tag: "daily",
      timeOfDay: 540,
      weekdays: [1, 2, 3, 4, 5],
    });
  });
});
