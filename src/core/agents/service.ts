import { Effect, Stream } from "effect";

import type { AgentId, TaskId } from "@/shared/types/base-schemas";
import type {
  AgentRoleConfig,
  AgentRuntimeEvent,
} from "@/shared/types/agent-runtime";
import type { AgentRole } from "@/shared/types/orchestration";

import type { AgentAdapterShape, AgentSession } from "./adapter";
import { AgentAdapterError } from "./errors";
import type { AgentError } from "./errors";

// ---------------------------------------------------------------------------
// Default role configurations (MVP: PM, Developer, Reviewer)
// ---------------------------------------------------------------------------

const DEFAULT_ROLE_CONFIGS: Record<
  string,
  Omit<AgentRoleConfig, "workingDirectory">
> = {
  pm: {
    role: "pm",
    systemPrompt: [
      "You are a Project Manager agent in the Conclave orchestration system.",
      "Your responsibilities: decompose projects into atomic tasks, run planning meetings, manage priorities.",
      "You CANNOT write code or modify files directly.",
      "You communicate through structured task creation and status updates.",
      "Always produce structured JSON output matching the task schema when creating tasks.",
    ].join("\n"),
    allowedTools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
    maxTokens: 16384,
    maxTurns: 10,
    model: "claude-sonnet-4-6",
  },
  developer: {
    role: "developer",
    systemPrompt: [
      "You are a Developer agent in the Conclave orchestration system.",
      "Your responsibilities: implement code changes, fix bugs, write tests as directed by task assignments.",
      "You CANNOT modify task priorities or create new tasks outside your assignment.",
      "You work within the scope of your assigned task and report results as structured output.",
    ].join("\n"),
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash",
      "LSP",
    ],
    maxTokens: 32768,
    maxTurns: 25,
    model: "claude-sonnet-4-6",
  },
  reviewer: {
    role: "reviewer",
    systemPrompt: [
      "You are a Code Reviewer agent in the Conclave orchestration system.",
      "Your responsibilities: review code changes, check for bugs, suggest improvements, approve or reject work.",
      "You CANNOT create tasks or modify code directly.",
      "Produce structured review feedback with approve/reject decisions and specific comments.",
    ].join("\n"),
    allowedTools: ["Read", "Glob", "Grep", "Bash"],
    maxTokens: 16384,
    maxTurns: 5,
    model: "claude-sonnet-4-6",
  },
};

// ---------------------------------------------------------------------------
// AgentService interface
// ---------------------------------------------------------------------------

export interface AgentServiceShape {
  readonly startAgent: (
    agentId: AgentId,
    role: AgentRole,
    workingDirectory: string,
    configOverrides?: Partial<AgentRoleConfig>,
  ) => Effect.Effect<AgentSession, AgentError>;

  readonly sendMessage: (
    agentId: AgentId,
    prompt: string,
    taskId?: TaskId | null,
  ) => Effect.Effect<string, AgentError>;

  readonly interruptAgent: (
    agentId: AgentId,
  ) => Effect.Effect<void, AgentError>;

  readonly stopAgent: (agentId: AgentId) => Effect.Effect<void, AgentError>;

  readonly stopAll: () => Effect.Effect<void>;

  readonly getAgent: (
    agentId: AgentId,
  ) => Effect.Effect<AgentSession | null>;

  readonly listAgents: () => Effect.Effect<ReadonlyArray<AgentSession>>;

  readonly streamEvents: Stream.Stream<AgentRuntimeEvent>;
}

// ---------------------------------------------------------------------------
// AgentService implementation
// ---------------------------------------------------------------------------

export function createAgentService(
  adapter: AgentAdapterShape,
): AgentServiceShape {
  const startAgent: AgentServiceShape["startAgent"] = (
    agentId,
    role,
    workingDirectory,
    configOverrides,
  ) =>
    Effect.gen(function* () {
      const defaults = DEFAULT_ROLE_CONFIGS[role];
      if (!defaults) {
        return yield* Effect.fail(
          new AgentAdapterError({
            agentId,
            operation: "startAgent",
            detail: `No default configuration for role '${role}'.`,
          }),
        );
      }

      const config: AgentRoleConfig = {
        ...defaults,
        workingDirectory,
        ...configOverrides,
        role,
      };

      return yield* adapter.startSession(agentId, config);
    });

  const sendMessage: AgentServiceShape["sendMessage"] = (
    agentId,
    prompt,
    taskId,
  ) => adapter.sendMessage(agentId, prompt, taskId ?? null);

  const interruptAgent: AgentServiceShape["interruptAgent"] = (agentId) =>
    adapter.interrupt(agentId);

  const stopAgent: AgentServiceShape["stopAgent"] = (agentId) =>
    adapter.stopSession(agentId);

  const stopAll: AgentServiceShape["stopAll"] = () =>
    Effect.gen(function* () {
      const sessions = yield* adapter.listSessions();
      for (const session of sessions) {
        yield* adapter.stopSession(session.agentId).pipe(Effect.ignore);
      }
    });

  const getAgent: AgentServiceShape["getAgent"] = (agentId) =>
    adapter.getSession(agentId);

  const listAgents: AgentServiceShape["listAgents"] = () =>
    adapter.listSessions();

  const streamEvents: AgentServiceShape["streamEvents"] =
    adapter.streamEvents;

  return {
    startAgent,
    sendMessage,
    interruptAgent,
    stopAgent,
    stopAll,
    getAgent,
    listAgents,
    streamEvents,
  } satisfies AgentServiceShape;
}
