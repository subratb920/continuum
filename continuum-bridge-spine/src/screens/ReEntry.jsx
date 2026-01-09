import React from "react";
import IntervalSetup from "./IntervalSetup";

export default function ReEntry({
  activeProject,
  selectedProject,
  onIntervalStarted,
}) {
  return (
    <IntervalSetup
      activeProject={activeProject}
      selectedProject={selectedProject}
      onIntervalStarted={onIntervalStarted}
    />
  );
}
