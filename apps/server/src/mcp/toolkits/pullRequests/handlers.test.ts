import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import { OrchestrationCommandInvariantError } from "../../../orchestration/Errors.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { listThreadPullRequests, PullRequestsToolkitHandlersLive } from "./handlers.ts";
import { PullRequestLinkFailedError, PullRequestsToolkit } from "./tools.ts";

const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");
const OTHER_THREAD_ID = ThreadId.make("thread-2");
const OTHER_PROJECT_ID = ProjectId.make("project-2");

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(7),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: THREAD_ID,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

function makeProject(
  repositoryIdentity: OrchestrationProjectShell["repositoryIdentity"] = {
    canonicalKey: "github.com/t3tools/t3code",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "git@github.com:T3Tools/T3Code.git",
    },
    provider: "github",
    displayName: "T3Tools/T3Code",
    owner: "T3Tools",
    name: "T3Code",
  },
): OrchestrationProjectShell {
  return {
    id: PROJECT_ID,
    title: "Project",
    workspaceRoot: "/workspace/project",
    defaultModelSelection: null,
    scripts: [],
    repositoryIdentity,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function makeThread(pullRequests: ReadonlyArray<ThreadPullRequestLink>): OrchestrationThreadShell {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests,
    latestTurn: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: "2026-08-20T00:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function makeLink(
  number: number,
  overrides: Partial<ThreadPullRequestLink> & {
    readonly headBranch?: string;
    readonly baseBranch?: string;
  } = {},
): ThreadPullRequestLink {
  const { headBranch, baseBranch, ...rest } = overrides;
  return {
    host: "github.com",
    repository: "t3tools/t3code",
    number,
    url: `https://github.com/t3tools/t3code/pull/${number}`,
    source: "manual",
    linkedAt: "2026-08-10T00:00:00.000Z",
    snapshot:
      headBranch === undefined
        ? null
        : {
            state: "open",
            title: `PR ${number}`,
            headBranch,
            baseBranch: baseBranch ?? "main",
            isDraft: false,
            updatedAt: null,
            syncedAt: "2026-08-27T00:00:00.000Z",
          },
    stack: null,
    ...rest,
  };
}

interface HarnessOptions {
  readonly thread?: OrchestrationThreadShell | null;
  readonly project?: OrchestrationProjectShell | null;
  readonly otherThread?: OrchestrationThreadShell;
  readonly otherProject?: OrchestrationProjectShell;
  readonly reject?: (command: OrchestrationCommand) => OrchestrationCommandInvariantError | null;
}

const makeHarness = Effect.fn("makePullRequestsToolkitHarness")(function* (
  options: HarnessOptions = {},
) {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  const thread = options.thread === undefined ? makeThread([]) : options.thread;
  const project = options.project === undefined ? makeProject() : options.project;
  const dispatch: OrchestrationEngineShape["dispatch"] = (command) =>
    Effect.gen(function* () {
      const rejection = options.reject?.(command) ?? null;
      if (rejection !== null) return yield* rejection;
      yield* Ref.update(commands, (recorded) => [...recorded, command]);
      return { sequence: 1 };
    });
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: (threadId) =>
        Effect.succeed(
          Option.fromNullishOr(
            threadId === THREAD_ID
              ? thread
              : threadId === options.otherThread?.id
                ? options.otherThread
                : undefined,
          ),
        ),
      getProjectShellById: (projectId) =>
        Effect.succeed(
          Option.fromNullishOr(projectId === PROJECT_ID ? project : options.otherProject),
        ),
    }),
    Layer.mock(OrchestrationEngineService)({
      readEvents: () => Stream.empty,
      dispatch,
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    }),
    Layer.succeed(Crypto.Crypto, testCrypto),
  );
  const toolkit = yield* PullRequestsToolkit.pipe(
    Effect.provide(PullRequestsToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const call = <Name extends keyof typeof PullRequestsToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["pull-requests"],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      // Failure mode is "error", so a delivered result is always the success shape.
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof PullRequestsToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
      Effect.provide(dependencies),
    );
  return { commands, call };
});

