import type {
  EnvironmentId,
  ProjectId,
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestListState,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  CircleXIcon,
  EyeOffIcon,
  FolderGit2Icon,
  GitPullRequestDraftIcon,
  LayersIcon,
  ListFilterIcon,
  LoaderIcon,
  SearchIcon,
  TagIcon,
  UserRoundIcon,
} from "lucide-react";
import { type ElementType, useState } from "react";

import { cn } from "~/lib/utils";
import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";
import { ProjectFavicon } from "../ProjectFavicon";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { pullRequestProjectKey } from "./pullRequestList.logic";

import {
  Menu,
  MenuCheckboxItem,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  pullRequestLabelColor,
  type PullRequestAuthorFacet,
  type PullRequestLabelFacet,
} from "./pullRequestList.logic";
import { PullRequestActorAvatar } from "./pullRequestPresentation";

export interface PullRequestFilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  /** Uses the option's native icon tone. */
  readonly Icon: ElementType<{ className?: string }>;
  readonly favicon?: {
    readonly environmentId: EnvironmentId;
    readonly cwd: string;
  };
  /** Why it cannot be chosen, carried onto the item as its title. */
  readonly unavailable?: string | undefined;
}

export function PullRequestFilterOptionIcon<Value extends string>({
  option,
}: {
  option: PullRequestFilterOption<Value>;
}) {
  return option.favicon ? (
    <ProjectFavicon
      environmentId={option.favicon.environmentId}
      cwd={option.favicon.cwd}
      fallbackIcon={FolderGit2Icon}
      className="size-3.5"
    />
  ) : (
    <option.Icon aria-hidden className="size-3.5" />
  );
}

export interface PullRequestExpectedHost {
  readonly host: string;
  readonly kind: SourceControlProviderKind;
}

/**
 * What to call a host in the row. The provider's own name reads best — "GitHub" over
 * "github.com" — but it stops naming anything once a workspace has two hosts of one kind, so
 * those wear the host itself instead. Only the ambiguous ones: a lone GitLab beside two GitHub
 * installs is still "GitLab".
 */
export function pullRequestHostLabel(
  entries: ReadonlyArray<{ readonly host: string; readonly kind: SourceControlProviderKind }>,
  entry: { readonly host: string; readonly kind: SourceControlProviderKind },
): string {
  const sharing = entries.filter((candidate) => candidate.kind === entry.kind);
  return sharing.length > 1
    ? entry.host
    : getSourceControlPresentationForKind(entry.kind).providerName;
}

export function PullRequestSearchInput({
  value,
  busy,
  onChange,
}: {
  value: string;
  /** A search is on its way to the hosts, said where the typing is rather than over the list. */
  busy?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      {busy ? (
        <LoaderIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      ) : (
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
      )}
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="Search pull requests, or label:bug"
        aria-label="Search pull requests"
        // Tracks the shared input's height at both widths, so it stays level with the icon
        // button beside it rather than towering over it on wide screens.
        className="h-9 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 sm:h-8"
      />
    </div>
  );
}

/**
 * List narrowings live behind one filter control, separate from sorting. The trigger carries a
 * count whenever any filter is off its default, so a narrowed list is never a mystery.
 */
