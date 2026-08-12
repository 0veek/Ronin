import type { KiloSettings } from "@t3tools/contracts";

import { kiloSettingsAsOpenCode } from "../provider/Layers/KiloAdapter.ts";
import { makeOpenCodeTextGeneration } from "./OpenCodeTextGeneration.ts";

export const makeKiloTextGeneration = (
  kiloSettings: KiloSettings,
  environment: NodeJS.ProcessEnv = process.env,
) => makeOpenCodeTextGeneration(kiloSettingsAsOpenCode(kiloSettings), environment);
