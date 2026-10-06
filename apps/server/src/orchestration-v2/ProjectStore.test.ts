import { assert, it } from "@effect/vitest";
import { EventId, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectStore from "./ProjectStore.ts";

it.layer(ProjectStore.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory)))(
  "ProjectStore icon persistence",
  (it) => {
    it.effect(
      "reads legacy monograms and writes plain icons without accepting unknown stored kinds",
      () =>
        Effect.gen(function* () {
          const store = yield* ProjectStore.ProjectStoreV2;
          const sql = yield* SqlClient.SqlClient;
          const projectId = ProjectId.make("legacy-icon");
          const now = "2026-10-05T00:00:00.000Z";
          const icon = { kind: "monogram", text: "क्ष्म", color: "violet" } as const;
          const legacy = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
            kind: "lucide",
            name: "folder-code",
            color: icon.color,
            monogramText: icon.text,
          });
          yield* sql`INSERT INTO projection_projects
          (project_id, title, workspace_root, scripts_json, project_icon_json, created_at, updated_at, deleted_at)
          VALUES (${projectId}, 'Legacy icon', '/tmp/legacy-icon', '[]', ${legacy}, ${now}, ${now}, NULL)`;
          assert.deepEqual(Option.getOrThrow(yield* store.get(projectId)).projectIcon, icon);
          assert.deepEqual(Option.getOrThrow(yield* store.getShell(projectId)).projectIcon, icon);
          yield* store.apply({
            sequence: 1,
            eventId: EventId.make("update-icon"),
            type: "project.meta-updated",
            aggregateKind: "project",
            aggregateId: projectId,
            occurredAt: now,
            commandId: null,
            causationEventId: null,
            correlationId: null,
            metadata: {},
            payload: { projectId, projectIcon: icon, updatedAt: now },
          });
          const [row] = yield* sql<{
            readonly icon: string;
          }>`SELECT project_icon_json AS icon FROM projection_projects WHERE project_id = ${projectId}`;
          assert.deepEqual(
            yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(row!.icon),
            icon,
          );
          yield* sql`UPDATE projection_projects SET project_icon_json = '{"kind":"future-icon"}' WHERE project_id = ${projectId}`;
          assert.equal((yield* Effect.exit(store.get(projectId)))._tag, "Failure");
        }),
    );
  },
);
