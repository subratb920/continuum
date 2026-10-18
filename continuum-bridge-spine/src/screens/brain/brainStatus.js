/**
 * Where the brain stands: its state in the usual words (Stopped is Stopped),
 * a colour, and what happens next: { tone, label, hint, pulse? }.
 */
export function brainStatus(core, connected) {
  if (connected === false) return { tone: "amber", label: "Reconnecting", hint: "Messages show once the connection is back." };
  switch (core?.state) {
    case "queued":
    case "starting":
      return { tone: "amber", label: "Starting", pulse: true, hint: "Takes about a minute the first time." };
    case "working":
      return { tone: "violet", label: "Working", pulse: true, hint: "Replies appear here as it goes." };
    case "idle":
      return { tone: "green", label: "Ready", hint: "Send a message to give it work." };
    case "stopping":
      return { tone: "grey", label: "Stopping", stop: true, hint: "It can be started again with a message." };
    case "failed":
      return { tone: "red", label: "Failed", hint: "Send a message to start it again." };
    default:
      return { tone: "grey", label: "Stopped", stop: true, hint: "Sending a message starts it." };
  }
}