const ALL_PROJECTS_VALUE = "all";
/** MenuRadioGroup wants a string, so "every host" wears the one value no host can be. */
const ALL_HOSTS_VALUE = "";
/** The same trick for the servers, which are named by an id no empty string can collide with. */
const ALL_SERVERS_VALUE = "";
/** The unset value of each narrowing group, which no filter of theirs is named after. */
const UNFILTERED_VALUE = "all";
const DRAFT_OPTIONS = [
  { value: UNFILTERED_VALUE, label: "All", Icon: LayersIcon },
  { value: "only", label: "Drafts only", Icon: GitPullRequestDraftIcon },
  { value: "hide", label: "Hide drafts", Icon: EyeOffIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

const REVIEW_OPTIONS = [
  { value: UNFILTERED_VALUE, label: "All", Icon: LayersIcon },
  { value: "approved", label: "Approved", Icon: CircleCheckIcon },
  { value: "changes-requested", label: "Changes requested", Icon: CircleXIcon },
  { value: "review-required", label: "Review required", Icon: CircleDashedIcon },
  { value: "none", label: "No reviews", Icon: CircleSlashIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

const CHECKS_OPTIONS = [
  { value: UNFILTERED_VALUE, label: "All", Icon: LayersIcon },
  { value: "passing", label: "Passing", Icon: CircleCheckIcon },
  { value: "failing", label: "Failing", Icon: CircleXIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

function PullRequestFilterRadioGroup<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  onChange: (value: Value) => void;
}) {
  return (
    <MenuRadioGroup
      value={value}
      onValueChange={(next) => {
        if (next !== value) onChange(next as Value);
      }}
    >
      <MenuGroupLabel>{label}</MenuGroupLabel>
      {options.map((option) => {
        // A host the server has already said it cannot read is not a choice here: offering
        // it would answer the press by replacing a working list with that failure.
        const item = (
          <MenuRadioItem
            key={option.value}
            value={option.value}
            className={option.unavailable ? "data-disabled:pointer-events-auto" : undefined}
            disabled={option.unavailable !== undefined}
          >
            <span className="flex min-w-0 items-center gap-2">
              <PullRequestFilterOptionIcon option={option} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.unavailable ? <span className="shrink-0">· Unavailable</span> : null}
            </span>
          </MenuRadioItem>
        );
        if (!option.unavailable) return item;
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger render={item} />
            <TooltipPopup side="top" className="max-w-80">
              {option.unavailable}
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </MenuRadioGroup>
  );
}

function PullRequestFilterRadioSubmenu<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  onChange: (value: Value) => void;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  if (!current) return null;
  return (
    <MenuSub>
      <MenuSubTrigger>
        <PullRequestFilterOptionIcon option={current} />
        <span className="flex-1">{label}</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {current.label}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup className="min-w-56">
        <PullRequestFilterRadioGroup
          label={label}
          value={value}
          options={options}
          onChange={onChange}
        />
      </MenuSubPopup>
    </MenuSub>
  );
}

function PullRequestAuthorFilter({
  value,
  options,
  onChange,
}: {
  value: string | undefined;
  options: ReadonlyArray<PullRequestAuthorFacet>;
  onChange: (author: string | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const login = value?.toLowerCase() ?? "";
  const selected = options.find((option) => option.actor.login.toLowerCase() === login);
  const visible = [
    ...(selected ? [selected] : []),
    ...options.filter(
      (option) =>
        option !== selected &&
        (needle.length === 0 ||
          option.actor.login.toLowerCase().includes(needle) ||
          option.actor.name?.toLowerCase().includes(needle)),
    ),
  ].slice(0, 10);
  const select = (next: string) => next.toLowerCase() !== login && onChange(next || undefined);
  return (
    <MenuSub>
      <MenuSubTrigger>
        <UserRoundIcon aria-hidden className="size-3.5" />
        <span className="flex-1">Author</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {value ?? "Anyone"}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup className="w-80">
        <div className="p-1 pb-2">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              size="sm"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "Escape") event.stopPropagation();
              }}
              placeholder="Search authors"
              aria-label="Search authors"
            />
          </InputGroup>
        </div>
        <MenuRadioGroup value={selected?.actor.login ?? value ?? ""} onValueChange={select}>
          <MenuRadioItem value="">
            <span className="flex min-w-0 items-center gap-2">
              <LayersIcon aria-hidden className="size-3.5" />
              Anyone
            </span>
          </MenuRadioItem>
          {visible.map((option) => (
            <MenuRadioItem key={option.actor.login.toLowerCase()} value={option.actor.login}>
              <span className="flex min-w-0 items-center gap-2">
                <PullRequestActorAvatar actor={option.actor} />
                <span className="min-w-0 flex-1 truncate">{option.actor.login}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {option.mergedCount} merges loaded
                </span>
              </span>
            </MenuRadioItem>
          ))}
          {visible.length === 0 ? <MenuItem disabled>No authors found</MenuItem> : null}
        </MenuRadioGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}

function PullRequestLabelFilter({
  value,
  options,
  onChange,
}: {
  value: ReadonlyArray<string>;
  options: ReadonlyArray<PullRequestLabelFacet>;
  onChange: (labels: ReadonlyArray<string>) => void;
}) {
  const selected = new Set(value.map((name) => name.toLowerCase()));
  const visible = [
    ...value
      .filter((name) => !options.some((option) => option.name.toLowerCase() === name.toLowerCase()))
      .map((name) => ({ name, color: null, count: 0 })),
    ...options,
  ];
  return (
    <MenuSub>
      <MenuSubTrigger>
        <TagIcon aria-hidden className="size-3.5" />
        <span className="flex-1">Labels</span>
        <span className="text-xs text-muted-foreground">
          {value.length === 0 ? "Any" : `${value.length} selected`}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup className="w-72">
        {visible.length === 0 ? (
          <MenuItem disabled>No labels in this view</MenuItem>
        ) : (
          visible.map((option) => {
            const key = option.name.toLowerCase();
            const checked = selected.has(key);
            const dot = pullRequestLabelColor(option.color);
            return (
              <MenuCheckboxItem
                key={key}
                className="grid-cols-[1rem_minmax(0,1fr)]"
                checked={checked}
                onCheckedChange={(next) =>
                  onChange(
                    next
                      ? [...value, option.name]
                      : value.filter((name) => name.toLowerCase() !== option.name.toLowerCase()),
                  )
                }
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full bg-muted-foreground"
                    {...(dot ? { style: { backgroundColor: dot } } : {})}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {option.count}
                  </span>
                </span>
              </MenuCheckboxItem>
            );
          })
        )}
      </MenuSubPopup>
    </MenuSub>
  );
}

const NO_AUTHOR_FACETS: ReadonlyArray<PullRequestAuthorFacet> = [];
const NO_LABEL_FACETS: ReadonlyArray<PullRequestLabelFacet> = [];

export function PullRequestFiltersMenu({
  onOpenChange,
  state,
  stateOptions,
  onState,
  involvement,
  involvementOptions,
  onInvolvement,
  filters,
  onFilters,
  authorOptions = NO_AUTHOR_FACETS,
  labelOptions = NO_LABEL_FACETS,
  host,
  hostOptions,
  onHost,
  server,
  serverOptions,
  onServer,
  projects,
  projectId,
  projectEnvironmentId,
  unavailable,
  onProject,
}: {
  onOpenChange?: (open: boolean) => void;
  state: PullRequestListState;
  stateOptions: ReadonlyArray<PullRequestFilterOption<PullRequestListState>>;
  onState: (state: PullRequestListState) => void;
  involvement: PullRequestInvolvement;
  involvementOptions: ReadonlyArray<PullRequestFilterOption<PullRequestInvolvement>>;
  onInvolvement: (involvement: PullRequestInvolvement) => void;
  /** The narrowings beyond state and involvement; an absent field is that group unfiltered. */
  filters: PullRequestListFilters;
  onFilters: (filters: PullRequestListFilters) => void;
  authorOptions?: ReadonlyArray<PullRequestAuthorFacet>;
  labelOptions?: ReadonlyArray<PullRequestLabelFacet>;
  host: string | undefined;
  /**
   * Includes the "all hosts" entry, whose value is the empty string. With fewer than two real
   * hosts there is nothing to switch between, so the whole group stays out of the menu.
   */
  hostOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onHost: (host: string | undefined) => void;
  server: EnvironmentId | undefined;
  /**
   * Includes the "all servers" entry, whose value is the empty string. With one server there is
   * nothing to switch between, so the whole group stays out of the menu.
   */
  serverOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onServer: (server: EnvironmentId | undefined) => void;
  /** The projects of every connected environment, each carrying the one its favicon is read from. */
  projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly environmentId: EnvironmentId;
    readonly title: string;
    readonly workspaceRoot: string;
  }>;
  projectId: ProjectId | undefined;
  /**
   * The server the selected project belongs to. A project id is only unique within its own
   * server, so without this two rows sharing an id would both read as checked here.
   */
  projectEnvironmentId: EnvironmentId | undefined;
  /**
   * Projects whose repository could not be read this time round. They are named here, where
   * the reader is already choosing between projects, rather than as a count above the list
   * that says something is missing without saying which.
   */
  unavailable: ReadonlyMap<string, string>;
  /** The environment comes with the project id, since picking a row picks a specific server's copy of it. */
  onProject: (projectId: ProjectId | undefined, environmentId: EnvironmentId | undefined) => void;
}) {
  const filtered =
    state !== "open" ||
    involvement !== "all" ||
    host !== undefined ||
    server !== undefined ||
    projectId !== undefined ||
    Object.keys(filters).length > 0;
  /**
   * Rebuilt rather than spread so an unfiltered group leaves the record instead of lingering in
   * it as an explicit `undefined`, which the listing input does not accept.
   */
  const withFilter = (key: keyof PullRequestListFilters, value: string): PullRequestListFilters =>
    Object.fromEntries(
      Object.entries({ ...filters, [key]: value === UNFILTERED_VALUE ? undefined : value }).filter(
        ([, held]) => held !== undefined,
      ),
    ) as PullRequestListFilters;
  /** Same rebuild rule as `withFilter`, for the groups that write more than one key. */
  const updateFilters = (next: Partial<PullRequestListFilters>): void => {
    onFilters(
      Object.fromEntries(
        Object.entries({ ...filters, ...next }).filter(([, held]) => held !== undefined),
      ) as PullRequestListFilters,
    );
  };
  const selectedLabels = (filters.labels ?? []).flatMap((group) => group);
  return (
    <Menu onOpenChange={onOpenChange}>
      <MenuTrigger
        className={cn(
          // The icon-button size that pairs with a full-height input, so the two read as one strip.
          "relative inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground sm:size-8",
          filtered && "text-foreground",
        )}
        aria-label="Filter pull requests"
      >
        <ListFilterIcon className="size-4" />
        {filtered ? (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
          />
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" className="min-w-56">
        <PullRequestFilterRadioGroup
          label="State"
          value={state}
          options={stateOptions}
          onChange={onState}
        />
        <MenuSeparator />
        <PullRequestFilterRadioGroup
          label="Involvement"
          value={involvement}
          options={involvementOptions}
          onChange={onInvolvement}
        />
        <MenuSeparator />
        <PullRequestAuthorFilter
          value={filters.author}
          options={authorOptions}
          onChange={(author) => updateFilters({ author })}
        />
        <PullRequestLabelFilter
          value={selectedLabels}
          options={labelOptions}
          onChange={(labels) =>
            updateFilters({
              labels: labels.length === 0 ? undefined : labels.slice(0, 10).map((label) => [label]),
            })
          }
        />
        <MenuSeparator />
        <PullRequestFilterRadioGroup
          label="Draft"
          value={filters.draft ?? UNFILTERED_VALUE}
          options={DRAFT_OPTIONS}
          onChange={(next) => onFilters(withFilter("draft", next))}
        />
        <MenuSeparator />
        <PullRequestFilterRadioGroup
          label="Review"
          value={filters.review ?? UNFILTERED_VALUE}
          options={REVIEW_OPTIONS}
          onChange={(next) => onFilters(withFilter("review", next))}
        />
        <MenuSeparator />
        <PullRequestFilterRadioGroup
          label="Checks"
          value={filters.checks ?? UNFILTERED_VALUE}
          options={CHECKS_OPTIONS}
          onChange={(next) => onFilters(withFilter("checks", next))}
        />
        {hostOptions.length > 2 ? (
          <>
            <MenuSeparator />
            <PullRequestFilterRadioGroup
              label="Host"
              value={host ?? ALL_HOSTS_VALUE}
              options={hostOptions}
              onChange={(next) => onHost(next === ALL_HOSTS_VALUE ? undefined : next)}
            />
          </>
        ) : null}
        {serverOptions.length > 2 ? (
          <>
            <MenuSeparator />
            <PullRequestFilterRadioSubmenu
              label="Server"
              value={server ?? ALL_SERVERS_VALUE}
              options={serverOptions}
              onChange={(next) =>
                onServer(next === ALL_SERVERS_VALUE ? undefined : (next as EnvironmentId))
              }
            />
          </>
        ) : null}
        <MenuSeparator />
        <MenuRadioGroup
          value={
            projectId === undefined || projectEnvironmentId === undefined
              ? ALL_PROJECTS_VALUE
              : pullRequestProjectKey({ id: projectId, environmentId: projectEnvironmentId })
          }
          onValueChange={(next) => {
            if (next === ALL_PROJECTS_VALUE) {
              if (projectId !== undefined) onProject(undefined, undefined);
              return;
            }
            // The value carries both halves, since the id alone cannot tell two servers' rows
            // apart once they share one.
            const project = projects.find((candidate) => pullRequestProjectKey(candidate) === next);
            if (
              project !== undefined &&
              (project.id !== projectId || project.environmentId !== projectEnvironmentId)
            ) {
              onProject(project.id, project.environmentId);
            }
          }}
        >
          <MenuGroupLabel>Project</MenuGroupLabel>
          <MenuRadioItem value={ALL_PROJECTS_VALUE}>
            <span className="flex min-w-0 items-center gap-2">
              <LayersIcon aria-hidden className="size-3.5" />
              All projects
            </span>
          </MenuRadioItem>
          {/* The ones that can be chosen first: a list that opens with three disabled rows reads
              as a broken menu rather than as a workspace with three unreadable repositories. */}
          {projects
            .toSorted(
              (left, right) =>
                Number(unavailable.has(pullRequestProjectKey(left))) -
                Number(unavailable.has(pullRequestProjectKey(right))),
            )
            .map((project) => {
              const reason = unavailable.get(pullRequestProjectKey(project));
              const item = (
                <MenuRadioItem
                  key={pullRequestProjectKey(project)}
                  value={pullRequestProjectKey(project)}
                  className={reason !== undefined ? "data-disabled:pointer-events-auto" : undefined}
                  disabled={reason !== undefined}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <ProjectFavicon
                      environmentId={project.environmentId}
                      cwd={project.workspaceRoot}
                      fallbackIcon={FolderGit2Icon}
                      className="size-3.5 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{project.title}</span>
                    {reason === undefined ? null : (
                      <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-px text-2xs font-medium text-warning-foreground">
                        Unavailable
                      </span>
                    )}
                  </span>
                </MenuRadioItem>
              );
              if (reason === undefined) return item;
              return (
                <Tooltip key={pullRequestProjectKey(project)}>
                  <TooltipTrigger render={item} />
                  <TooltipPopup side="top" className="max-w-80">
                    {reason}
                  </TooltipPopup>
                </Tooltip>
              );
            })}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
