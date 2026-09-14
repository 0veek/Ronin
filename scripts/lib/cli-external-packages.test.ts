import { assert, describe, it } from "@effect/vitest";

import {
  findEsmImportsOfExternalPackages,
  findInlinedExternalPackages,
  selectCliRuntimeExternalDependencies,
  shouldBundleCliDependency,
} from "./cli-external-packages.ts";

describe("CLI external packages", () => {
  it("bundles ordinary packages but leaves native dependency families external", () => {
    assert.isTrue(shouldBundleCliDependency("effect"));
    assert.isFalse(shouldBundleCliDependency("node:fs"));
    assert.isFalse(shouldBundleCliDependency("node-pty"));
    assert.isFalse(shouldBundleCliDependency("@ff-labs/fff-node"));
    assert.deepStrictEqual(
      selectCliRuntimeExternalDependencies({
        effect: "4",
        "node-pty": "1",
        "@ff-labs/fff-node": "1",
      }),
      { "node-pty": "1", "@ff-labs/fff-node": "1" },
    );
  });

  it("finds unsupported file-backed ESM imports", () => {
    assert.deepStrictEqual(
      findEsmImportsOfExternalPackages(
        'import fs from "node:fs";\nimport x from "external";\nexport { y } from "./local.js";',
      ),
      ["external"],
    );
  });

  it("finds external packages in inlined source regions", () => {
    const result = findInlinedExternalPackages(
      "//#region ../../node_modules/node-pty/index.js\n//#endregion\n//#region ../../node_modules/effect/index.js\n//#endregion",
    );
    assert.strictEqual(result.regionCount, 2);
    assert.deepStrictEqual(result.inlined, ["node-pty"]);
    assert.deepStrictEqual(result.inlinedPackages, ["effect", "node-pty"]);
  });
});
