import * as Schema from "effect/Schema";
import {
  OrchestrationSearchThreadInput,
  type OrchestrationSearchThreadResult,
  type TurnId,
} from "@t3tools/contracts";
import { searchableMessageSegments, searchablePlanSegments } from "@t3tools/shared/threadFindText";
import { countThreadSearchOccurrences } from "@t3tools/shared/threadSearch";
import * as Effect from "effect/Effect";
import * as Cache from "effect/Cache";
import * as Data from "effect/Data";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { toPersistenceSqlError } from "../persistence/Errors.ts";
const skillsCodec = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({ name: Schema.String, displayName: Schema.optionalKey(Schema.String) }),
  ),
);
const encodeSkills = Schema.encodeSync(skillsCodec);
const decodeSkills = Schema.decodeUnknownSync(skillsCodec);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
interface FindDocument {
  readonly entryId: string;
  readonly runId: TurnId | null;
  readonly count: number;
}
class TextKey extends Data.Class<{
  text: string;
  role: "user" | "assistant" | "plan";
  streaming: boolean;
  hasContext: boolean;
  cwd: string | undefined;
  skills: string;
}> {}
function parseText(key: TextKey) {
  const skills: NonNullable<OrchestrationSearchThreadInput["skills"]> = decodeSkills(key.skills);
  return key.role === "plan"
    ? searchablePlanSegments(key.text, key.cwd)
    : (searchableMessageSegments(
        {
          role: key.role,
          text: key.text,
          streaming: key.streaming,
          context: key.hasContext ? { version: 1, records: [] } : undefined,
        },
        key.cwd,
        skills,
      ) ?? []);
}
function selectMatch(
  documents: readonly FindDocument[],
  input: Pick<OrchestrationSearchThreadInput, "index" | "start" | "offset">,
) {
  const totalMatches = documents.reduce((sum, doc) => sum + doc.count, 0);
  let requestedIndex = input.index ?? 0;
  if (input.index === undefined && input.start) {
    const startIndex = documents.findIndex((doc) => doc.entryId === input.start?.entryId);
    if (startIndex >= 0) {
      requestedIndex =
        documents.slice(0, startIndex).reduce((sum, doc) => sum + doc.count, 0) +
        Math.min(input.start.occurrence, documents[startIndex]!.count);
      if (requestedIndex >= totalMatches) requestedIndex = 0;
    }
  }
  const activeIndex =
    input.index === undefined && totalMatches > 0
      ? (((requestedIndex + (input.offset ?? 0)) % totalMatches) + totalMatches) % totalMatches
      : Math.min(requestedIndex, Math.max(0, totalMatches - 1));
  let occurrence = activeIndex;
  for (const document of documents) {
    if (occurrence < document.count) return { totalMatches, activeIndex, document, occurrence };
    occurrence -= document.count;
  }
  return { totalMatches, activeIndex, document: null, occurrence: 0 };
}

function resultForSelection(
  selected: ReturnType<typeof selectMatch>,
  documents: readonly FindDocument[],
  snapshotSequence: number,
): OrchestrationSearchThreadResult {
  let startIndex = 0;
  const entries = documents.flatMap(({ entryId, runId, count }) => {
    const entry = { entryId, runId, count, startIndex };
    startIndex += count;
    return count > 0 ? [entry] : [];
  });
  const selectedEntry = entries.findIndex((entry) => entry.entryId === selected.document?.entryId);
  const navigation =
    entries.length <= 17
      ? entries
      : Array.from(
          { length: 17 },
          (_, i) => entries[(selectedEntry + i - 8 + entries.length) % entries.length]!,
        );
  return {
    snapshotSequence,
    totalMatches: selected.totalMatches,
    activeIndex: selected.activeIndex,
    navigation,
    match:
      selected.document === null
        ? null
        : {
            entryId: selected.document.entryId,
            runId: selected.document.runId,
            occurrence: selected.occurrence,
          },
  };
}

