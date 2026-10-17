import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataContext } from "./dataContext";
import { dataApi } from "./dataApi";
import { useAuth } from "../state/authStore";

/**
 * The Data screen's live state: the user's datasets, which one is open, its
 * versions, and the events of its builds. Run events arrive live (the
 * dataApi stream); a step's start or end reloads that dataset.
 */
const EVENTS_KEPT = 600;

export function DataProvider({ children }) {
  // Only with Data switched on for your role (else the screen says "No feature access")
  const open = useAuth().can("data");
  const [datasets, setDatasets] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [versions, setVersions] = useState({}); // datasetId → versions (newest first)
  const [events, setEvents] = useState({}); // runId → events (oldest first)
  const [progress, setProgress] = useState({}); // runId → { stepIndex, done, total, unit }
  const [connected, setConnected] = useState(false);
  const [pendingSource, setPendingSource] = useState(null); // a source chosen in the Library, shown in the Workbench
  const [catalog, setCatalog] = useState(null); // the pipeline steps and their settings (from the engine)
  const [drafts, setDrafts] = useState({}); // datasetId → { open, steps } (the Clean-up panel)
  const [versionPick, setVersionPick] = useState({}); // datasetId → the version shown
  const [exporting, setExporting] = useState({}); // "<versionId>:<format>" → true while its download is packed
  const reloads = useRef(new Map());

  const putDataset = useCallback((d) => {
    setDatasets((list) => {
      const i = list.findIndex((x) => x.id === d.id);
      if (i < 0) return [d, ...list];
      const next = [...list];
      next[i] = d;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      setDatasets(await dataApi.listDatasets());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  const loadVersions = useCallback(async (datasetId) => {
    const list = await dataApi.listVersions(datasetId);
    setVersions((v) => ({ ...v, [datasetId]: list }));
    return list;
  }, []);

  const loadEvents = useCallback(async (runId) => {
    const list = await dataApi.runEvents(runId);
    setEvents((e) => ({ ...e, [runId]: list }));
  }, []);

  /** Reload one dataset (and its versions) soon; several events in a row cause one reload. */
  const reloadSoon = useCallback(
    (datasetId) => {
      clearTimeout(reloads.current.get(datasetId));
      reloads.current.set(
        datasetId,
        setTimeout(async () => {
          reloads.current.delete(datasetId);
          try {
            putDataset(await dataApi.getDataset(datasetId));
            await loadVersions(datasetId);
          } catch {
            /* removed meanwhile */
          }
        }, 300),
      );
    },
    [putDataset, loadVersions],
  );

  useEffect(() => {
    if (!open) return;
    dataApi.catalog().then(setCatalog).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    refresh();
    const stop = dataApi.subscribe(
      (e) => {
        setEvents((all) => {
          const list = all[e.runId] ?? [];
          if (list.length && list[list.length - 1].seq >= e.seq) return all;
          const next = list.length >= EVENTS_KEPT ? [...list.slice(-EVENTS_KEPT + 1), e] : [...list, e];
          return { ...all, [e.runId]: next };
        });
        if (e.kind === "progress") setProgress((p) => ({ ...p, [e.runId]: { stepIndex: e.stepIndex, ...e.data } }));
        if (e.kind === "state") reloadSoon(e.datasetId);
        if (e.kind === "state" && e.data?.run && ["succeeded", "failed", "cancelled"].includes(e.data.run)) setExporting({});
      },
      (up) => {
        setConnected(up);
        if (up) refresh(); // catch up after a gap
      },
    );
    return stop;
  }, [refresh, reloadSoon, open]);

  const value = useMemo(() => {
    const selected = datasets.find((d) => d.id === selectedId) ?? null;
    return {
      datasets,
      loaded,
      error,
      connected,
      selected,
      selectedId,
      versions,
      events,
      progress,
      pendingSource,
      catalog,
      drafts,
      versionPick,
      pickVersion: (datasetId, versionId) => setVersionPick((p) => ({ ...p, [datasetId]: versionId })),
      setDraft: (datasetId, draft) => setDrafts((d) => ({ ...d, [datasetId]: { ...(d[datasetId] ?? { open: false, steps: [] }), ...draft } })),
      /** "Fix this": opens the Clean-up panel with that step added (once). */
      addStep: (datasetId, op, params = {}) =>
        setDrafts((d) => {
          const cur = d[datasetId] ?? { open: true, steps: [] };
          const steps = cur.steps.some((s) => s.op === op) ? cur.steps : [...cur.steps.filter((s) => s.op !== "validate"), { op, params, enabled: true }, { op: "validate", params: {}, enabled: true }];
          return { ...d, [datasetId]: { open: true, steps } };
        }),
      async runPipeline(dataset, steps, inputVersionId) {
        await dataApi.startPipeline({ datasetId: dataset.id, inputVersionId, steps });
        setVersionPick((p) => ({ ...p, [dataset.id]: null }));
        setDrafts((d) => ({ ...d, [dataset.id]: { ...(d[dataset.id] ?? {}), open: false } }));
        reloadSoon(dataset.id);
      },
      exporting,
      async exportVersion(dataset, versionId, format) {
        await dataApi.startExport(versionId, format);
        setExporting((x) => ({ ...x, [`${versionId}:${format}`]: true }));
        reloadSoon(dataset.id);
      },
      async publish(dataset, versionId) {
        await dataApi.publish(versionId);
        reloadSoon(dataset.id);
      },
      refresh,
      loadVersions,
      loadEvents,
      select: (id) => {
        setSelectedId(id);
        if (id) setPendingSource(null);
      },
      chooseSource: (source) => {
        setSelectedId(null);
        setPendingSource(source);
      },
      clearSource: () => setPendingSource(null),

      async createFromSource({ source, name, config, split }) {
        const d = await dataApi.createDataset({ name, sourceId: source.id, config, split });
        putDataset(d);
        setPendingSource(null);
        setSelectedId(d.id);
        return d;
      },

      /** Your own files: one upload, its files one by one, then the dataset. */
      async createFromFiles({ name, files, onProgress }) {
        const { uploadId } = await dataApi.createUpload(name);
        const total = files.reduce((n, f) => n + f.file.size, 0);
        let sent = 0;
        for (const { path, file } of files) {
          await dataApi.uploadFile(uploadId, path, file, (bytes) => {
            sent += bytes;
            onProgress?.(sent, total);
          });
        }
        const d = await dataApi.createDataset({ name, uploadId });
        putDataset(d);
        setPendingSource(null);
        setSelectedId(d.id);
        return d;
      },

      async cancel(runId) {
        await dataApi.cancelRun(runId);
      },
      async retry(dataset) {
        await dataApi.retryRun(dataset.lastRun.id);
        reloadSoon(dataset.id);
      },
      async remove(id) {
        await dataApi.deleteDataset(id);
        setDatasets((list) => list.filter((d) => d.id !== id));
        setSelectedId((s) => (s === id ? null : s));
      },
      async rename(id, name) {
        await dataApi.renameDataset(id, name);
        reloadSoon(id);
      },
    };
  }, [datasets, loaded, error, connected, selectedId, versions, events, progress, pendingSource, catalog, drafts, versionPick, exporting, refresh, loadVersions, loadEvents, putDataset, reloadSoon]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
