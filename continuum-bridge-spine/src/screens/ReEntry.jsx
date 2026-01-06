import React from "react";
import IntervalSetup from "./IntervalSetup";

export default function ReEntry({
  activeProject,
  onIntervalStarted,
}) {
  return (
    <IntervalSetup
      activeProject={activeProject}
      onIntervalStarted={onIntervalStarted}
    />
  );
}
