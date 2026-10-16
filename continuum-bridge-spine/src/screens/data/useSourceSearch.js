import { useEffect, useState } from "react";
import { dataApi } from "../../data/dataApi";

/** The catalogue search: typed words and a kind of data; three letters or more also search online. */
export function useSourceSearch() {
  const [text, setText] = useState("");
  const [modality, setModality] = useState("");
  const [state, setState] = useState({ sources: [], loading: true, error: null, liveError: null });

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const r = await dataApi.searchSources({ q: text.trim(), modality, live: text.trim().length >= 3 });
        if (live) setState({ sources: r.sources, loading: false, error: null, liveError: r.liveError });
      } catch (e) {
        if (live) setState({ sources: [], loading: false, error: e.message, liveError: null });
      }
    }, text ? 400 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, modality]);

  return { text, setText, modality, setModality, ...state };
}
