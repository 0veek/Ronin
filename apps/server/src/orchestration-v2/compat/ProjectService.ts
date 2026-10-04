import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ProjectStoreV2 } from "../ProjectStore.ts";

export class ProjectService extends Context.Service<
  ProjectService,
  {
    readonly getById: ProjectStoreV2["Service"]["get"];
  }
>()("t3/orchestration-v2/compat/ProjectService") {}
export const layer = Layer.effect(
  ProjectService,
  Effect.gen(function* () {
    const projects = yield* ProjectStoreV2;
    return ProjectService.of({ getById: projects.get });
  }),
);
