import type { KiloSettings } from "@t3tools/contracts";

import { kiloSettingsAsOpenCode } from "../provider/Layers/KiloAdapter.ts";
import { KILO_CLI_SPEC } from "../provider/opencodeRuntime.ts";
import { makeOpenCodeTextGeneration } from "./OpenCodeTextGeneration.ts";

export const makeKiloTextGeneration = (kiloSettings: KiloSettings) =>
  makeOpenCodeTextGeneration(kiloSettingsAsOpenCode(kiloSettings), KILO_CLI_SPEC);
