import type { Automation, AutomationWebhookDeliveryId, EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function AutomationWebhookPanel({
  automation,
  environmentId,
  disabled,
  onChange,
}: {
  readonly automation: Automation;
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
  readonly onChange: () => void;
}) {
  const baseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const rotate = useAtomCommand(serverEnvironment.rotateAutomationWebhookToken, {
    label: "rotate webhook URL",
    reportFailure: false,
    reportDefect: false,
  });
  const path = automation.webhook?.path;
  const url = path && baseUrl ? new URL(path, baseUrl).href : (path ?? "");
  const rotateUrl = async () => {
    if (rotating) return;
    setRotating(true);
    setError(null);
    const result = await rotate({ environmentId, input: { id: automation.id } });
    setRotating(false);
    setCopied(false);
    if (result._tag === "Success") onChange();
    else setError("Could not replace the webhook URL. Try again.");
  };
  return (
    <div className="mb-4 space-y-2 rounded-lg border bg-muted/10 p-3">
      <label className="block space-y-1 text-xs font-medium">
        Webhook URL
        <Input readOnly value={url} aria-label={`Webhook URL for ${automation.title}`} />
      </label>
      <p className="text-xs text-muted-foreground">
        Requests to this URL can start the automation while this environment is reachable. Replacing
        the URL immediately disables the old one.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={!url || disabled}
          onClick={() => {
            void navigator.clipboard.writeText(url).then(
              () => setCopied(true),
              () => setError("Could not copy the URL. Select it and copy it manually."),
            );
          }}
        >
          {copied ? "Copied" : "Copy URL"}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled || rotating}
          onClick={() => void rotateUrl()}
        >
          {rotating ? "Replacing…" : "Replace URL"}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide deliveries" : "Recent deliveries"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {open ? <WebhookDeliveries automation={automation} environmentId={environmentId} /> : null}
    </div>
  );
}

function WebhookDeliveries({
  automation,
  environmentId,
}: {
  readonly automation: Automation;
  readonly environmentId: EnvironmentId;
}) {
  const deliveries = useEnvironmentQuery(
    serverEnvironment.automationWebhookDeliveries({ environmentId, input: { id: automation.id } }),
  );
  const [selected, setSelected] = useState<AutomationWebhookDeliveryId | null>(null);
  return (
    <div className="space-y-2 border-t pt-2">
      <div className="flex items-center justify-between text-xs font-medium">
        Recent deliveries
        <Button size="xs" variant="ghost" onClick={deliveries.refresh}>
          Refresh
        </Button>
      </div>
      {deliveries.error ? (
        <p role="alert" className="text-xs text-destructive">
          Could not load deliveries.
        </p>
      ) : null}
      {deliveries.data?.deliveries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No deliveries yet.</p>
      ) : null}
      {deliveries.data?.deliveries.map((delivery) => (
        <button
          key={delivery.id}
          type="button"
          className="flex w-full justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
          onClick={() => setSelected(selected === delivery.id ? null : delivery.id)}
          aria-expanded={selected === delivery.id}
        >
          <span>
            {new Date(delivery.receivedAt).toLocaleString()} · {delivery.method}
          </span>
          <span>{delivery.outcome.replaceAll("_", " ")}</span>
        </button>
      ))}
      {selected ? (
        <WebhookDeliveryDetail
          key={selected}
          environmentId={environmentId}
          automation={automation}
          deliveryId={selected}
        />
      ) : null}
    </div>
  );
}

function WebhookDeliveryDetail({
  environmentId,
  automation,
  deliveryId,
}: {
  readonly environmentId: EnvironmentId;
  readonly automation: Automation;
  readonly deliveryId: AutomationWebhookDeliveryId;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.automationWebhookDelivery({
      environmentId,
      input: { id: automation.id, deliveryId },
    }),
  );
  const delivery = query.data?.delivery;
  if (!delivery)
    return (
      <p className="text-xs text-muted-foreground">
        {query.error ? "Could not load this delivery." : "Loading delivery…"}
      </p>
    );
  return (
    <div className="space-y-2 rounded border p-2 text-xs">
      <p>
        {delivery.signatureVerified ? "Signature verified" : "No verified signature"} ·{" "}
        {delivery.bodyBytes.toLocaleString()} bytes
      </p>
      {delivery.error ? <p className="text-destructive">{delivery.error}</p> : null}
      {delivery.missingFields.length ? (
        <p>Missing fields: {delivery.missingFields.join(", ")}</p>
      ) : null}
      <details>
        <summary>Headers and query</summary>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all">
          {Object.entries(delivery.headers)
            .map(([name, value]) => `${name}: ${value}`)
            .join("\n")}
          {"\n\n"}
          {delivery.query}
        </pre>
      </details>
      <details>
        <summary>Request body{delivery.bodyTruncated ? " (truncated)" : ""}</summary>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all">{delivery.body}</pre>
      </details>
      <details>
        <summary>Prompt sent to the agent</summary>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words">
          {delivery.renderedPrompt ?? "No prompt was sent."}
        </pre>
      </details>
    </div>
  );
}
