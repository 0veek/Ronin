import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  type ConnectionRegistration,
  ConnectionCredential,
  ConnectionProfile,
} from "../connection/catalog.ts";
import { type ConnectionTarget, PersistedConnectionTarget } from "../connection/model.ts";
import { StoredGitHubRoutingPermission } from "../connection/githubRoutingPermissions.ts";

export const StoredConnectionCredential = Schema.Struct({
  connectionId: Schema.String,
  credential: ConnectionCredential,
});
export type StoredConnectionCredential = typeof StoredConnectionCredential.Type;

export const ConnectionCatalogDocument = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  targets: Schema.Array(PersistedConnectionTarget),
  profiles: Schema.Array(ConnectionProfile),
  credentials: Schema.Array(StoredConnectionCredential),
  githubRoutingPermissions: Schema.optionalKey(Schema.Array(StoredGitHubRoutingPermission)),
  disabledEnvironmentIds: Schema.Array(EnvironmentId).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});
export type ConnectionCatalogDocument = typeof ConnectionCatalogDocument.Type;

export const EMPTY_CONNECTION_CATALOG_DOCUMENT: ConnectionCatalogDocument = Object.freeze({
  schemaVersion: 1,
  targets: [],
  profiles: [],
  credentials: [],
  disabledEnvironmentIds: [],
});

/**
 * Drop managed-relay leftovers from older catalog documents before decode.
 * Relay targets and DPoP token bags are no longer part of the schema.
 */
export function sanitizeConnectionCatalogDocument(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }
  const document = input as Record<string, unknown>;
  const targets = Array.isArray(document.targets)
    ? document.targets.filter(
        (target) =>
          !(
            typeof target === "object" &&
            target !== null &&
            (target as { _tag?: unknown })._tag === "RelayConnectionTarget"
          ),
      )
    : document.targets;
  const { remoteDpopTokens: _remoteDpopTokens, ...rest } = document;
  return {
    ...rest,
    targets,
  };
}

export const decodeConnectionCatalogDocument =
  Schema.decodeUnknownEffect(ConnectionCatalogDocument);

export function parseConnectionCatalogDocument(input: unknown) {
  return decodeConnectionCatalogDocument(sanitizeConnectionCatalogDocument(input));
}

export function replaceCatalogValue<A>(
  values: ReadonlyArray<A>,
  key: (value: A) => string,
  next: A,
): ReadonlyArray<A> {
  const nextKey = key(next);
  return [...values.filter((value) => key(value) !== nextKey), next];
}

export function removeCatalogValue<A>(
  values: ReadonlyArray<A>,
  key: (value: A) => string,
  removedKey: string,
): ReadonlyArray<A> {
  return values.filter((value) => key(value) !== removedKey);
}

function connectionIdOf(target: ConnectionTarget): string | null {
  switch (target._tag) {
    case "PrimaryConnectionTarget":
      return null;
    case "BearerConnectionTarget":
    case "SshConnectionTarget":
      return target.connectionId;
  }
}

function routeKey(target: ConnectionTarget): string {
  return connectionIdOf(target) ?? target._tag;
}

function removeRouteMetadata(
  document: ConnectionCatalogDocument,
  removed: ReadonlyArray<ConnectionTarget>,
): ConnectionCatalogDocument {
  const connectionIds = new Set(removed.flatMap((target) => connectionIdOf(target) ?? []));
  return {
    ...document,
    profiles: document.profiles.filter((value) => !connectionIds.has(value.connectionId)),
    credentials: document.credentials.filter((value) => !connectionIds.has(value.connectionId)),
  };
}

/**
 * An environment's saved routes in preference order. Targets of one
 * environment keep their relative order in `targets`, so a document written
 * before routes existed is one environment with one route.
 */
export function catalogRoutes(
  document: ConnectionCatalogDocument,
  environmentId: EnvironmentId,
): ReadonlyArray<PersistedConnectionTarget> {
  return document.targets.filter((target) => target.environmentId === environmentId);
}

/**
 * Replaces an environment's routes with `routes`, preferred first. Records
 * owned by a dropped route go with it; the environment keeps its position in
 * the catalog. An empty list leaves the environment's other records in place;
 * use `removeConnectionFromCatalog` to forget the environment.
 */
export function setRoutesInCatalog(
  document: ConnectionCatalogDocument,
  environmentId: EnvironmentId,
  routes: ReadonlyArray<PersistedConnectionTarget>,
): ConnectionCatalogDocument {
  const kept = new Set(routes.map(routeKey));
  const dropped = catalogRoutes(document, environmentId).filter(
    (target) => !kept.has(routeKey(target)),
  );
  const firstIndex = document.targets.findIndex((target) => target.environmentId === environmentId);
  const others = document.targets.filter((target) => target.environmentId !== environmentId);
  const insertAt =
    firstIndex === -1
      ? others.length
      : document.targets.slice(0, firstIndex).filter((t) => t.environmentId !== environmentId)
          .length;
  return {
    ...removeRouteMetadata(document, dropped),
    targets: [...others.slice(0, insertAt), ...routes, ...others.slice(insertAt)],
  };
}

/** Saves one route of an environment, keeping its other routes. */
export function registerConnectionInCatalog(
  document: ConnectionCatalogDocument,
  registration: ConnectionRegistration,
  routes: ReadonlyArray<PersistedConnectionTarget> = [registration.target],
): ConnectionCatalogDocument {
  // Re-registering (for example editing a label or URL) keeps the disabled
  // flag; only `setConnectionEnabledInCatalog` or removal changes it.
  const next = setRoutesInCatalog(document, registration.target.environmentId, routes);

  switch (registration._tag) {
    case "BearerConnectionRegistration":
      return {
        ...next,
        profiles: replaceCatalogValue(
          next.profiles,
          (value) => value.connectionId,
          registration.profile,
        ),
        credentials: replaceCatalogValue(next.credentials, (value) => value.connectionId, {
          connectionId: registration.target.connectionId,
          credential: registration.credential,
        }),
      };
    case "SshConnectionRegistration":
      return {
        ...next,
        profiles: replaceCatalogValue(
          next.profiles,
          (value) => value.connectionId,
          registration.profile,
        ),
      };
  }
}

/** Forgets an environment and every route it had. */
export function removeConnectionFromCatalog(
  document: ConnectionCatalogDocument,
  environmentId: EnvironmentId,
): ConnectionCatalogDocument {
  const next = setRoutesInCatalog(document, environmentId, []);
  return {
    ...next,
    disabledEnvironmentIds: removeCatalogValue(
      next.disabledEnvironmentIds,
      (value) => value,
      environmentId,
    ),
    ...(next.githubRoutingPermissions === undefined
      ? {}
      : {
          githubRoutingPermissions: next.githubRoutingPermissions.filter(
            (permission) => permission.environmentId !== environmentId,
          ),
        }),
  };
}

/** Flips the disabled flag for a saved environment; unknown ids are ignored. */
export function setConnectionEnabledInCatalog(
  document: ConnectionCatalogDocument,
  environmentId: EnvironmentId,
  enabled: boolean,
): ConnectionCatalogDocument {
  const registered = document.targets.some((target) => target.environmentId === environmentId);
  const without = removeCatalogValue(
    document.disabledEnvironmentIds,
    (value) => value,
    environmentId,
  );
  return {
    ...document,
    disabledEnvironmentIds: registered && !enabled ? [...without, environmentId] : without,
  };
}
