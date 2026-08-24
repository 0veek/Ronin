/**
 * Loader for `@earendil-works/pi-coding-agent`, the in-process runtime Pi
 * sessions are built on.
 *
 * Pi is the one provider Ronin does not spawn: there is no child process and no
 * protocol, just this module. Both the adapter and the health probe go through
 * here so the status card reports on the same thing a session will actually
 * use — a probe of the `pi` CLI says nothing about whether this import resolves.
 *
 * @module piRuntime
 */

export interface PiAgentSession {
  prompt: (input: string) => Promise<unknown>;
  abort?: () => Promise<unknown> | unknown;
  dispose?: () => Promise<unknown> | unknown;
  subscribe?: (listener: (event: { type?: string; text?: string }) => void) => () => void;
  sessionFile?: string;
  sessionManager?: { getSessionFile?: () => string | undefined };
}

export interface PiAgentRuntime {
  session: PiAgentSession;
}

export interface PiCodingAgentModule {
  createAgentSessionRuntime: (input: {
    cwd: string;
    sessionFile?: string;
    agentDir?: string;
  }) => Promise<PiAgentRuntime>;
}

let piModulePromise: Promise<PiCodingAgentModule> | undefined;

/**
 * Loads the Pi SDK on first use.
 *
 * The import goes through `Function` so the bundler leaves the specifier alone:
 * the package is an optional dependency, and a statically resolved import makes
 * the whole server fail to build when it is absent.
 */
export function loadPiCodingAgentModule(): Promise<PiCodingAgentModule> {
  piModulePromise ??= (
    Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<PiCodingAgentModule>
  )("@earendil-works/pi-coding-agent").catch((cause: unknown) => {
    // The usual reason this fails is that the package is not installed. Caching
    // the rejection means installing it afterwards changes nothing until the
    // whole server restarts, so the next caller gets to try again.
    piModulePromise = undefined;
    throw cause;
  });
  return piModulePromise;
}
