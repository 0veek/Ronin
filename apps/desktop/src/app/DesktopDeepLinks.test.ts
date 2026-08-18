import { assert, describe, it } from "@effect/vitest";

import { findDesktopProtocolUrl, parseDesktopAppUrl } from "./DesktopDeepLinks.ts";

describe("DesktopDeepLinks", () => {
  it("accepts the privileged renderer origin and its paths", () => {
    assert.equal(
      parseDesktopAppUrl("t3code://app/pair#token=abc", "t3code")?.href,
      "t3code://app/pair#token=abc",
    );
    assert.equal(parseDesktopAppUrl("t3code-dev://app/", "t3code-dev")?.href, "t3code-dev://app/");
  });

  it("rejects other schemes, hosts, and unparseable strings", () => {
    assert.isNull(parseDesktopAppUrl("t3code-dev://app/", "t3code"));
    assert.isNull(parseDesktopAppUrl("t3code://evil/", "t3code"));
    assert.isNull(parseDesktopAppUrl("https://example.com/", "t3code"));
    assert.isNull(parseDesktopAppUrl("not a url", "t3code"));
  });

  it("finds the first matching protocol URL in argv", () => {
    assert.equal(
      findDesktopProtocolUrl(
        ["/opt/Ronin/ronin", "--hidden", "t3code://app/settings", "t3code://app/pair"],
        "t3code",
      ),
      "t3code://app/settings",
    );
    assert.isNull(findDesktopProtocolUrl(["/opt/Ronin/ronin", "--hidden"], "t3code"));
  });
});
