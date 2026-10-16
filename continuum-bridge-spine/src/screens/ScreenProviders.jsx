import { SCREENS } from "./registry";

/**
 * Every screen's Provider, around the whole console (header included): a
 * screen keeps its state while another shows, and the switcher's badges stay live.
 */
export function ScreenProviders({ children }) {
  return SCREENS.reduceRight((inner, s) => (s.Provider ? <s.Provider>{inner}</s.Provider> : inner), children);
}
