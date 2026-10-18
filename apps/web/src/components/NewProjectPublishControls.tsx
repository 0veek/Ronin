import type { NewProjectPublishTarget } from "@t3tools/client-runtime/operations/projects";
import { useState } from "react";
import { Checkbox } from "./ui/checkbox";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

/** Host selection stays independent of the enclosing palette row's publish toggle. */
export function NewProjectPublishControls({
  targets,
  target,
  checked,
  disabled,
  onHostChange,
}: {
  targets: ReadonlyArray<NewProjectPublishTarget>;
  target: NewProjectPublishTarget;
  checked: boolean;
  disabled: boolean;
  onHostChange: (kind: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="ms-auto flex items-center gap-2">
      {targets.length > 1 ? (
        <Select
          disabled={disabled}
          open={open}
          onOpenChange={setOpen}
          value={target.definition.kind}
          onValueChange={(kind) => {
            if (kind !== null) onHostChange(kind);
          }}
        >
          <SelectTrigger
            size="xs"
            variant="ghost"
            aria-label="Host for the new repository"
            onClick={(event) => {
              event.stopPropagation();
              if (!disabled) setOpen(true);
            }}
          >
            <SelectValue>{target.definition.label}</SelectValue>
          </SelectTrigger>
          <SelectPopup
            align="end"
            alignItemWithTrigger={false}
            onClick={(event) => event.stopPropagation()}
          >
            {targets.map((candidate) => (
              <SelectItem
                key={candidate.definition.kind}
                value={candidate.definition.kind}
                hideIndicator
              >
                {candidate.definition.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      <span className="pointer-events-none flex">
        <Checkbox checked={checked} tabIndex={-1} aria-hidden />
      </span>
    </span>
  );
}
