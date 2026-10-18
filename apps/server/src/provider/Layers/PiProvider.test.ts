// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { PiSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { discoverPiSkills } from "./PiProvider.ts";

it("discovers each workspace's native skills without mixing projects or overriding the agent directory", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ronin-pi-workspace-"));
  const home = NodePath.join(root, "home");
  const agentDir = NodePath.join(root, "custom-agent");
  const first = NodePath.join(root, "first");
  const second = NodePath.join(root, "second");
  const writeSkill = async (base: string, name: string) => {
    const folder = NodePath.join(base, "skills", name);
    await NodeFSP.mkdir(folder, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(folder, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}`,
    );
  };
  try {
    await writeSkill(NodePath.join(home, ".pi", "agent"), "default-home");
    await writeSkill(agentDir, "custom-home");
    await writeSkill(NodePath.join(first, ".pi"), "first-project");
    await writeSkill(NodePath.join(second, ".pi"), "second-project");
    const settings = Schema.decodeSync(PiSettings)({ enabled: true, agentDir });
    const names = async (cwd: string) =>
      (await Effect.runPromise(discoverPiSkills(settings, { HOME: home }, cwd)))
        .map((skill) => skill.name)
        .sort();
    expect(await names(first)).toEqual(["custom-home", "first-project"]);
    expect(await names(second)).toEqual(["custom-home", "second-project"]);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
