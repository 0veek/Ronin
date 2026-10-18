import {
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  type ClientSettings,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
const persistence = vi.hoisted(() => ({ read: vi.fn<() => Promise<ClientSettings | null>>() }));
vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence: { getClientSettings: persistence.read } }),
}));
import {
  __resetClientSettingsPersistenceForTests,
  getClientSettings,
  prepareModelPreferencesPatch,
} from "./useSettings";
const provider = ProviderInstanceId.make("codex_work");
const saved = {
  ...DEFAULT_CLIENT_SETTINGS,
  favorites: [{ provider, model: "saved" }],
  providerModelPreferences: { [provider]: { hiddenModels: ["hidden"], modelOrder: ["saved"] } },
};
beforeEach(() => {
  __resetClientSettingsPersistenceForTests();
  persistence.read.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it("waits for legacy persistence before the first environment edit", async () => {
  let finish!: (settings: ClientSettings) => void;
  persistence.read.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = prepareModelPreferencesPatch(DEFAULT_SERVER_SETTINGS, {
    setModelFavorites: [{ provider, model: "new", favorite: true }],
  });
  expect(getClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);
  finish(saved);
  const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, await pending);
  expect(next.favorites).toEqual([...saved.favorites, { provider, model: "new" }]);
  expect(next.providerModelPreferences).toEqual(saved.providerModelPreferences);
});

it("refuses a migration after a failed read and preserves saved preferences on retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const failure = new Error("storage unavailable");
  persistence.read.mockRejectedValueOnce(failure).mockResolvedValueOnce(saved);
  const patch = { setModelsHidden: [{ provider, model: "new", hidden: true }] };
  await expect(prepareModelPreferencesPatch(DEFAULT_SERVER_SETTINGS, patch)).rejects.toBe(failure);
  expect(getClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);
  const next = applyServerSettingsPatch(
    DEFAULT_SERVER_SETTINGS,
    await prepareModelPreferencesPatch(DEFAULT_SERVER_SETTINGS, patch),
  );
  expect(next.favorites).toEqual(saved.favorites);
  expect(next.providerModelPreferences?.[provider]).toEqual({
    hiddenModels: ["hidden", "new"],
    modelOrder: ["saved"],
  });
  expect(persistence.read).toHaveBeenCalledTimes(2);
});
