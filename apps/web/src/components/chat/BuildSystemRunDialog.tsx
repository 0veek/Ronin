/**
 * Launching a team against a task.
 *
 * The decision is small: which team, and what should they do. Everything
 * else — who leads, who is gated — was already chosen when the team was
 * saved.
 *
 * @module BuildSystemRunDialog
 */
import type { BuildSystem, BuildSystemId } from "@t3tools/contracts";
import { UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";

export function BuildSystemRunDialog({
  buildSystems,
  initialBuildSystemId,
  onOpenChange,
  onStart,
  open,
}: {
  readonly buildSystems: ReadonlyArray<BuildSystem>;
  readonly initialBuildSystemId?: BuildSystemId | string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onStart: (input: {
    readonly buildSystemId: BuildSystemId;
    readonly task: string;
  }) => void;
  readonly open: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>(
    initialBuildSystemId ?? buildSystems[0]?.id ?? "",
  );
  const [task, setTask] = useState("");
  const selected = useMemo(
    () => buildSystems.find((system) => system.id === selectedId) ?? buildSystems[0] ?? null,
    [buildSystems, selectedId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>Run a build system</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <p className="text-muted-foreground text-sm">
            The lead model will break this into work for the rest of the team. You can cancel the
            run at any time.
          </p>
          {buildSystems.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground text-sm">
              No teams yet. Create one in Settings → Build systems.
            </p>
          ) : (
            <>
              <label className="block space-y-1.5">
                <span className="font-medium text-xs">Team</span>
                <Select
                  value={selected?.id ?? ""}
                  onValueChange={(value) => setSelectedId(String(value))}
                >
                  <SelectTrigger className="w-full" aria-label="Build system">
                    <SelectValue>
                      <span className="inline-flex items-center gap-1.5">
                        <UsersIcon className="size-3.5 text-muted-foreground" />
                        {selected?.name ?? "Choose a team"}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {buildSystems.map((system) => (
                      <SelectItem hideIndicator key={system.id} value={system.id}>
                        {system.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </label>
              {selected !== null ? (
                <p className="text-muted-foreground text-2xs">
                  Lead: {selected.orchestrator.modelSelection.model}
                  {selected.teammates.length === 0
                    ? ""
                    : ` · ${selected.teammates.map((role) => role.name).join(", ")}`}
                </p>
              ) : null}
              <label className="block space-y-1.5">
                <span className="font-medium text-xs">Task</span>
                <Textarea
                  rows={5}
                  value={task}
                  placeholder="What should the team do?"
                  onChange={(event) => setTask(event.currentTarget.value)}
                />
              </label>
            </>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={selected === null || task.trim().length === 0}
            onClick={() => {
              if (selected === null || task.trim().length === 0) return;
              onStart({ buildSystemId: selected.id, task: task.trim() });
            }}
          >
            Start run
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
