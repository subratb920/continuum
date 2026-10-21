import { useLayoutEffect, useRef, useState } from "react";
import { useModelSettings } from "../brain/useModelSettings";
import ModelPicker from "../screens/brain/ModelPicker";
import "./ModelSettingsBar.css";

/** The short name of a "provider/model" id (e.g. "anthropic/claude-x" → "claude-x"). */
const shortName = (id) => (id ? String(id).split("/").slice(1).join("/") || String(id) : null);

function Chevron({ open }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className={`msbar-chevron${open ? " is-open" : ""}`}>
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function FlipIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11.5 1.6v3h-3M4.5 14.4v-3h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A global header at the top of every left pane: "Model settings". Click it to
 * open a small card (the models in use); flip the card to the picker (the
 * brain's and workers' models), which expands to per-tier models, speed and
 * tools. Nothing shows when the brain's settings aren't reachable here.
 */
export default function ModelSettingsBar() {
  const models = useModelSettings();
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const [faceH, setFaceH] = useState(undefined);

  // The card's height follows the face that shows (the picker grows when expanded),
  // and the open body follows the card — so the pane's content below is pushed down.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const el = flipped ? backRef.current : frontRef.current;
      if (el) setFaceH(el.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (frontRef.current) ro.observe(frontRef.current);
    if (backRef.current) ro.observe(backRef.current);
    return () => ro.disconnect();
  }, [open, flipped]);

  if (!models.available) return null;

  const eff = models.effective ?? { brain: models.model, worker: models.model };
  const brain = shortName(eff.brain) ?? "…";
  const worker = shortName(eff.worker) ?? brain;
  const hint = models.canSplit ? (models.autoRoute ? "Auto" : brain === worker ? brain : `${brain} · ${worker}`) : shortName(models.model) ?? "…";

  return (
    <div className={`msbar${open ? " is-open" : ""}`}>
      <button type="button" className="msbar-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="msbar-title">Model settings</span>
        <span className="msbar-hint" title="The models your agents run on">{hint}</span>
        <Chevron open={open} />
      </button>

      <div className="msbar-body">
        <div className="msbar-body-inner">
          <div className={`msbar-flip${flipped ? " is-flipped" : ""}`} style={faceH ? { height: faceH } : undefined}>
            {/* Front: the models in use, at a glance */}
            <div className="msbar-face msbar-front" ref={frontRef} aria-hidden={flipped} {...(flipped ? { inert: "" } : {})}>
              <dl className="msbar-glance">
                <div><dt>Brain</dt><dd className="brain-mono" title={eff.brain ?? ""}>{brain}</dd></div>
                <div><dt>Workers</dt><dd className="brain-mono" title={eff.worker ?? ""}>{worker}</dd></div>
                {models.canSplit && <div><dt>Routing</dt><dd>{models.autoRoute ? "Auto (per task)" : "Fixed"}</dd></div>}
              </dl>
              <button type="button" className="msbar-flip-btn" onClick={() => setFlipped(true)} aria-label="Change the models" title="Change">
                <FlipIcon /> Change
              </button>
            </div>
            {/* Back: the picker */}
            <div className="msbar-face msbar-back" ref={backRef} aria-hidden={!flipped} {...(flipped ? {} : { inert: "" })}>
              <div className="msbar-back-head">
                <span className="msbar-back-title">Models</span>
                <button type="button" className="msbar-flip-btn" onClick={() => setFlipped(false)} aria-label="Back to the models in use" title="Done">
                  <FlipIcon /> Done
                </button>
              </div>
              <ModelPicker models={models} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
