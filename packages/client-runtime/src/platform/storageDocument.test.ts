import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  SshConnectionProfile,
  SshConnectionRegistration,
} from "../connection/catalog.ts";
import { BearerConnectionTarget, SshConnectionTarget } from "../connection/model.ts";
import {
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  parseConnectionCatalogDocument,
  registerConnectionInCatalog,
  removeConnectionFromCatalog,
  sanitizeConnectionCatalogDocument,
} from "./storageDocument.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

const BEARER_TARGET = new BearerConnectionTarget({
  environmentId: ENVIRONMENT_ID,
  label: "Remote",
  connectionId: "bearer-1",
});
const BEARER_PROFILE = new BearerConnectionProfile({
  connectionId: BEARER_TARGET.connectionId,
  environmentId: ENVIRONMENT_ID,
  label: BEARER_TARGET.label,
  httpBaseUrl: "https://remote.example.test",
  wsBaseUrl: "wss://remote.example.test",
});
const BEARER_CREDENTIAL = new BearerConnectionCredential({
  token: "bearer-token",
});

describe("ConnectionCatalogDocument", () => {
  it("registers a bearer connection as one catalog mutation", () => {
    const document = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );

    expect(document.targets).toEqual([BEARER_TARGET]);
    expect(document.profiles).toEqual([BEARER_PROFILE]);
    expect(document.credentials).toEqual([
      {
        connectionId: BEARER_TARGET.connectionId,
        credential: BEARER_CREDENTIAL,
      },
    ]);
  });

  it("replaces obsolete connection metadata when re-registering the same environment", () => {
    const bearer = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );
    const replacement = new BearerConnectionTarget({
      environmentId: ENVIRONMENT_ID,
      label: "Remote updated",
      connectionId: "bearer-2",
    });
    const replacementProfile = new BearerConnectionProfile({
      connectionId: replacement.connectionId,
      environmentId: ENVIRONMENT_ID,
      label: replacement.label,
      httpBaseUrl: "https://remote-2.example.test",
      wsBaseUrl: "wss://remote-2.example.test",
    });
    const replacementCredential = new BearerConnectionCredential({
      token: "bearer-token-2",
    });
    const next = registerConnectionInCatalog(
      bearer,
      new BearerConnectionRegistration({
        target: replacement,
        profile: replacementProfile,
        credential: replacementCredential,
      }),
    );

    expect(next.targets).toEqual([replacement]);
    expect(next.profiles).toEqual([replacementProfile]);
    expect(next.credentials).toEqual([
      {
        connectionId: replacement.connectionId,
        credential: replacementCredential,
      },
    ]);
  });

  it("removes every catalog record owned by an explicit disconnect", () => {
    const registered = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );

    expect(removeConnectionFromCatalog(registered, BEARER_TARGET)).toEqual(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
    );
  });

  it("persists the normalized SSH profile beside its target", () => {
    const target = new SshConnectionTarget({
      environmentId: ENVIRONMENT_ID,
      label: "SSH",
      connectionId: "ssh-1",
    });
    const profile = new SshConnectionProfile({
      connectionId: target.connectionId,
      environmentId: target.environmentId,
      label: target.label,
      target: {
        alias: "devbox",
        hostname: "devbox.example.test",
        username: "developer",
        port: 22,
      },
    });
    const document = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new SshConnectionRegistration({ target, profile }),
    );

    expect(document.targets).toEqual([target]);
    expect(document.profiles).toEqual([profile]);
    expect(document.credentials).toEqual([]);
  });

  it("drops relay targets and remote DPoP tokens from legacy documents", async () => {
    const sanitized = sanitizeConnectionCatalogDocument({
      schemaVersion: 1,
      targets: [
        {
          _tag: "RelayConnectionTarget",
          environmentId: "environment-relay",
          label: "Relay",
        },
        {
          _tag: "BearerConnectionTarget",
          environmentId: ENVIRONMENT_ID,
          label: "Remote",
          connectionId: "bearer-1",
        },
      ],
      profiles: [BEARER_PROFILE],
      credentials: [
        {
          connectionId: BEARER_TARGET.connectionId,
          credential: BEARER_CREDENTIAL,
        },
      ],
      remoteDpopTokens: [
        {
          environmentId: ENVIRONMENT_ID,
          label: "Remote",
          endpoint: {
            httpBaseUrl: "https://remote.example.test",
            wsBaseUrl: "wss://remote.example.test",
            providerKind: "cloudflare_tunnel",
          },
          accessToken: "dpop-token",
          expiresAtEpochMs: 1_000_000,
          dpopThumbprint: "thumbprint",
        },
      ],
    });

    expect(sanitized).toEqual({
      schemaVersion: 1,
      targets: [
        {
          _tag: "BearerConnectionTarget",
          environmentId: ENVIRONMENT_ID,
          label: "Remote",
          connectionId: "bearer-1",
        },
      ],
      profiles: [BEARER_PROFILE],
      credentials: [
        {
          connectionId: BEARER_TARGET.connectionId,
          credential: BEARER_CREDENTIAL,
        },
      ],
    });

    const decoded = await Effect.runPromise(parseConnectionCatalogDocument(sanitized));
    expect(decoded.targets).toHaveLength(1);
    expect(decoded.targets[0]?._tag).toBe("BearerConnectionTarget");
  });
});
