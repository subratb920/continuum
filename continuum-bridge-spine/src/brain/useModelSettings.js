import { useCallback, useEffect, useState } from "react";
import { useBrain } from "./brainContext";

/**
 * The one model your brain and every worker run on (brain-api's /settings:
 * your choice, else the server's default), the models available (/models),
 * and whether it can change now: only while nothing is awake and nothing
 * waits on you (the server says so; the screen also sees it at once).
 * refresh() asks again (a provider just set up, a model just pulled).
 */
export function useModelSettings() {
  const brain = useBrain();
  const [state, setState] = useState({ list: null, settings: null, error: "" });
  const can = !!(brain?.models && brain?.settings);

  // Each on its own: the model in use shows at once; the list (a cloud provider's catalogue) can take longer
  const refresh = useCallback(() => {
    if (!can) return;
    const failed = (err) => setState((s) => ({ ...s, error: err.message || "The models couldn't be loaded." }));
    brain.settings().then((settings) => setState((s) => ({ ...s, settings, error: "" })), failed);
    brain.models().then((list) => setState((s) => ({ ...s, list })), failed);
  }, [brain, can]);
  useEffect(refresh, [refresh]);

  /** Changes the one model (null: back to the server's default) and/or the speed (fast | thorough). Throws when refused. */
  const save = useCallback(
    async (changes) => {
      const settings = await brain.saveSettings(changes);
      setState((s) => ({ ...s, settings }));
      return settings;
    },
    [brain]
  );

  const { settings } = state;
  return {
    available: can,
    list: state.list,
    error: state.error,
    settings,
    /** What every agent runs on: your choice, else the server's default. */
    // (A brain from before one model answers brainModel / defaults.brain: still shown)
    model: settings ? settings.model ?? settings.chosen ?? settings.brainModel ?? settings.defaults?.model ?? settings.defaults?.brain ?? null : null,
    chosen: settings ? settings.chosen ?? settings.brainModel ?? null : null,
    defaultModel: settings?.defaults?.model ?? settings?.defaults?.brain ?? null,
    /** fast or thorough (a brain from before speeds: null), and what each means. */
    mode: settings?.mode ?? null,
    modes: settings?.modes ?? [],
    /** lean or full (a brain from before: null), and what each costs. */
    tools: settings?.tools ?? null,
    toolsets: settings?.toolsets ?? [],
    refresh,
    save,
  };
}
