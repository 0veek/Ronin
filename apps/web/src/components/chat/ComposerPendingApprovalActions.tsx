import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
} from "@t3tools/contracts";
import { type ComponentProps, memo } from "react";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  /**
   * The choices the provider advertised for this request, in the order they
   * should read. Absent for the approval kinds whose answers are fixed, which
   * fall back to the four below.
   */
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

const DEFAULT_APPROVAL_OPTIONS = [
  { decision: "cancel", label: "Cancel turn" },
  { decision: "decline", label: "Decline" },
  { decision: "acceptForSession", label: "Always allow this session" },
  { decision: "accept", label: "Approve once" },
] satisfies ReadonlyArray<ProviderApprovalOption>;

/** Emphasis follows the decision, not its position, so a provider-supplied list still reads right. */
const APPROVAL_ACTION_VARIANT: Record<
  ProviderApprovalDecision,
  ComponentProps<typeof Button>["variant"]
> = {
  cancel: "ghost",
  decline: "destructive-outline",
  acceptForSession: "outline",
  acceptAlways: "outline",
  accept: "default",
};

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  options = DEFAULT_APPROVAL_OPTIONS,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  return (
    <>
      {options.map((option) => (
        <Button
          key={option.decision}
          size="sm"
          variant={APPROVAL_ACTION_VARIANT[option.decision]}
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, option.decision)}
        >
          <span className="max-w-40 truncate">{option.label}</span>
        </Button>
      ))}
    </>
  );
});
