import type {
  SourceControlProviderDiscoveryItem,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

import { AzureDevOpsIcon, BitbucketIcon, GitHubIcon, GitLabIcon } from "../Icons";

/**
 * The hosts a repository can be published to, and whether this machine is
 * currently able to publish to each.
 *
 * Shared by the publish dialog and by the git action menu that opens it: the
 * menu needs to know whether *any* provider is ready before it offers the
 * action at all, and the dialog needs the same answer per provider to explain
 * why a choice is unavailable. One definition so the two cannot disagree.
 */

export type PublishProviderKind = Extract<
  SourceControlProviderKind,
  "github" | "gitlab" | "bitbucket" | "azure-devops"
>;

export const PUBLISH_PROVIDER_OPTIONS = [
  {
    value: "github",
    label: "GitHub",
    description: "github.com",
    host: "github.com",
    pathPlaceholder: "owner/repo",
    Icon: GitHubIcon,
  },
  {
    value: "gitlab",
    label: "GitLab",
    description: "gitlab.com",
    host: "gitlab.com",
    pathPlaceholder: "group/project",
    Icon: GitLabIcon,
  },
  {
    value: "bitbucket",
    label: "Bitbucket",
    description: "bitbucket.org",
    host: "bitbucket.org",
    pathPlaceholder: "workspace/repository",
    Icon: BitbucketIcon,
  },
  {
    value: "azure-devops",
    label: "Azure DevOps",
    description: "dev.azure.com",
    host: "dev.azure.com",
    pathPlaceholder: "project/repository",
    Icon: AzureDevOpsIcon,
  },
] as const satisfies ReadonlyArray<{
  readonly value: PublishProviderKind;
  readonly label: string;
  readonly description: string;
  readonly host: string;
  readonly pathPlaceholder: string;
  readonly Icon: typeof GitHubIcon;
}>;

export function publishProviderOption(provider: PublishProviderKind) {
  return (
    PUBLISH_PROVIDER_OPTIONS.find((option) => option.value === provider) ??
    PUBLISH_PROVIDER_OPTIONS[0]
  );
}

export function isPublishProviderKind(
  provider: SourceControlProviderKind,
): provider is PublishProviderKind {
  return PUBLISH_PROVIDER_OPTIONS.some((option) => option.value === provider);
}

export function getPublishProviderReadiness(input: {
  provider: PublishProviderKind;
  sourceControlProviders: ReadonlyArray<SourceControlProviderDiscoveryItem>;
}): { readonly ready: boolean; readonly hint: string | null } {
  const discovered = input.sourceControlProviders.find(
    (provider) => provider.kind === input.provider,
  );
  if (!discovered) {
    return {
      ready: false,
      hint: "Provider status unavailable. Open Settings -> Source Control and rescan.",
    };
  }
  if (discovered.status !== "available") {
    return { ready: false, hint: discovered.installHint };
  }
  if (discovered.auth.status === "unauthenticated") {
    return {
      ready: false,
      hint:
        Option.getOrNull(discovered.auth.detail) ??
        `${discovered.label} is not authenticated. Open Settings -> Source Control for setup guidance.`,
    };
  }
  return { ready: true, hint: null };
}
