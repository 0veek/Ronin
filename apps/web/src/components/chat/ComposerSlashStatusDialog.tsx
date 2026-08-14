import { useMemo } from "react";

import { PROVIDER_LABEL, RATE_LIMIT_WINDOW_LABEL } from "@t3tools/shared/providerVocabulary";

import {
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
  formatProviderDisplayName,
} from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { useProviderRateLimits } from "~/state/rateLimits";
import type { Thread } from "~/types";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

function formatResetsAt(resetsAt: string | null): string | null {
  if (resetsAt === null) return null;
  const parsed = new Date(resetsAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ComposerSlashStatusDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thread: Thread | undefined;
  providerDisplayName?: string | null;
}) {
  const usage = useMemo(
    () => deriveLatestContextWindowSnapshot(props.thread?.activities ?? []),
    [props.thread?.activities],
  );
  const rateLimits = useProviderRateLimits();
  const providerName =
    props.providerDisplayName ??
    formatProviderDisplayName(props.thread?.session?.providerInstanceId ?? null);
  const usedPercentage = usage?.usedPercentage ?? null;
  const normalizedPercentage = Math.max(0, Math.min(100, usedPercentage ?? 0));

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle>Thread status</DialogTitle>
          <DialogDescription>
            Context window and subscription quota for this environment.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-semibold tracking-[0.08em] text-secondary-label uppercase">
                Context
              </h3>
              {providerName ? (
                <span className="text-2xs text-secondary-label">{providerName}</span>
              ) : null}
            </div>
            {usage ? (
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="flex items-end justify-between gap-3">
                  <div className="font-medium text-foreground">
                    {usedPercentage === null
                      ? formatContextWindowTokens(usage.usedTokens)
                      : `${Math.round(normalizedPercentage)}% used`}
                  </div>
                  {usage.maxTokens != null ? (
                    <div className="text-2xs tabular-nums text-secondary-label">
                      {formatContextWindowTokens(usage.usedTokens)}/
                      {formatContextWindowTokens(usage.maxTokens)}
                    </div>
                  ) : null}
                </div>
                {usage.maxTokens !== null ? (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full origin-left rounded-full bg-foreground/70"
                      style={{ scale: `${normalizedPercentage / 100} 1` }}
                    />
                  </div>
                ) : null}
                {usage.compactsAutomatically ? (
                  <p className="mt-3 text-2xs leading-4 text-secondary-label">
                    This provider compacts context automatically when the window fills.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-secondary-label">
                No context usage has been reported for this thread yet.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold tracking-[0.08em] text-secondary-label uppercase">
              Rate limits
            </h3>
            {rateLimits.error ? (
              <p className="text-sm text-secondary-label">{rateLimits.error}</p>
            ) : rateLimits.providers.length === 0 ? (
              <p className="text-sm text-secondary-label">
                Subscription quota is unavailable until a supported provider is signed in.
              </p>
            ) : (
              <div className="space-y-2">
                {rateLimits.providers.map((entry) => (
                  <div
                    key={entry.provider}
                    className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="font-medium">{PROVIDER_LABEL[entry.provider]}</div>
                      {entry.planLabel ? (
                        <div className="text-2xs text-secondary-label">{entry.planLabel}</div>
                      ) : null}
                    </div>
                    {entry.status !== "ok" || entry.windows.length === 0 ? (
                      <p className="mt-1 text-xs text-secondary-label">
                        {entry.message ?? "No quota reported."}
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {entry.windows.map((window) => {
                          const reset = formatResetsAt(window.resetsAt);
                          const critical = window.usedPercent >= 90;
                          return (
                            <li
                              key={`${entry.provider}:${window.kind}`}
                              className="flex items-center justify-between gap-3 text-xs"
                            >
                              <span className="text-secondary-label">
                                {RATE_LIMIT_WINDOW_LABEL[window.kind]}
                                {reset ? ` · resets ${reset}` : ""}
                              </span>
                              <span
                                className={cn(
                                  "tabular-nums font-medium",
                                  critical ? "text-destructive" : "text-foreground",
                                )}
                              >
                                {Math.round(window.usedPercent)}%
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
