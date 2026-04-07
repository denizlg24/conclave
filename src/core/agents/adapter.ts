import type { Effect, Stream } from "effect";

import type { AgentId, TaskId } from "@/shared/types/base-schemas";
import type {
  AgentRoleConfig,
  AgentRuntimeEvent,
  TokenUsage,
} from "@/shared/types/agent-runtime";
import type { AgentRole } from "@/shared/types/orchestration";

import type { AgentError } from "./errors";

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

/**
 * Result of checking for quota exhaustion in adapter output.
 * Each adapter implements its own detection logic.
 */
export interface QuotaExhaustedCheckResult {
  readonly isExhausted: boolean;
  readonly rawMessage: string | null;
}

/**
 * Interface for detecting quota exhaustion from adapter-specific output.
 * Each adapter type implements its own patterns.
 */
export interface QuotaExhaustedDetector {
  readonly adapterType: string;
  /**
   * Check if the given output or error message indicates quota exhaustion.
   * @param content - stdout/stderr content or error message to check
   * @returns Result indicating if quota is exhausted and the raw message
   */
  readonly check: (content: string) => QuotaExhaustedCheckResult;
}

export interface AgentAdapterShape {
  readonly startSession: (
    agentId: AgentId,
    config: AgentRoleConfig,
  ) => Effect.Effect<AgentSession, AgentError>;

  readonly sendMessage: (
    agentId: AgentId,
    prompt: string,
    taskId: TaskId | null,
    resumeSessionId?: string | null,
  ) => Effect.Effect<string, AgentError>;

  readonly interrupt: (agentId: AgentId) => Effect.Effect<void, AgentError>;

  readonly stopSession: (agentId: AgentId) => Effect.Effect<void, AgentError>;

  readonly getSession: (agentId: AgentId) => Effect.Effect<AgentSession | null>;

  readonly listSessions: () => Effect.Effect<ReadonlyArray<AgentSession>>;

  readonly streamEvents: Stream.Stream<AgentRuntimeEvent>;

  /**
   * Quota detector for this adapter type.
   * Used to check if output/errors indicate quota exhaustion.
   */
  readonly quotaDetector: QuotaExhaustedDetector;
}
