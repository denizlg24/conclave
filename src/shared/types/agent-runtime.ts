import { Schema } from "effect";

import {
  AgentId,
  IsoDateTime,
  TaskId,
  TrimmedNonEmptyString,
  NonNegativeInt,
} from "./base-schemas";
import { AgentRole } from "./orchestration";

// ---------------------------------------------------------------------------
// Agent session configuration
// ---------------------------------------------------------------------------

export const AgentRoleConfig = Schema.Struct({
  role: AgentRole,
  systemPrompt: Schema.String,
  allowedTools: Schema.Array(Schema.String),
  maxTokens: NonNegativeInt,
  maxTurns: NonNegativeInt,
  model: TrimmedNonEmptyString,
  workingDirectory: Schema.String,
});
export type AgentRoleConfig = typeof AgentRoleConfig.Type;

// ---------------------------------------------------------------------------
// Token usage tracking
// ---------------------------------------------------------------------------

export const TokenUsage = Schema.Struct({
  inputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  cacheCreationInputTokens: NonNegativeInt,
  cacheReadInputTokens: NonNegativeInt,
});
export type TokenUsage = typeof TokenUsage.Type;

// ---------------------------------------------------------------------------
// Claude Code raw event types (from --output-format stream-json --verbose)
// ---------------------------------------------------------------------------

const ClaudeMessageContent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("tool_use"),
    id: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("tool_result"),
    tool_use_id: Schema.String,
    content: Schema.Unknown,
  }),
]);

const ClaudeAssistantMessage = Schema.Struct({
  model: Schema.String,
  id: Schema.String,
  role: Schema.Literal("assistant"),
  content: Schema.Array(ClaudeMessageContent),
  stop_reason: Schema.NullOr(Schema.String),
  usage: Schema.Struct({
    input_tokens: NonNegativeInt,
    output_tokens: NonNegativeInt,
    cache_creation_input_tokens: Schema.optional(NonNegativeInt),
    cache_read_input_tokens: Schema.optional(NonNegativeInt),
  }),
});

export const ClaudeCodeRawEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("system"),
    subtype: Schema.String,
    session_id: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("assistant"),
    message: ClaudeAssistantMessage,
    session_id: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("result"),
    subtype: Schema.String,
    is_error: Schema.Boolean,
    duration_ms: NonNegativeInt,
    num_turns: NonNegativeInt,
    result: Schema.String,
    session_id: Schema.String,
    total_cost_usd: Schema.Number,
    usage: Schema.Struct({
      input_tokens: NonNegativeInt,
      output_tokens: NonNegativeInt,
      cache_creation_input_tokens: Schema.optional(NonNegativeInt),
      cache_read_input_tokens: Schema.optional(NonNegativeInt),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("rate_limit_event"),
    session_id: Schema.String,
  }),
]);
export type ClaudeCodeRawEvent = typeof ClaudeCodeRawEvent.Type;

// ---------------------------------------------------------------------------
// Normalized agent runtime events (our domain events)
// ---------------------------------------------------------------------------

export const AgentSessionStarted = Schema.Struct({
  type: Schema.Literal("agent.session.started"),
  agentId: AgentId,
  role: AgentRole,
  sessionId: Schema.String,
  model: TrimmedNonEmptyString,
  occurredAt: IsoDateTime,
});

export const AgentTurnStarted = Schema.Struct({
  type: Schema.Literal("agent.turn.started"),
  agentId: AgentId,
  sessionId: Schema.String,
  taskId: Schema.NullOr(TaskId),
  prompt: Schema.String,
  occurredAt: IsoDateTime,
});

export const AgentToolInvoked = Schema.Struct({
  type: Schema.Literal("agent.tool.invoked"),
  agentId: AgentId,
  sessionId: Schema.String,
  toolName: Schema.String,
  toolInput: Schema.Unknown,
  toolUseId: Schema.String,
  occurredAt: IsoDateTime,
});

export const AgentOutputProduced = Schema.Struct({
  type: Schema.Literal("agent.output.produced"),
  agentId: AgentId,
  sessionId: Schema.String,
  content: Schema.String,
  occurredAt: IsoDateTime,
});

export const AgentTurnCompleted = Schema.Struct({
  type: Schema.Literal("agent.turn.completed"),
  agentId: AgentId,
  sessionId: Schema.String,
  usage: TokenUsage,
  durationMs: NonNegativeInt,
  costUsd: Schema.Number,
  occurredAt: IsoDateTime,
});

export const AgentSessionEnded = Schema.Struct({
  type: Schema.Literal("agent.session.ended"),
  agentId: AgentId,
  sessionId: Schema.String,
  totalUsage: TokenUsage,
  totalCostUsd: Schema.Number,
  reason: Schema.String,
  occurredAt: IsoDateTime,
});

export const AgentError = Schema.Struct({
  type: Schema.Literal("agent.error"),
  agentId: AgentId,
  sessionId: Schema.String,
  error: Schema.String,
  occurredAt: IsoDateTime,
});

export const AgentRuntimeEvent = Schema.Union([
  AgentSessionStarted,
  AgentTurnStarted,
  AgentToolInvoked,
  AgentOutputProduced,
  AgentTurnCompleted,
  AgentSessionEnded,
  AgentError,
]);
export type AgentRuntimeEvent = typeof AgentRuntimeEvent.Type;
