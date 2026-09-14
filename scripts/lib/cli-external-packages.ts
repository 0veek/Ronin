// @effect-diagnostics nodeBuiltinImport:off
import * as NodeModule from "node:module";

/** Packages the server bundle must load from the real filesystem. */
export const CLI_RUNTIME_EXTERNAL_PREFIXES = [
  "node-pty",
  "ffi-rs",
  "@yuuang/",
  "@ff-labs/",
  "@msgpackr-extract/",
  "msgpackr-extract",
  "node-gyp-build",
  "node-addon-api",
  "detect-libc",
  "bufferutil",
  "utf-8-validate",
] as const;

export function isRuntimeExternalCliDependency(id: string): boolean {
  return CLI_RUNTIME_EXTERNAL_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export function isExternalCliDependency(id: string): boolean {
  return isRuntimeExternalCliDependency(id);
}

export function shouldBundleCliDependency(id: string): boolean {
  if (id.startsWith("node:")) return false;
  return !isExternalCliDependency(id);
}

export function selectCliRuntimeExternalDependencies(
  dependencies: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([name]) => isRuntimeExternalCliDependency(name)),
  );
}

/** Find file-backed ESM imports, which Node single executables cannot resolve. */
export function findEsmImportsOfExternalPackages(source: string): ReadonlyArray<string> {
  const specifiers = new Set<string>();
  const patterns = [
    /^import\s[^;]*?\sfrom\s+["']([^"']+)["']/gm,
    /^import\s+["']([^"']+)["']/gm,
    /^export\s[^;]*?\sfrom\s+["']([^"']+)["']/gm,
    /\bimport\(\s*(?:\/\*[\s\S]*?\*\/\s*)*["']([^"']+)["']\s*[,)]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined || NodeModule.isBuiltin(specifier)) continue;
      if (specifier.startsWith("./") || specifier.startsWith("../")) continue;
      specifiers.add(specifier);
    }
  }
  return [...specifiers].sort();
}

/** Inspect Rolldown source regions for external packages that were accidentally inlined. */
export function findInlinedExternalPackages(source: string): {
  readonly regionCount: number;
  readonly inlined: ReadonlyArray<string>;
  readonly inlinedPackages: ReadonlyArray<string>;
} {
  const regionPattern = /\/\/#region\s+(\S+)/g;
  const packagePattern = /node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g;
  let regionCount = 0;
  const inlined = new Set<string>();
  const inlinedPackages = new Set<string>();
  for (const region of source.matchAll(regionPattern)) {
    regionCount += 1;
    const regionPath = region[1] ?? "";
    for (const candidate of regionPath.matchAll(packagePattern)) {
      const name = candidate[1];
      if (name === undefined || name === ".pnpm") continue;
      inlinedPackages.add(name);
      if (isExternalCliDependency(name)) inlined.add(name);
    }
  }
  return {
    regionCount,
    inlined: [...inlined].sort(),
    inlinedPackages: [...inlinedPackages].sort(),
  };
}
