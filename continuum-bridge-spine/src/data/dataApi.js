/**
 * Client for continuum-data's /data routes. It reaches them only through
 * VITE_DATA_API_URL (default: the Continuum API + /data), so the engine can
 * move to a server of its own without touching the screens.
 */
const TOKEN_KEY = "continuum_token";

export const DATA_ENABLED = import.meta.env.VITE_DATA_ENABLED === "true";
const BASE = import.meta.env.VITE_DATA_API_URL || `${import.meta.env.VITE_API_BASE_URL}/data`;

const authHeader = () => {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...authHeader(), ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw Object.assign(new Error(data?.error || "Something went wrong."), { code: data?.code ?? null, status: res.status });
  return data;
}

const q = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
  return s ? `?${s}` : "";
};

export const dataApi = {
  me: () => request("GET", "/me"),
  searchSources: ({ q: text, modality, live }) => request("GET", `/sources${q({ q: text, modality, live: live ? 1 : undefined })}`),
  getSource: (id) => request("GET", `/sources/${id}`).then((r) => r.source),
  listDatasets: () => request("GET", "/datasets").then((r) => r.datasets),
  getDataset: (id) => request("GET", `/datasets/${id}`).then((r) => r.dataset),
  createDataset: (body) => request("POST", "/datasets", body).then((r) => r.dataset),
  renameDataset: (id, name) => request("PATCH", `/datasets/${id}`, { name }).then((r) => r.dataset),
  deleteDataset: (id) => request("DELETE", `/datasets/${id}`),
  listVersions: (datasetId) => request("GET", `/datasets/${datasetId}/versions`).then((r) => r.versions),
  rows: (versionId, offset, limit) => request("GET", `/versions/${versionId}/rows${q({ offset, limit })}`),
  profile: (versionId) => request("GET", `/versions/${versionId}/profile`).then((r) => r.profile),
  runEvents: (runId, afterSeq = 0) => request("GET", `/runs/${runId}/events${q({ afterSeq })}`).then((r) => r.events),
  cancelRun: (runId) => request("POST", `/runs/${runId}/cancel`).then((r) => r.run),
  retryRun: (runId) => request("POST", `/runs/${runId}/retry`).then((r) => r.run),
  createUpload: (name) => request("POST", "/uploads", { name }),

  /** One file of an upload, sent as it is (not as JSON). */
  async uploadFile(uploadId, path, file, onProgress) {
    const res = await fetch(`${BASE}/uploads/${uploadId}/files${q({ path })}`, {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/octet-stream" },
      body: file,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.error || `Couldn't upload ${path}.`), { code: data?.code ?? null });
    onProgress?.(file.size);
    return data;
  },

  /**
   * Live run events. A fetch stream rather than EventSource, so the sign-in
   * stays in a header. Reconnects after a gap; returns a function that stops it.
   */
  subscribe(onEvent, onState) {
    let stopped = false;
    let controller = null;
    (async () => {
      let delay = 1000;
      while (!stopped) {
        controller = new AbortController();
        try {
          const res = await fetch(`${BASE}/events`, { headers: authHeader(), signal: controller.signal });
          if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
          onState?.(true);
          delay = 1000;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const data = block.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
              if (data) {
                try {
                  onEvent(JSON.parse(data));
                } catch {
                  /* a partial or foreign message: skip it */
                }
              }
            }
          }
        } catch {
          /* closed or unreachable: try again below */
        }
        onState?.(false);
        if (stopped) break;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    })();
    return () => {
      stopped = true;
      controller?.abort();
    };
  },
};
