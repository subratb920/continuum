import { useState } from "react";
import "./brain.css";

const SIZE_LABEL = { small: "Small", standard: "Standard", large: "Large" };

/** "n2-standard-8 · 8 vCPU · 32 GB" (+ " · 1× nvidia-l4" for a GPU shape). */
const machineLabel = (m) => `${m.name} · ${m.vCPU} vCPU · ${m.memoryGb} GB${m.gpuType ? ` · ${m.gpuCount ?? 1}× ${m.gpuType}` : ""}`;
/** The stored machine ({ name, cpu, memoryGb }) a shape makes when it's picked. */
const pickCpu = (list, name) => {
  const m = list.find((x) => x.name === name);
  return m ? { name: m.name, cpu: m.vCPU, memoryGb: m.memoryGb } : null;
};
const pickGpu = (list, name) => {
  const m = list.find((x) => x.name === name);
  return m ? { name: m.name, cpu: m.vCPU, memoryGb: m.memoryGb, gpuType: m.gpuType, gpuCount: m.gpuCount ?? 1 } : null;
};

/**
 * A space's compute & models policy: which models its agents may run, the compute each
 * agent and the brain get, how many agents at once, and self-hosted GPU inference.
 * In an org it is the shared policy (owners and admins edit it, everyone else sees it
 * read-only); in a personal space it is that one user's own settings, which they edit.
 * Compute is picked from the live GCP machine catalog when it's available (the agents run
 * on Google Cloud); off Google Cloud it falls back to the small/standard/large size tiers.
 * Talks to the brain through the model settings hook.
 */
