import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import { BearerConnectionTarget } from "./model.ts";
import {
  connectionRouteKind,
  connectionRouteLabel,
  connectionRouteId,
  credentialConnectionId,
  entryWithRoutes,
  mergeLearnedRoutes,
  routesAfterRemoving,
  insertRoute,
  upsertRoute,
} from "./routes.ts";

import { gitHubRoutingConnectionKey } from "./githubRoutingPermissions.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

function direct(id: string, httpBaseUrl: string): ConnectionRoute {
  return {
    target: new BearerConnectionTarget({
      environmentId: ENVIRONMENT_ID,
      label: "Desk",
      connectionId: id,
    }),
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: id,
        environmentId: ENVIRONMENT_ID,
        label: "Desk",
        httpBaseUrl,
        wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
      }),
    ),
  };
}

const LAN = direct("lan", "http://192.168.1.10:3773/");
const TAILNET = direct("tailnet", "https://desk.tail1234.ts.net/");
const PUBLIC = direct("public", "https://desk.example.com/");

describe("connection routes", () => {
  it("classifies direct routes by address", () => {
    expect(connectionRouteKind(LAN)).toBe("lan");
    expect(connectionRouteKind(direct("ip", "http://100.101.102.103:3773/"))).toBe("tailnet");
    expect(connectionRouteKind(TAILNET)).toBe("tailnet");
    expect(connectionRouteKind(PUBLIC)).toBe("public");
    expect(connectionRouteKind(direct("lo", "http://127.0.0.1:3773/"))).toBe("loopback");
    expect(connectionRouteKind(direct("ts6", "http://[fd7a:115c:a1e0::1]:3773/"))).toBe("tailnet");
    expect(connectionRouteLabel(TAILNET)).toBe("Tailscale");
  });

  it("places a new route after faster kinds and ahead of public routes", () => {
    expect(insertRoute([PUBLIC], LAN)).toEqual([LAN, PUBLIC]);
    expect(insertRoute([LAN, PUBLIC], TAILNET)).toEqual([LAN, TAILNET, PUBLIC]);
    expect(insertRoute([TAILNET], LAN)).toEqual([LAN, TAILNET]);
    expect(insertRoute([LAN, TAILNET], PUBLIC)).toEqual([LAN, TAILNET, PUBLIC]);
  });

  it("keeps a user's order when a saved route is replaced", () => {
    // The user preferred the public route over the LAN; re-pairing the LAN keeps that.
    const repaired = direct("lan", "http://192.168.1.11:3773/");
    expect(upsertRoute([PUBLIC, LAN], repaired)).toEqual([PUBLIC, repaired]);
  });
});

const entryFor = (routes: ReadonlyArray<ConnectionRoute>): ConnectionCatalogEntry =>
  entryWithRoutes({ target: PUBLIC.target, profile: PUBLIC.profile, enabled: true }, routes);
const address = "http://192.168.1.20:3773/";
const learn = (
  entry: ConnectionCatalogEntry,
  activeRoute: ConnectionRoute,
  reported = [{ httpBaseUrl: address }],
  allowInsecure = true,
) => mergeLearnedRoutes({ entry, activeRoute, reported, allowInsecure });

describe("learned routes", () => {
  it("learns LAN and Tailscale routes using the paired token without copying credentials", () => {
    const routes = learn(entryFor([PUBLIC]), PUBLIC, [
      { httpBaseUrl: address },
      { httpBaseUrl: "https://desk.tail1234.ts.net/" },
    ])!;
    expect(routes.map(connectionRouteKind)).toEqual(["lan", "tailnet", "public"]);
    const id = connectionRouteId(routes[0]!.target);
    expect(credentialConnectionId(id)).toBe("public");
    expect(Option.getOrThrow(routes[0]!.profile)).toMatchObject({
      learned: true,
      httpBaseUrl: address,
    });
  });

  it("keeps user preferences, replaces stale DHCP hints, and preserves paired addresses", () => {
    const routes = learn(entryFor([PUBLIC]), PUBLIC)!;
    const preferred = entryFor([PUBLIC, routes[0]!]);
    expect(learn(preferred, PUBLIC)).toBeNull();
    const next = learn(preferred, PUBLIC, [{ httpBaseUrl: "http://192.168.1.21:3773/" }])!;
    expect(
      next.some(
        (route) => connectionRouteId(route.target) === connectionRouteId(routes[0]!.target),
      ),
    ).toBe(false);
    expect(next.some((route) => route.target === PUBLIC.target)).toBe(true);
    expect(learn(entryFor([PUBLIC, LAN]), PUBLIC, [])).toBeNull();
  });

  it("deduplicates paired addresses and avoids loopback and HTTPS mixed content", () => {
    expect(learn(entryFor([LAN]), LAN, [{ httpBaseUrl: "http://192.168.1.10:3773" }])).toBeNull();
    expect(
      learn(entryFor([PUBLIC]), PUBLIC, [
        { httpBaseUrl: "http://127.0.0.1:3773/" },
        { httpBaseUrl: "file:///tmp/socket" },
      ]),
    ).toBeNull();
    expect(learn(entryFor([PUBLIC]), PUBLIC, [{ httpBaseUrl: address }], false)).toBeNull();
  });

  it("keeps the original token owner when learning through a learned route", () => {
    const routes = learn(entryFor([PUBLIC]), PUBLIC)!;
    const next = learn(entryFor(routes), routes[0]!, [
      { httpBaseUrl: "http://192.168.1.21:3773/" },
    ])!;
    expect(credentialConnectionId(connectionRouteId(next[0]!.target))).toBe("public");
    expect(routesAfterRemoving(next, "public")).toEqual([]);
  });

  it("keeps GitHub trust through learning and reordering but revokes it for new paired addresses", () => {
    const entry = entryFor([PUBLIC]);
    const trusted = gitHubRoutingConnectionKey(entry);
    const learned = learn(entry, PUBLIC)!;
    expect(gitHubRoutingConnectionKey(entryFor(learned))).toBe(trusted);
    expect(gitHubRoutingConnectionKey(entryFor(learned.toReversed()))).toBe(trusted);
    expect(gitHubRoutingConnectionKey(entryFor([PUBLIC, LAN]))).not.toBe(trusted);
    expect(gitHubRoutingConnectionKey(entryFor([PUBLIC, LAN]))).toBe(
      gitHubRoutingConnectionKey(entryFor([LAN, PUBLIC])),
    );
  });
});
