import { createContext, useContext } from "react";

/** The Data screen's state and actions (DataProvider fills it). */
export const DataContext = createContext(null);

export function useData() {
  return useContext(DataContext);
}

/** Datasets being built (the switcher's badge). */
export function useBuildingCount() {
  return useContext(DataContext)?.datasets.filter((d) => d.state === "building").length ?? 0;
}
