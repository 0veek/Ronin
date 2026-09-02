// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

export interface DesktopAppControlAddress {
  readonly address: string;
  readonly directory: string | null;
}

function shortHash(value: string): string {
  // node:crypto rather than a hashing dependency: this only shortens a path,
  // and `packages/shared` has no other reason to pull one in.
  return NodeCrypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

/**
 * Returns the local-only socket address shared by the desktop shell and CLI.
 * The state directory is hashed so custom T3 homes cannot exceed Unix socket
 * path limits.
 */
export function resolveDesktopAppControlAddress(input: {
  readonly stateDir: string;
  readonly platform: NodeJS.Platform;
  readonly tempDir: string;
  readonly userId: number | undefined;
  readonly joinPath: (...segments: readonly string[]) => string;
}): DesktopAppControlAddress {
  const stateHash = shortHash(input.stateDir);
  if (input.platform === "win32") {
    return {
      address: `\\\\.\\pipe\\t3code-app-${stateHash}`,
      directory: null,
    };
  }

  const userKey =
    input.userId === undefined ? shortHash(input.stateDir).slice(0, 12) : input.userId;
  const directory = input.joinPath(input.tempDir, `t3code-${userKey}`);
  return {
    address: input.joinPath(directory, `${stateHash}.sock`),
    directory,
  };
}
