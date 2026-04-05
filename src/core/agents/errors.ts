import { Data } from "effect";

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

export type AgentError =
  | AgentAdapterError
  | AgentSessionNotFoundError
  | AgentSpawnError
  | AgentBudgetExceededError;
