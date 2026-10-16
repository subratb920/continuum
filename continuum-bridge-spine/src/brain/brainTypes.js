/**
 * The brain's shapes, as the UI receives them. Mirrors continuum-brain's
 * packages/store/src/agents.ts (Agent) and events.ts (AgentEvent); ids and
 * dates arrive as strings.
 *
 * @typedef {"queued"|"starting"|"working"|"idle"|"stopping"|"stopped"|"failed"} AgentState
 *   queued → starting → working ⇄ idle → stopping → stopped; any → failed
 * @typedef {"worker"|"core"} AgentKind
 *
 * @typedef {object} Agent
 * @property {string} _id
 * @property {AgentKind} kind
 * @property {string|null} projectId
 * @property {string|null} repo     "owner/name"; null for the core
 * @property {string|null} branch   continuum/agent-<id>; never main
 * @property {string} task
 * @property {string} model
 * @property {"small"|"standard"|"large"} size
 * @property {AgentState} state
 * @property {{code: string, message: string}|null} error
 * @property {string} createdAt
 * @property {string|null} startedAt
 * @property {string|null} finishedAt
 *
 * @typedef {"user"|"state"|"text"|"tool"|"permission"|"question"|"error"} AgentEventKind
 *   user (what you sent it), state (its state changed), text (what it says),
 *   tool (a tool call), permission (it asks to act), question (it asks you), error
 *
 * @typedef {object} AgentEvent
 * @property {string} _id           ordered: a later event has a greater id (the stream's cursor)
 * @property {string} agentId
 * @property {string} at
 * @property {AgentEventKind} kind
 * @property {string} text
 * @property {Record<string, unknown>} [data]  state: {state}; tool: {tool, target}; user replies: {replyTo, answer}
 *
 * A client streams two kinds of message: { type: "agent", agent } (an agent
 * was added or changed) and { type: "event", event }.
 *
 * @typedef {object} BrainClient
 * @property {() => Promise<Agent[]>} listAgents
 * @property {(onMessage: (m: {type: "agent", agent: Agent} | {type: "event", event: AgentEvent}) => void, opts?: {after?: string}) => () => void} subscribe
 *   returns unsubscribe
 * @property {(task: string, opts?: {repo?: string}) => Promise<void>} spawn   asks the core to start a worker
 * @property {(agentId: string) => Promise<void>} stop
 * @property {(agentId: string, eventId: string, answer: string) => Promise<void>} reply  answers a permission or question
 * @property {(text: string) => Promise<void>} say  a message to the core
 */

export const ACTIVE_STATES = ["queued", "starting", "working", "idle", "stopping"];

/** Waiting on you: a permission or a question. */
export const ASKING_KINDS = ["permission", "question"];

export const STATE_LABEL = {
  queued: "Queued",
  starting: "Starting",
  working: "Working",
  idle: "Idle",
  stopping: "Stopping",
  stopped: "Stopped",
  failed: "Failed",
};
