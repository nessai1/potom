import type { AppData } from "../types";

/** A new installation starts empty; saved workspaces are loaded separately. */
export function createInitialData(): AppData {
  return {
    schema: 2,
    tasks: [],
    projects: [],
    unlocked: [],
    metrics: {},
    settings: { theme: "light", cleanLanguage: false },
  };
}