/** Searches persisted V1 messages and plans, independently of the client's loaded history. */
export const makeThreadFind = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const textCache = yield* Cache.make({
    capacity: 512,
    timeToLive: "1 minute",
    lookup: (key: TextKey) => Effect.sync(() => parseText(key)),
  });
  const largeTextCache = yield* Cache.make({
    capacity: 32,
    timeToLive: "1 minute",
    lookup: (key: TextKey) => Effect.sync(() => parseText(key)),
  });
  const scans = new Map<
    string,
    { revision: string; documents: readonly FindDocument[]; sequence: number }
  >();
  return Effect.fn("ThreadFind.searchThread")(function* (input: OrchestrationSearchThreadInput) {
    const cacheKey = encodeJson([input.threadId, input.query, input.skills ?? []]);
    const snapshot = yield* Effect.gen(function* () {
      const context = yield* sql<{ cwd: string; revision: string }>`
        SELECT COALESCE(t.worktree_path, p.workspace_root) AS cwd, t.updated_at AS revision
        FROM projection_threads t JOIN projection_projects p ON p.project_id = t.project_id
        WHERE t.thread_id = ${input.threadId} AND t.deleted_at IS NULL AND p.deleted_at IS NULL
      `;
      const states = yield* sql<{
        projector: string;
        sequence: number;
      }>`SELECT projector, last_applied_sequence AS sequence FROM projection_state ORDER BY projector`;
      const sequence = Math.min(...states.map((s) => s.sequence), 0x7fffffff);
      const revision = encodeJson([context[0], states]);
      const cached = scans.get(cacheKey);
      if (!context[0]) return { documents: [] as readonly FindDocument[], sequence: 0 };
      if (cached?.revision === revision)
        return { documents: cached.documents, sequence: cached.sequence };
      // Read only searchable bodies, never tool output or attachment contents. Decode after releasing SQLite.
      const rows = yield* sql<{
        entryId: string;
        runId: TurnId | null;
        text: string;
        role: "user" | "assistant" | "plan";
        streaming: number;
        hasContext: number;
      }>`
        SELECT message_id AS entryId, turn_id AS runId, text, role, is_streaming AS streaming, context_json IS NOT NULL AS hasContext, created_at AS createdAt, 0 AS kind
        FROM projection_thread_messages m WHERE thread_id = ${input.threadId} AND role IN ('user', 'assistant')
          AND NOT (role = 'user' AND message_id LIKE 'async-answer:%' AND EXISTS (
            SELECT 1 FROM projection_thread_activities a WHERE a.thread_id = m.thread_id
              AND json_extract(a.payload_json, '$.requestId') = substr(m.message_id, 14)
              AND a.kind = 'user-input.answer-submitted'
          ))
        UNION ALL
        SELECT plan_id, turn_id, plan_markdown, 'plan', 0, 0, created_at, 1 FROM projection_thread_proposed_plans WHERE thread_id = ${input.threadId}
        ORDER BY createdAt, kind, entryId
      `;
      return {
        rows,
        cwd: context[0].cwd,
        revision,
        sequence: sequence === 0x7fffffff ? 0 : sequence,
      };
    }).pipe(sql.withTransaction, Effect.mapError(toPersistenceSqlError("ThreadFind.snapshot")));
    if ("documents" in snapshot)
      return resultForSelection(
        selectMatch(snapshot.documents, input),
        snapshot.documents,
        snapshot.sequence,
      );
    const documents: FindDocument[] = [];
    const skills = encodeSkills(input.skills ?? []);
    for (const row of snapshot.rows) {
      const key = new TextKey({
        text: row.text,
        role: row.role,
        streaming: row.streaming === 1,
        hasContext: row.hasContext === 1,
        cwd: snapshot.cwd,
        skills,
      });
      const segments = yield* Cache.get(key.text.length <= 32768 ? textCache : largeTextCache, key);
      documents.push({
        entryId: row.entryId,
        runId: row.runId,
        count: segments.reduce((n, text) => n + countThreadSearchOccurrences(text, input.query), 0),
      });
      yield* Effect.yieldNow;
    }
    scans.delete(cacheKey);
    scans.set(cacheKey, { revision: snapshot.revision, documents, sequence: snapshot.sequence });
    if (scans.size > 8) {
      const oldest = scans.keys().next().value;
      if (oldest !== undefined) scans.delete(oldest);
    }
    return resultForSelection(selectMatch(documents, input), documents, snapshot.sequence);
  });
});
