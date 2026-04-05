import type { Effect, Stream } from "effect";

import type { AgentId, TaskId } from "@/shared/types/base-schemas";
import type {
  AgentRoleConfig,
  AgentRuntimeEvent,
  TokenUsage,
} from "@/shared/types/agent-runtime";
import type { AgentRole } from "@/shared/types/orchestration";

import type { AgentError } from "./errors";

// ---------------------------------------------------------------------------
// Session state tracked by the adapter
// ---------------------------------------------------------------------------

export interface AgentSession {
  readonly agentId: AgentId;
  readonly role: AgentRole;
  readonly claudeSessionId: string;
  readonly model: string;
  readonly config: AgentRoleConfig;
  readonly cumulativeUsage: TokenUsage;
  readonly cumulativeCostUsd: number;
  readonly turnCount: number;
  readonly startedAt: string;
}

// ---------------------------------------------------------------------------
// Adapter interface (ported from ProviderAdapter pattern)
// ---------------------------------------------------------------------------

export interface AgentAdapterShape {
  readonly startSession: (
    agentId: AgentId,
    config: AgentRoleConfig,
  ) => Effect.Effect<AgentSession, AgentError>;

  readonly sendMessage: (
    agentId: AgentId,
    prompt: string,
    taskId: TaskId | null,
  ) => Effect.Effect<string, AgentError>;

  readonly interrupt: (agentId: AgentId) => Effect.Effect<void, AgentError>;

  readonly stopSession: (agentId: AgentId) => Effect.Effect<void, AgentError>;

  readonly getSession: (
    agentId: AgentId,
  ) => Effect.Effect<AgentSession | null>;

  readonly listSessions: () => Effect.Effect<ReadonlyArray<AgentSession>>;

  readonly streamEvents: Stream.Stream<AgentRuntimeEvent>;
}
