import { Data } from "effect";

import type { AdapterType } from "@/shared/types/adapter";

export class AgentAdapterError extends Data.TaggedError(
  "AgentAdapterError",
)<{
  readonly agentId: string;
  readonly operation: string;
  readonly detail: string;
}> {}

export class AgentSessionNotFoundError extends Data.TaggedError(
  "AgentSessionNotFoundError",
)<{
  readonly agentId: string;
  readonly sessionId: string;
}> {}

export class AgentSpawnError extends Data.TaggedError("AgentSpawnError")<{
  readonly agentId: string;
  readonly command: string;
  readonly detail: string;
}> {}

export class AgentBudgetExceededError extends Data.TaggedError(
  "AgentBudgetExceededError",
)<{
  readonly agentId: string;
  readonly sessionId: string;
  readonly budgetType: "tokens" | "turns" | "cost";
  readonly limit: number;
  readonly current: number;
}> {}

/**
 * Error indicating that the external provider's usage quota has been exhausted.
 * This is a recoverable error - tasks should be suspended rather than failed.
 */
export class AgentQuotaExhaustedError extends Data.TaggedError(
  "AgentQuotaExhaustedError",
)<{
  readonly agentId: string;
  readonly sessionId: string;
  readonly adapterType: AdapterType;
  readonly rawMessage: string;
  readonly detectedAt: string;
}> {
  get isRecoverable(): boolean {
    return true;
  }
}

export type AgentError =
  | AgentAdapterError
  | AgentSessionNotFoundError
  | AgentSpawnError
  | AgentBudgetExceededError
  | AgentQuotaExhaustedError;
