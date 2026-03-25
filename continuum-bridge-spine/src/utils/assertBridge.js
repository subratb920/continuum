/**
 * Runtime contract for Bridge objects
 * This is NOT validation logic — this is invariant enforcement.
 */

export function assertBridge(bridge) {
  if (!bridge || typeof bridge !== "object") {
    throw new Error("Invalid bridge: not an object");
  }

  // Identity
  if (typeof bridge._id !== "string") {
    throw new Error("Bridge missing _id");
  }

  if (typeof bridge.projectId !== "string") {
    throw new Error("Bridge missing projectId");
  }

  // Naming
  if (typeof bridge.name !== "string") {
    throw new Error("Bridge missing name");
  }

  // Status
  if (!["draft", "finalized", "abandoned"].includes(bridge.status)) {
    throw new Error(`Invalid bridge status: ${bridge.status}`);
  }

  // Interval (historical truth)
  if (!bridge.interval || typeof bridge.interval !== "object") {
    throw new Error("Bridge missing interval");
  }

  if (typeof bridge.interval.mode !== "string") {
    throw new Error("Bridge.interval.mode invalid");
  }

  if (typeof bridge.interval.duration !== "number") {
    throw new Error("Bridge.interval.duration invalid");
  }

  // Session goals (ALWAYS array)
  if (!Array.isArray(bridge.sessionGoals)) {
    throw new Error("Bridge.sessionGoals must be an array");
  }

  bridge.sessionGoals.forEach((g, i) => {
    if (!g || typeof g !== "object") {
      throw new Error(`Invalid goal at index ${i}`);
    }

    if (typeof g.text !== "string") {
      throw new Error(`Goal.text invalid at index ${i}`);
    }

    if (!["untouched", "completed", "incomplete"].includes(g.status)) {
      throw new Error(`Invalid goal status at index ${i}`);
    }
  });

  // Timestamps
  if (!bridge.createdAt) {
    throw new Error("Bridge missing createdAt");
  }
}
