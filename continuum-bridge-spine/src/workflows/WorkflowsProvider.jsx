import { useCallback, useEffect, useMemo, useState } from "react";
import { useBrain } from "../brain/brainContext";
import { newStep, WorkflowsContext } from "./workflowModel";

/**
 * The Workflows screen's state, shared by its three panes: your templates and
 * the running interval's workflow, the one open on the canvas (a copy you
 * edit until you save), and the selected step. A running workflow is read
 * again every few seconds, so its steps' states and workers stay live.
 * Samples (samples.js) open read-only and play a pretend run; a copy of one
 * becomes your template.
 */
// What the Workflows screen opens on when nothing else is open
const OPENING_SAMPLE = "sample-mf-cobol-java";

export function WorkflowsProvider({ children }) {
  const brain = useBrain();
  const wf = brain?.wf ?? null;
  const bridgeId = brain?.interval?.bridgeId ?? null;
  const [list, setList] = useState(null);
  const [run, setRun] = useState(null); // the running interval's workflow
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null); // the open workflow, as edited here
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState(null); // step id
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false); // a sample's pretend run
  const [samples, setSamples] = useState([]); // loaded with the Workflows screen (samples.js), not before

  /** A sample on the canvas (read-only), its pretend run playing. */
  const showSample = useCallback((list, id) => {
    const s = list.find((x) => x.id === id);
    if (!s) return;
    setOpenId(null);
    setDraft({ ...structuredClone(s), id: null, sampleId: s.id, kind: "sample", status: "sample", createdBy: "you" });
    setDirty(false);
    setSelected(null);
    setPlaying(true);
  }, []);

  /**
   * The samples, fetched the first time the screen asks for them. With
   * nothing open yet, the screen opens on the COBOL to Java sample, playing.
   */
  const loadSamples = useCallback(() => {
    import("./samples")
      .then((m) => {
        setSamples(m.SAMPLE_WORKFLOWS);
        setDraft((d) => {
          if (!d) queueMicrotask(() => showSample(m.SAMPLE_WORKFLOWS, OPENING_SAMPLE));
          return d;
        });
      })
      .catch(() => {});
  }, [showSample]);

  const reload = useCallback(async () => {
    if (!wf) return;
    try {
      const [all, current] = await Promise.all([wf.workflows(), bridgeId ? wf.workflowOf(bridgeId) : null]);
      setList(all);
      setRun(current);
    } catch (err) {
      setError(err?.message || "Workflows couldn't be loaded.");
    }
  }, [wf, bridgeId]);
  useEffect(() => {
    reload();
  }, [reload]);

  /** Opens a workflow on the canvas (unsaved edits of another are dropped). */
  const open = useCallback(
    async (id) => {
      if (!wf || !id) return setDraft(null);
      setError("");
      try {
        const w = await wf.workflow(id);
        setPlaying(false);
        setOpenId(id);
        setDraft(w);
        setDirty(false);
        setSelected(null);
      } catch (err) {
        setError(err?.message || "That workflow couldn't be opened.");
      }
    },
    [wf]
  );

  // The open workflow read again while it runs (states, workers), unless you're editing it; the list too
  useEffect(() => {
    if (!wf) return undefined;
    const t = setInterval(async () => {
      reload();
      if (openId && !dirty) {
        try {
          const w = await wf.workflow(openId);
          setDraft((d) => (d && d.id === w.id && !dirty ? w : d));
        } catch {
          // the next look tries again
        }
      }
    }, 5000);
    return () => clearInterval(t);
  }, [wf, openId, dirty, reload]);

  const editable = !!draft && (draft.kind === "template" || draft.status === "draft");

  /** Changes the open workflow here (saved with save()). */
  const change = useCallback((fn) => {
    setDraft((d) => (d ? fn(structuredClone(d)) : d));
    setDirty(true);
  }, []);

  const act = useCallback(
    async (fn) => {
      setBusy(true);
      setError("");
      try {
        const out = await fn();
        await reload();
        return out;
      } catch (err) {
        setError(err?.message || "That didn't work.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [reload]
  );

  const value = useMemo(
    () => ({
      available: !!wf,
      list,
      run,
      bridgeId,
      interval: brain?.interval ?? null,
      workers: brain?.live?.workers ?? [],
      draft,
      dirty,
      editable,
      selected,
      setSelected,
      busy,
      error,
      setError,
      open,
      change,
      reload,
      samples,
      loadSamples,
      playing,
      setPlaying,
      /** A sample on the canvas (read-only), its pretend run playing. */
      openSample: (id) => showSample(samples, id),
      /** A sample copied into your templates (then yours to change). */
      copySample: () =>
        act(async () => {
          const s = samples.find((x) => x.id === draft?.sampleId);
          const saved = await wf.saveWorkflow({ name: s.name, description: s.description, steps: structuredClone(s.steps), edges: structuredClone(s.edges) });
          await open(saved.id);
          return saved;
        }),
      /** A blank template on the canvas (saved when you press Save). */
      startNew: () => {
        setPlaying(false);
        setOpenId(null);
        setDraft({ id: null, kind: "template", name: "New workflow", description: "", status: "draft", steps: [newStep("task", [], 120, 140)], edges: [] });
        setDirty(true);
        setSelected(null);
      },
      save: () =>
        act(async () => {
          const w = await wf.saveWorkflow({ id: draft.id ?? undefined, name: draft.name, description: draft.description, steps: draft.steps, edges: draft.edges, version: draft.version });
          setDraft(w);
          setOpenId(w.id);
          setDirty(false);
          return w;
        }),
      approve: () => act(async () => setDraft(await wf.approveWorkflow(draft.id))),
      cancel: () => act(async () => setDraft(await wf.cancelWorkflow(draft.id))),
      remove: () =>
        act(async () => {
          await wf.deleteWorkflow(draft.id);
          setDraft(null);
          setOpenId(null);
        }),
      saveAsTemplate: () => act(async () => open((await wf.saveAsTemplate(draft.id)).id)),
      useForInterval: () => act(async () => open((await wf.useWorkflow(draft.id, bridgeId)).id)),
      approveStep: (stepId) => act(async () => setDraft(await wf.approveStep(draft.id, stepId))),
      /** An approval sent back along its loop arrow, with what to change. */
      sendBackStep: (stepId, note) => act(async () => setDraft(await wf.sendBackStep(draft.id, stepId, note))),
    }),
    [wf, list, run, bridgeId, brain?.interval, brain?.live?.workers, draft, dirty, editable, selected, busy, error, open, change, reload, act, playing, samples, loadSamples, showSample]
  );

  return <WorkflowsContext.Provider value={value}>{children}</WorkflowsContext.Provider>;
}