export default function WorkspacePolicy({ models }) {
  const { list, effective, allowedModels, maxAgentSize, brainSize, brainSizeDefault, agentSizeDefault, concurrencyCap, sizeSpecs, inferenceDefaults, selfHostedModels, gpuType, gpuTypes, gpuTypeDefault, workerMachine, brainMachine, inferenceMachine, catalog, loadCatalog, space, canManage, save } = models;
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState([]);
  const [cap, setCap] = useState("");
  const [selfHosted, setSelfHosted] = useState(false);
  const [gpu, setGpu] = useState("");
  const [workerMach, setWorkerMach] = useState(""); // a cpu machine name, or "" (size tier)
  const [brainMach, setBrainMach] = useState("");
  const [infMach, setInfMach] = useState(""); // a gpu machine name
  // Exact numbers for the offline fallback (no live GCP catalog): set CPU/memory/GPU directly.
  const [num, setNum] = useState({ agentCpu: "", agentMem: "", brainCpu: "", brainMem: "", gpuCount: "", gpuCpu: "", gpuMem: "" });
  const setN = (k, v) => setNum((o) => ({ ...o, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  // Shown for any space, once it is known: an org's shared policy, or a personal space's own settings.
  if (!space) return null;
  const isOrg = space.kind === "org";

  const modelList = list?.models ?? [];
  // A size tier with its exact CPU/memory, e.g. "Standard — 2 vCPU · 4 GB" (numbers come from the brain).
  const tierText = (s) => {
    const spec = sizeSpecs?.[s];
    return `${SIZE_LABEL[s] ?? s}${spec ? ` — ${spec.cpu} vCPU · ${spec.memoryGb} GB` : ""}`;
  };
  // The effective default each gets when its fields are left blank (the server's AGENT_DEFAULT_SIZE / BRAIN_SIZE).
  const agentDef = sizeSpecs?.[agentSizeDefault] ?? null;
  const brainDef = sizeSpecs?.[brainSizeDefault] ?? null;
  // The live GCP catalog, only once it's loaded and says it's available.
  const cat = catalog && catalog.available ? catalog : null;
  // Only a self-hosted open model (ollama/*) actually runs on the GPU server; a cloud model (Claude/OpenAI) does not.
  const workerModelName = effective?.worker || "";
  const selfHostedModel = workerModelName.startsWith("ollama/") || (effective?.brain || "").startsWith("ollama/");

  const begin = () => {
    loadCatalog?.(); // fetch the live machine list for the pickers (no-op off Google Cloud)
    setAllowed(allowedModels ?? []);
    setCap(concurrencyCap != null ? String(concurrencyCap) : "");
    setSelfHosted(selfHostedModels);
    setGpu(gpuType ?? "");
    setWorkerMach(workerMachine?.name ?? "");
    setBrainMach(brainMachine?.name ?? "");
    setInfMach(inferenceMachine?.name ?? "");
    // Seed the exact-number fields: from a saved machine, else the current/default size tier so the user always sees real numbers.
    const agentTier = sizeSpecs?.[maxAgentSize ?? agentSizeDefault] ?? null;
    const brainTier = sizeSpecs?.[brainSize ?? brainSizeDefault] ?? null;
    setNum({
      agentCpu: String(workerMachine?.cpu ?? agentTier?.cpu ?? ""),
      agentMem: String(workerMachine?.memoryGb ?? agentTier?.memoryGb ?? ""),
      brainCpu: String(brainMachine?.cpu ?? brainTier?.cpu ?? ""),
      brainMem: String(brainMachine?.memoryGb ?? brainTier?.memoryGb ?? ""),
      gpuCount: String(inferenceMachine?.gpuCount ?? inferenceDefaults?.gpuCount ?? 1),
      gpuCpu: String(inferenceMachine?.cpu ?? inferenceDefaults?.cpu ?? 4),
      gpuMem: String(inferenceMachine?.memoryGb ?? inferenceDefaults?.memoryGb ?? 16),
    });
    setMsg(null);
    setOpen(true);
  };
  const toggle = (id) => setAllowed((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const payload = { concurrencyCap: cap.trim() ? Number(cap) : null, selfHostedModels: selfHosted };
      if (isOrg) payload.allowedModels = allowed.length ? allowed : null;
      // Compute: pick a live GCP machine when the catalog is up, else set exact CPU/memory numbers.
      const cpuMachine = (cpu, mem) => {
        const c = Number(cpu);
        const m = Number(mem);
        return c >= 1 && m >= 1 ? { cpu: c, memoryGb: m } : null; // blank/invalid = back to the size tier
      };
      if (cat) {
        payload.workerMachine = pickCpu(cat.cpuMachines, workerMach); // null = back to the size tier
        payload.brainMachine = pickCpu(cat.cpuMachines, brainMach);
      } else {
        payload.workerMachine = cpuMachine(num.agentCpu, num.agentMem);
        payload.brainMachine = cpuMachine(num.brainCpu, num.brainMem);
      }
      // Inference server's GPU: a live GPU machine, else an exact GPU type + count + CPU/memory; cleared when self-hosting is off.
      if (!selfHosted) payload.inferenceMachine = null;
      else if (cat) payload.inferenceMachine = pickGpu(cat.gpuMachines, infMach);
      else {
        const count = Number(num.gpuCount);
        const c = Number(num.gpuCpu);
        const m = Number(num.gpuMem);
        if ((gpu || gpuTypeDefault) && count >= 1 && c >= 1 && m >= 1) payload.inferenceMachine = { gpuType: gpu || gpuTypeDefault, gpuCount: count, cpu: c, memoryGb: m };
        else payload.gpuType = gpu || null; // not enough to pin exact numbers — just record the type
      }
      await save(payload);
      setMsg({ ok: true, text: `${isOrg ? "Workspace policy" : "Settings"} saved.` });
      setOpen(false);
    } catch (err) {
      setMsg({ ok: false, text: err.message || "That couldn't be saved." });
    } finally {
      setSaving(false);
    }
  }

  // Summary (closed) labels: a picked machine if there is one, else the size.
  const agentSummary = workerMachine ? `${workerMachine.name ?? "Custom"} (${workerMachine.cpu} vCPU · ${workerMachine.memoryGb} GB)` : maxAgentSize ? tierText(maxAgentSize) : agentDef ? `Default (${tierText(agentSizeDefault)})` : "Default";
  const brainSummary = brainMachine ? `${brainMachine.name ?? "Custom"} (${brainMachine.cpu} vCPU · ${brainMachine.memoryGb} GB)` : brainSize ? tierText(brainSize) : `Default${brainSizeDefault ? ` (${tierText(brainSizeDefault)})` : ""}`;
  const infDefaultText = inferenceDefaults ? `${inferenceDefaults.gpuCount}× ${gpuType || gpuTypeDefault || "GPU"} · ${inferenceDefaults.cpu} vCPU · ${inferenceDefaults.memoryGb} GB` : gpuType || gpuTypeDefault || "GPU";
  const inferenceSummary = !selfHostedModels ? "Cloud" : inferenceMachine ? `Self-hosted · ${inferenceMachine.name ?? inferenceMachine.gpuType} (${inferenceMachine.gpuCount}× ${inferenceMachine.gpuType} · ${inferenceMachine.cpu} vCPU · ${inferenceMachine.memoryGb} GB)` : `Self-hosted · ${infDefaultText}`;

  return (
    <section className="workspace-policy" aria-label={isOrg ? "Workspace policy" : "Compute & models"}>
      <h4 className="workspace-policy-title">{isOrg ? "Workspace policy" : "Compute & models"}</h4>
      {!open && (
        <dl className="workspace-policy-summary">
          {isOrg && <dt>Models</dt>}
          {isOrg && <dd>{allowedModels?.length ? `${allowedModels.length} allowed` : "Every model"}</dd>}
          <dt>Agent</dt>
          <dd>{agentSummary}</dd>
          <dt>Brain</dt>
          <dd>{brainSummary}</dd>
          <dt>Most at once</dt>
          <dd>{concurrencyCap ?? "Server default"}</dd>
          <dt>Inference</dt>
          <dd>{inferenceSummary}</dd>
        </dl>
      )}
      {!open && canManage && (
        <button type="button" className="brain-btn" onClick={begin}>
          Edit policy…
        </button>
      )}
      {!open && !canManage && <p className="brain-hint">Your organization's owners and admins set these for everyone.</p>}
      {open && (
        <form className="model-settings-form" onSubmit={submit}>
          {isOrg && (
            <fieldset className="model-modes" disabled={saving}>
              <legend>Allowed models</legend>
              <p className="brain-hint">None ticked: every model is allowed.</p>
              {modelList.map((m) => (
                <label key={m.id} className="model-mode">
                  <input type="checkbox" checked={allowed.includes(m.id)} onChange={() => toggle(m.id)} disabled={m.tools === false} />
                  <span className="model-mode-name brain-mono">{m.id}</span>
                  {m.tools === false && <span className="brain-hint">no tools</span>}
                </label>
              ))}
            </fieldset>
          )}
          {/* The main infra knob: a self-hosted open model runs on your own GPU server. Cloud models don't use a GPU. */}
          <label className="model-helpers" title="Run this workspace's own open models on a GPU in its namespace, instead of a cloud provider.">
            <input type="checkbox" checked={selfHosted} onChange={(e) => setSelfHosted(e.target.checked)} disabled={saving} />
            Self-hosted models on a GPU
          </label>
          {selfHosted && !selfHostedModel && (
            <p className="brain-hint">
              Your model{workerModelName ? ` (${workerModelName})` : ""} runs in the cloud, so a GPU server isn't used. Switch the model to a self-hosted <span className="brain-mono">ollama/*</span> model to run on your own GPU.
            </p>
          )}
          {!selfHosted && selfHostedModel && <p className="brain-hint">Your model is a self-hosted ollama model — turn this on to run it on your own GPU.</p>}
          {selfHosted &&
            selfHostedModel &&
            (cat ? (
              <label className="workspace-policy-field">
                GPU machine <span className="brain-hint">· the model server; scales to zero when idle, a cold start reloads the model</span>
                <select value={infMach} onChange={(e) => setInfMach(e.target.value)} disabled={saving}>
                  <option value="">Choose a GPU machine…</option>
                  {cat.gpuMachines.map((m) => (
                    <option key={m.name} value={m.name} disabled={!m.allowedByQuota}>
                      {machineLabel(m)}
                      {m.allowedByQuota ? "" : " — over quota"}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <fieldset className="workspace-policy-field" disabled={saving}>
                <legend>GPU inference server <span className="brain-hint">· scales to zero when idle; a cold start reloads the model</span></legend>
                <label>
                  GPU type
                  <select value={gpu} onChange={(e) => setGpu(e.target.value)}>
                    <option value="">Default{gpuTypeDefault ? ` (${gpuTypeDefault})` : ""}</option>
                    {(gpuTypes.length ? gpuTypes : ["nvidia-l4"]).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="workspace-policy-nums">
                  <label>
                    GPUs
                    <input type="number" min="1" max="8" step="1" value={num.gpuCount} onChange={(e) => setN("gpuCount", e.target.value)} />
                  </label>
                  <label>
                    CPU (cores)
                    <input type="number" min="1" max="224" step="1" value={num.gpuCpu} onChange={(e) => setN("gpuCpu", e.target.value)} />
                  </label>
                  <label>
                    Memory (GB)
                    <input type="number" min="1" max="1024" step="1" value={num.gpuMem} onChange={(e) => setN("gpuMem", e.target.value)} />
                  </label>
                </div>
              </fieldset>
            ))}
          <label className="workspace-policy-field">
            Most agents at once
            <input type="number" min="1" max="1000" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="Server default" disabled={saving} />
          </label>
          {/* Agent/brain pod sizing is managed by default; Google Cloud scales nodes to fit. Only heavy repos/builds need more, so it's tucked away. */}
          <details className="workspace-policy-advanced">
            <summary>Advanced · agent &amp; brain compute</summary>
            <p className="brain-hint">CPU/memory for the pods that run the agents and the brain — not the model. Google Cloud scales nodes to fit; raise these only for heavy repos or builds. Takes effect on each pod's next start.</p>
            {cat ? (
              <>
                <p className="brain-hint">Machines in {cat.region} — live from Google Cloud.</p>
                <label className="workspace-policy-field">
                  Agent machine
                  <select value={workerMach} onChange={(e) => setWorkerMach(e.target.value)} disabled={saving}>
                    <option value="">Default</option>
                    {cat.cpuMachines.map((m) => (
                      <option key={m.name} value={m.name} disabled={!m.allowedByQuota}>
                        {machineLabel(m)}
                        {m.allowedByQuota ? "" : " — over quota"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="workspace-policy-field">
                  Brain machine
                  <select value={brainMach} onChange={(e) => setBrainMach(e.target.value)} disabled={saving}>
                    <option value="">Default</option>
                    {cat.cpuMachines.map((m) => (
                      <option key={m.name} value={m.name} disabled={!m.allowedByQuota}>
                        {machineLabel(m)}
                        {m.allowedByQuota ? "" : " — over quota"}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                {catalog && !catalog.available && <p className="brain-hint">Live GCP machine list only loads on the deployed cluster — here, set CPU/memory exactly.</p>}
                <fieldset className="workspace-policy-field" disabled={saving}>
                  <legend>Agent compute</legend>
                  <div className="workspace-policy-nums">
                    <label>
                      CPU (cores)
                      <input type="number" min="1" max="224" step="1" value={num.agentCpu} onChange={(e) => setN("agentCpu", e.target.value)} placeholder={agentDef ? String(agentDef.cpu) : ""} />
                    </label>
                    <label>
                      Memory (GB)
                      <input type="number" min="1" max="1024" step="1" value={num.agentMem} onChange={(e) => setN("agentMem", e.target.value)} placeholder={agentDef ? String(agentDef.memoryGb) : ""} />
                    </label>
                  </div>
                  <span className="brain-hint">Leave blank to use the default ({agentDef ? `${SIZE_LABEL[agentSizeDefault] ?? agentSizeDefault} · ${agentDef.cpu} vCPU · ${agentDef.memoryGb} GB` : "server default"}).</span>
                </fieldset>
                <fieldset className="workspace-policy-field" disabled={saving}>
                  <legend>Brain compute</legend>
                  <div className="workspace-policy-nums">
                    <label>
                      CPU (cores)
                      <input type="number" min="1" max="224" step="1" value={num.brainCpu} onChange={(e) => setN("brainCpu", e.target.value)} placeholder={brainDef ? String(brainDef.cpu) : ""} />
                    </label>
                    <label>
                      Memory (GB)
                      <input type="number" min="1" max="1024" step="1" value={num.brainMem} onChange={(e) => setN("brainMem", e.target.value)} placeholder={brainDef ? String(brainDef.memoryGb) : ""} />
                    </label>
                  </div>
                  <span className="brain-hint">Leave blank to use the default ({brainDef ? `${SIZE_LABEL[brainSizeDefault] ?? brainSizeDefault} · ${brainDef.cpu} vCPU · ${brainDef.memoryGb} GB` : "server default"}).</span>
                </fieldset>
              </>
            )}
          </details>
          <div className="agent-spawn-actions">
            <button type="button" className="brain-btn" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="brain-btn is-primary" disabled={saving}>
              {saving ? "Saving…" : "Save policy"}
            </button>
          </div>
        </form>
      )}
      {msg && (
        <p className={msg.ok ? "brain-hint" : "model-settings-error"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
