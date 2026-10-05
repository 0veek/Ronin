import { FileTextIcon, ScanLineIcon, SunriseIcon, TestTubeDiagonalIcon } from "lucide-react";

import { AUTOMATION_RECIPES, type AutomationRecipe } from "~/automationRecipes";
import { formatWeekdays } from "~/automationPresentation";
import { Button } from "../ui/button";

const RECIPE_ICONS = {
  "morning-brief": SunriseIcon,
  "regression-patrol": ScanLineIcon,
  "test-gaps": TestTubeDiagonalIcon,
  "weekly-changelog": FileTextIcon,
};

export function AutomationRecipeGallery({
  onChoose,
}: {
  readonly onChoose: (recipe: AutomationRecipe) => void;
}) {
  return (
    <div className="space-y-3 p-3.5 sm:p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Start from a recipe</h3>
        <p className="text-xs text-muted-foreground">
          Choose a starting point, then customize the prompt, project, model, and schedule.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {AUTOMATION_RECIPES.map((recipe) => {
          const Icon = RECIPE_ICONS[recipe.id];
          return (
            <Button
              key={recipe.id}
              variant="outline"
              className="h-auto items-start justify-start gap-3 whitespace-normal p-3 text-left"
              onClick={() => onChoose(recipe)}
            >
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="space-y-1">
                <span className="block text-sm font-medium">{recipe.title}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">
                  {recipe.description}
                </span>
                <span className="block text-2xs text-secondary-label">
                  {formatWeekdays(recipe.weekdays)} at {recipe.timeOfDayText}
                  {recipe.envMode === "worktree" ? " · new worktree" : " · current checkout"}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