describe("pull request toolkit handlers", () => {
  const activeCaller = (): OrchestrationThreadShell => ({
    ...makeThread([]),
    latestTurn: {
      turnId: TurnId.make("caller-turn"),
      state: "running",
      requestedAt: "2026-08-20T00:00:00.000Z",
      startedAt: "2026-08-20T00:00:00.000Z",
      completedAt: null,
      assistantMessageId: null,
    },
  });
  const otherThread = (): OrchestrationThreadShell => ({
    ...makeThread([makeLink(7)]),
    id: OTHER_THREAD_ID,
    projectId: OTHER_PROJECT_ID,
  });

  it.effect("reads an explicit thread in another project without changing it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ otherThread: otherThread() });
      const result = yield* harness.call("list_thread_pull_requests", {
        threadId: OTHER_THREAD_ID,
      });
      expect(result.pullRequests.map((link) => link.number)).toEqual([7]);
      expect(yield* Ref.get(harness.commands)).toEqual([]);
      const missing = yield* harness
        .call("list_thread_pull_requests", { threadId: ThreadId.make("deleted-thread") })
        .pipe(Effect.flip);
      expect(missing).toMatchObject({
        _tag: "PullRequestThreadNotFoundError",
        threadId: "deleted-thread",
      });
    }),
  );

  it.effect("links and unlinks on an explicit thread using that thread's project host", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        thread: activeCaller(),
        otherThread: otherThread(),
        otherProject: {
          ...makeProject({
            canonicalKey: "gitlab.com/team/other",
            locator: {
              source: "git-remote",
              remoteName: "origin",
              remoteUrl: "git@gitlab.com:team/other.git",
            },
            provider: "gitlab",
            displayName: "team/other",
          }),
          id: OTHER_PROJECT_ID,
        },
      });
      const target = { threadId: OTHER_THREAD_ID, repository: "team/other", number: 12 };
      const linked = yield* harness.call("link_pull_request", target);
      expect(linked.url).toBe("https://gitlab.com/team/other/-/merge_requests/12");
      yield* harness.call("unlink_pull_request", target);
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        { type: "thread.pull-request.link", threadId: OTHER_THREAD_ID, host: "gitlab.com" },
        { type: "thread.pull-request.unlink", threadId: OTHER_THREAD_ID, host: "gitlab.com" },
      ]);
    }),
  );

  const blockedCallers: ReadonlyArray<[string, Partial<OrchestrationThreadShell> | null]> = [
    ["missing", null],
    ["idle", { latestTurn: null }],
    ["finished", { latestTurn: { ...activeCaller().latestTurn!, state: "completed" } }],
    ["archived", { archivedAt: "2026-08-20T01:00:00.000Z" }],
    [
      "a different provider",
      { modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" } },
    ],
    ["approval-required", { runtimeMode: "approval-required" }],
    ["auto-accept-edits", { runtimeMode: "auto-accept-edits" }],
    ["auto", { runtimeMode: "auto" }],
    ["plan mode", { interactionMode: "plan" }],
  ];
  for (const [description, override] of blockedCallers) {
    it.effect(`blocks cross-thread writes from ${description} callers`, () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          thread: override === null ? null : { ...activeCaller(), ...override },
          otherThread: otherThread(),
        });
        for (const tool of ["link_pull_request", "unlink_pull_request"] as const) {
          const error = yield* harness
            .call(tool, { threadId: OTHER_THREAD_ID, url: "https://github.com/team/repo/pull/12" })
            .pipe(Effect.flip);
          expect(error).toMatchObject({
            _tag: "PullRequestThreadAboveLimitsError",
            threadId: OTHER_THREAD_ID,
          });
        }
        expect(yield* Ref.get(harness.commands)).toEqual([]);
      }),
    );
  }

  it.effect("allows writes within the caller's modes, including Ronin debug mode", () =>
    Effect.gen(function* () {
      for (const [callerMode, targetMode] of [
        ["approval-required", "approval-required"],
        ["auto-accept-edits", "approval-required"],
        ["auto", "auto-accept-edits"],
        ["full-access", "auto"],
      ] as const) {
        const harness = yield* makeHarness({
          thread: { ...activeCaller(), runtimeMode: callerMode, interactionMode: "debug" },
          otherThread: { ...otherThread(), runtimeMode: targetMode },
        });
        yield* harness.call("link_pull_request", {
          threadId: OTHER_THREAD_ID,
          url: "https://github.com/team/repo/pull/12",
        });
        expect(yield* Ref.get(harness.commands)).toHaveLength(1);
      }
    }),
  );

  it.effect("refuses a credential without the pull-requests capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("list_thread_pull_requests", {}, ["preview"])
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "McpCapabilityUnavailableError",
        capability: "pull-requests",
        threadId: THREAD_ID,
      });
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }),
  );

  it.effect("links by URL with source agent on the token's thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("link_pull_request", {
        url: "https://github.com/T3Tools/T3Code/pull/123/files",
      });
      expect(result).toEqual({
        host: "github.com",
        repository: "t3tools/t3code",
        number: 123,
        url: "https://github.com/T3Tools/T3Code/pull/123/files",
        alreadyLinked: false,
      });
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        {
          type: "thread.pull-request.link",
          threadId: THREAD_ID,
          host: "github.com",
          repository: "t3tools/t3code",
          number: 123,
          source: "agent",
        },
      ]);
    }),
  );

  it.effect("links by repository and number, defaulting the host to the project's", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("link_pull_request", {
        repository: "T3Tools/Other",
        number: 7,
      });
      expect(result).toEqual({
        host: "github.com",
        repository: "t3tools/other",
        number: 7,
        url: "https://github.com/t3tools/other/pull/7",
        alreadyLinked: false,
      });
    }),
  );

  it.effect("builds the URL in the project host's own shape", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        project: makeProject({
          canonicalKey: "gitlab.com/group/sub/project",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "git@gitlab.com:group/sub/project.git",
          },
          provider: "gitlab",
          displayName: "group/sub/project",
        }),
      });
      const result = yield* harness.call("link_pull_request", {
        repository: "group/sub/project",
        number: 42,
      });
      expect(result.url).toBe("https://gitlab.com/group/sub/project/-/merge_requests/42");
      expect(result.host).toBe("gitlab.com");
    }),
  );

  it.effect("links a numeric Forgejo reference with its remote's web origin and mount path", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        project: makeProject({
          canonicalKey: "forge.example/git/owner/repo",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "http://forge.example:3000/git/owner/repo.git",
          },
          provider: "forgejo",
          displayName: "git/owner/repo",
        }),
      });
      const result = yield* harness.call("link_pull_request", {
        repository: "git/owner/repo",
        number: 42,
      });
      expect(result).toEqual({
        host: "forge.example:3000",
        repository: "git/owner/repo",
        number: 42,
        url: "http://forge.example:3000/git/owner/repo/pulls/42",
        alreadyLinked: false,
      });
      const other = yield* harness.call("link_pull_request", {
        host: "other.example",
        repository: "owner/repo",
        number: 42,
      });
      expect(other.url).toBe("https://other.example/owner/repo/pull/42");
    }),
  );

  it.effect("rejects a target that names neither a URL nor repository and number", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("link_pull_request", { repository: "x/y" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "PullRequestTargetIncompleteError" });
      const unknown = yield* harness
        .call("link_pull_request", {
          url: "https://github.com/t3tools/t3code/issues/1?token=private-value",
        })
        .pipe(Effect.flip);
      expect(unknown).toMatchObject({ _tag: "PullRequestUrlInvalidError" });
      expect(unknown.message).not.toContain("private-value");
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }),
  );

  it.effect("treats a duplicate link as alreadyLinked rather than an error", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        thread: makeThread([makeLink(123)]),
        reject: (command) =>
          command.type === "thread.pull-request.link"
            ? new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: "already linked",
              })
            : null,
      });
      const result = yield* harness.call("link_pull_request", {
        url: "https://github.com/t3tools/t3code/pull/123",
      });
      expect(result.alreadyLinked).toBe(true);
    }),
  );

  it.effect("unlinks a linked pull request and reports a missing one as wasLinked=false", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        thread: makeThread([makeLink(5)]),
        reject: (command) =>
          command.type === "thread.pull-request.unlink" && command.number !== 5
            ? new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: "not linked",
              })
            : null,
      });
      const linked = yield* harness.call("unlink_pull_request", {
        repository: "t3tools/t3code",
        number: 5,
      });
      expect(linked).toEqual({
        host: "github.com",
        repository: "t3tools/t3code",
        number: 5,
        wasLinked: true,
      });
      const missing = yield* harness.call("unlink_pull_request", {
        url: "https://github.com/t3tools/t3code/pull/9",
      });
      expect(missing.wasLinked).toBe(false);
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        { type: "thread.pull-request.unlink", number: 5 },
      ]);
    }),
  );

  it("reports an older Forgejo link's HTTP port when listing thread links", () => {
    const result = listThreadPullRequests(
      makeThread([
        makeLink(42, {
          host: "forge.example",
          url: "http://forge.example:3000/t3tools/t3code/pulls/42",
        }),
      ]),
    );
    expect(result.pullRequests[0]?.host).toBe("forge.example:3000");
  });

  it.effect("fails cleanly when the token's thread no longer exists", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ thread: null });
      const error = yield* harness.call("list_thread_pull_requests", {}).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "PullRequestThreadNotFoundError", threadId: THREAD_ID });
    }),
  );

  it.effect("lists visible links with host state and derived chain order", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        thread: makeThread([
          makeLink(3, { headBranch: "feat-c", baseBranch: "feat-b", source: "agent" }),
          makeLink(1, { headBranch: "feat-a", baseBranch: "main", source: "created" }),
          makeLink(2, { headBranch: "feat-b", baseBranch: "feat-a", source: "agent" }),
          makeLink(9, { source: "stack-dismissed" }),
          makeLink(10),
        ]),
      });
      const result = yield* harness.call("list_thread_pull_requests", {});
      expect(result.pullRequests.map((entry) => entry.number)).toEqual([3, 1, 2, 10]);
      expect(result.pullRequests[0]).toEqual({
        host: "github.com",
        repository: "t3tools/t3code",
        number: 3,
        url: "https://github.com/t3tools/t3code/pull/3",
        source: "agent",
        state: "open",
        title: "PR 3",
        headBranch: "feat-c",
        baseBranch: "feat-b",
        isDraft: false,
        stack: { kind: "derived", position: 3, size: 3 },
      });
      expect(result.pullRequests[3]).toMatchObject({
        number: 10,
        state: null,
        title: null,
        headBranch: null,
        stack: null,
      });
      expect(result.chains).toEqual([
        { kind: "derived", numbers: [1, 2, 3] },
        { kind: "derived", numbers: [10] },
      ]);
    }),
  );
});

describe("listThreadPullRequests", () => {
  it("reports a native stack position for each member", () => {
    const stack = {
      kind: "native" as const,
      id: "stack-1",
      number: 1,
      url: "https://github.com/t3tools/t3code/stack/1",
      base: "main",
      layers: [
        { number: 1, headBranch: "a", state: "open" as const },
        { number: 2, headBranch: "b", state: "open" as const },
      ],
    };
    const result = listThreadPullRequests({
      pullRequests: [
        makeLink(2, { stack, source: "stack" }),
        makeLink(1, { stack, source: "created" }),
      ],
    });
    expect(result.pullRequests.map((entry) => [entry.number, entry.stack])).toEqual([
      [2, { kind: "native", position: 2, size: 2 }],
      [1, { kind: "native", position: 1, size: 2 }],
    ]);
    expect(result.chains).toEqual([{ kind: "native", numbers: [1, 2] }]);
  });
});

it("keeps failure diagnostics as the cause rather than exposing them in the tool message", () => {
  const cause = new Error("database internals");
  const failure = new PullRequestLinkFailedError({ cause });
  expect(failure.message).toBe("Could not link the pull request.");
  expect(failure.cause).toBe(cause);
});
