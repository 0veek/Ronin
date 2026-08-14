import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderSkillsCatalogResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { serverEnvironment } from "./server";
import { usePrimaryEnvironmentId } from "./environments";

export interface SkillsCatalogView {
  readonly isPending: boolean;
  readonly error: string | null;
  readonly skills: ProviderSkillsCatalogResult["skills"];
  readonly roninSkillsDir: string | null;
}

const EMPTY: SkillsCatalogView = {
  isPending: false,
  error: null,
  skills: [],
  roninSkillsDir: null,
};

const skillsCatalogAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.family((cwd: string | null) =>
    Atom.make((get): SkillsCatalogView => {
      const result = get(
        serverEnvironment.skillsCatalog({
          environmentId,
          input: cwd ? { cwd } : {},
        }),
      );
      const snapshot = Option.getOrNull(AsyncResult.value(result));
      return {
        isPending: result.waiting,
        error: result._tag === "Failure" ? "Skills could not be scanned." : null,
        skills: snapshot?.skills ?? [],
        roninSkillsDir: snapshot?.roninSkillsDir ?? null,
      };
    }).pipe(Atom.withLabel(`web-skills-catalog:${environmentId}:${cwd ?? "default"}`)),
  ),
);

const emptySkillsCatalogAtom = Atom.make((): SkillsCatalogView => EMPTY).pipe(
  Atom.withLabel("web-skills-catalog:none"),
);

export function useSkillsCatalog(): SkillsCatalogView {
  const environmentId = usePrimaryEnvironmentId();
  return useAtomValue(
    environmentId === null ? emptySkillsCatalogAtom : skillsCatalogAtom(environmentId)(null),
  );
}

export function useEnvironmentSkillsCatalog(
  environmentId: EnvironmentId,
  cwd: string | null,
): SkillsCatalogView {
  return useAtomValue(skillsCatalogAtom(environmentId)(cwd?.trim() || null));
}
