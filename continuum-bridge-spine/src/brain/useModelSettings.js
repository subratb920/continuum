import { useCallback, useEffect, useState } from "react";
import { getBrainClient } from "./brainClient";

/**
 * The models the brain and workers run on (brain-api's /settings: your choice,
 * else the server's default), the models available (/models), optional per-tier
 * worker models and automatic routing, and whether it can change now: only
 * while nothing is awake and nothing waits on you (the server says so).
 * refresh() asks again. It talks to the brain client directly (not the brain
 * provider), so it works in every pane, on every tab.
 */
export function useModelSettings() {
  const client = getBrainClient();
  const [state, setState] = useState({ list: null, settings: null, error: "" });
  const can = !!(client?.settings && client?.models);

  // Each on its own: the model in use shows at once; the list (a cloud provider's catalogue) can take longer
  const refresh = useCallback(() => {
    if (!can) return;
    const failed = (err) => setState((s) => ({ ...s, error: err.message || "The models couldn't be loaded." }));
    client.settings().then((settings) => setState((s) => ({ ...s, settings, error: "" })), failed);
    client.models().then((list) => setState((s) => ({ ...s, list })), failed);
  }, [client, can]);
  useEffect(refresh, [refresh]);

  /** Changes the models and/or speed/tools/routing. Throws when refused. */
  const save = useCallback(
    async (changes) => {
      const settings = await client.saveSettings(changes);
      setState((s) => ({ ...s, settings }));
      return settings;
    },
    [client]
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
    // The brain's and workers' own models (null: unset → the default). A brain from before the split answers neither.
    brainModel: settings ? settings.brainModel ?? null : null,
    workerModel: settings ? settings.workerModel ?? null : null,
    defaultBrainModel: settings?.defaults?.brain ?? settings?.defaults?.model ?? null,
    defaultWorkerModel: settings?.defaults?.worker ?? settings?.defaults?.brain ?? settings?.defaults?.model ?? null,
    /** Whether the server splits brain/worker models and per-tier worker models (only the newer brain reports `effective`; older ones mirror one model, so false). */
    canSplit: !!settings?.effective,
    /** Optional per-tier worker models the brain picks from, and the tier names. */
    tiers: settings?.tiers ?? {},
    tierNames: settings?.tierNames ?? [],
    /** Whether Continuum picks a worker's tier per task (on unless the server says false). */
    autoRoute: settings ? settings.autoRoute !== false : true,
    /** The models actually used once defaults are filled in ({ brain, worker }), when the server reports them. */
    effective: settings?.effective ?? null,
    /** Model spend this period and where it stands (state: off | ok | warn | exceeded), when the server reports it. */
    budget: settings?.budget ?? null,
    /** fast or thorough (a brain from before speeds: null), and what each means. */
    mode: settings?.mode ?? null,
    modes: settings?.modes ?? [],
    /** lean or full (a brain from before: null), and what each costs. */
    tools: settings?.tools ?? null,
    toolsets: settings?.toolsets ?? [],
    /** Why the model can't change right now (an agent awake, a request waiting), or null. */
    locked: settings?.locked ?? null,
    changeable: settings ? settings.changeable !== false : false,
    /** Tenant policy an org admin sets (a brain from before Phase 2: empty/null). */
    allowedModels: settings?.allowedModels ?? [],
    concurrencyCap: settings?.concurrencyCap ?? null,
    maxAgentSize: settings?.maxAgentSize ?? null,
    brainSize: settings?.brainSize ?? null,
    brainSizeDefault: settings?.brainSizeDefault ?? null,
    sizeNames: settings?.sizeNames ?? [],
    /** Self-hosted open models on the tenant's own GPU (and which GPU). */
    selfHostedModels: settings?.selfHostedModels === true,
    gpuType: settings?.gpuType ?? null,
    gpuTypes: settings?.gpuTypes ?? [],
    gpuTypeDefault: settings?.gpuTypeDefault ?? null,
    /** The space this is for, and whether you may change it ({ kind, orgRole, canManage }). Personal/old brain: manageable. */
    space: settings?.space ?? { kind: "user", orgRole: null, canManage: true },
    canManage: settings ? settings.space?.canManage !== false : true,
    refresh,
    save,
  };
}
