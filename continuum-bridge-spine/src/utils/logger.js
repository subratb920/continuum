import { getPreferences } from "./preferences";

// Development builds always log; elsewhere only with Settings → Developer → Show debug logs
const enabled = () => import.meta.env.DEV || getPreferences().debugLogs;

function log(level, scope, message, data) {
  if (!enabled()) return;

  const time = new Date().toISOString();
  console[level](
    `[${time}] [${scope}] ${message}`,
    data ?? ""
  );
}

export const logger = {
  ui: (msg, data) => log("log", "UI", msg, data),
  api: (msg, data) => log("log", "API", msg, data),
  state: (msg, data) => log("log", "STATE", msg, data),
  lifecycle: (msg, data) => log("log", "LIFECYCLE", msg, data),
  error: (msg, data) => log("error", "ERROR", msg, data),
};
