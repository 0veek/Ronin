/**
 * Default on-disk home for Ronin. Callers that resolve an implicit home
 * should go through these helpers so the dirname exists in one place.
 */
export const DEFAULT_RONIN_HOME_DIRNAME = ".ronin";
export const USERDATA_DIRNAME = "userdata";
export const WORKTREE_HOME_DIRNAME = DEFAULT_RONIN_HOME_DIRNAME;
