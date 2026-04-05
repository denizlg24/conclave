import { Effect, Queue, Ref, Stream } from "effect";

import type { AgentId } from "@/shared/types/base-schemas";
import type {
  AgentRoleConfig,
  AgentRuntimeEvent,
  TokenUsage,
} from "@/shared/types/agent-runtime";

import type { AgentAdapterShape, AgentSession } from "./adapter";
import {
  AgentAdapterError,
  AgentSessionNotFoundError,
  AgentSpawnError,
  AgentBudgetExceededError,
} from "./errors";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ManagedSession extends AgentSession {
  readonly process: { kill: (signal?: number) => void } | null;
}

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

const nowIso = () => new Date().toISOString();

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens:
      a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

// ---------------------------------------------------------------------------
// Parse one NDJSON line from Claude Code stream-json output
// ---------------------------------------------------------------------------

interface ParsedAssistant {
  readonly kind: "assistant";
  readonly sessionId: string;
  readonly content: ReadonlyArray<{
    type: string;
    text?: string;
    name?: string;
    id?: string;
    input?: unknown;
  }>;
  readonly usage: TokenUsage;
  readonly model: string;
}

interface ParsedResult {
  readonly kind: "result";
  readonly sessionId: string;
  readonly isError: boolean;
  readonly result: string;
  readonly durationMs: number;
  readonly numTurns: number;
  readonly costUsd: number;
  readonly usage: TokenUsage;
}

interface ParsedInit {
  readonly kind: "init";
  readonly sessionId: string;
}

interface ParsedOther {
  readonly kind: "other";
}

type ParsedEvent = ParsedAssistant | ParsedResult | ParsedInit | ParsedOther;

function parseRawLine(line: string): ParsedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const type = raw["type"] as string | undefined;
  if (!type) return null;

  if (type === "system" && raw["subtype"] === "init") {
    return {
      kind: "init",
      sessionId: (raw["session_id"] as string) ?? "",
    };
  }

  if (type === "assistant") {
    const msg = raw["message"] as Record<string, unknown> | undefined;
    if (!msg) return null;
    const usage = msg["usage"] as Record<string, number> | undefined;
    return {
      kind: "assistant",
      sessionId: (raw["session_id"] as string) ?? "",
      content: (msg["content"] as ParsedAssistant["content"]) ?? [],
      usage: {
        inputTokens: usage?.["input_tokens"] ?? 0,
        outputTokens: usage?.["output_tokens"] ?? 0,
        cacheCreationInputTokens:
          usage?.["cache_creation_input_tokens"] ?? 0,
        cacheReadInputTokens: usage?.["cache_read_input_tokens"] ?? 0,
      },
      model: (msg["model"] as string) ?? "unknown",
    };
  }

  if (type === "result") {
    const usage = raw["usage"] as Record<string, number> | undefined;
    return {
      kind: "result",
      sessionId: (raw["session_id"] as string) ?? "",
      isError: (raw["is_error"] as boolean) ?? false,
      result: (raw["result"] as string) ?? "",
      durationMs: (raw["duration_ms"] as number) ?? 0,
      numTurns: (raw["num_turns"] as number) ?? 0,
      costUsd: (raw["total_cost_usd"] as number) ?? 0,
      usage: {
        inputTokens: usage?.["input_tokens"] ?? 0,
        outputTokens: usage?.["output_tokens"] ?? 0,
        cacheCreationInputTokens:
          usage?.["cache_creation_input_tokens"] ?? 0,
        cacheReadInputTokens: usage?.["cache_read_input_tokens"] ?? 0,
      },
    };
  }

  return { kind: "other" };
}

// ---------------------------------------------------------------------------
// Build the CLI args for a Claude Code invocation
// ---------------------------------------------------------------------------

function buildClaudeArgs(
  config: AgentRoleConfig,
  prompt: string,
  resumeSessionId: string | null,
): string[] {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--bare",
    "--model",
    config.model,
    "--max-turns",
    String(config.maxTurns),
  ];

  if (config.maxTokens > 0) {
    args.push("--max-tokens", String(config.maxTokens));
  }

  if (config.allowedTools.length > 0) {
    args.push("--allowedTools", config.allowedTools.join(" "));
  }

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  } else {
    args.push("--system-prompt", config.systemPrompt);
  }

  args.push(prompt);
  return args;
}

// ---------------------------------------------------------------------------
// Read NDJSON lines from a ReadableStream
// ---------------------------------------------------------------------------

async function* readNdjsonLines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim()) yield line;
      }
    }

    if (buffer.trim()) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Claude Code Adapter implementation
// ---------------------------------------------------------------------------

export function createClaudeCodeAdapter(): Effect.Effect<AgentAdapterShape> {
  return Effect.gen(function* () {
    const sessionsRef = yield* Ref.make<Map<string, ManagedSession>>(
      new Map(),
    );
    const eventQueue = yield* Queue.unbounded<AgentRuntimeEvent>();

    const emit = (event: AgentRuntimeEvent) => Queue.offer(eventQueue, event);

    const getSessionOrFail = (agentId: AgentId) =>
      Effect.gen(function* () {
        const sessions = yield* Ref.get(sessionsRef);
        const session = sessions.get(agentId);
        if (!session) {
          return yield* Effect.fail(
            new AgentSessionNotFoundError({
              agentId,
              sessionId: "unknown",
            }),
          );
        }
        return session;
      });

    const updateSession = (
      agentId: AgentId,
      patch: Partial<ManagedSession>,
    ) =>
      Ref.update(sessionsRef, (sessions) => {
        const current = sessions.get(agentId);
        if (!current) return sessions;
        const next = new Map(sessions);
        next.set(agentId, { ...current, ...patch });
        return next;
      });

    // ------------------------------------------------------------------
    // Core: spawn Claude Code and stream events
    // ------------------------------------------------------------------

    const runClaudeProcess = (
      agentId: AgentId,
      config: AgentRoleConfig,
      prompt: string,
      resumeSessionId: string | null,
    ): Effect.Effect<string, AgentAdapterError | AgentSpawnError> =>
      Effect.gen(function* () {
        const args = buildClaudeArgs(config, prompt, resumeSessionId);

        const proc = yield* Effect.try({
          try: () =>
            Bun.spawn(["claude", ...args], {
              cwd: config.workingDirectory,
              stdout: "pipe",
              stderr: "pipe",
              stdin: "ignore",
            }),
          catch: (err) =>
            new AgentSpawnError({
              agentId,
              command: `claude ${args.join(" ")}`,
              detail: String(err),
            }),
        });

        // Store process reference for interruption
        yield* updateSession(agentId, {
          process: { kill: (sig) => proc.kill(sig) },
        });

        const stdout = proc.stdout as ReadableStream<Uint8Array>;
        const stderr = proc.stderr as ReadableStream<Uint8Array>;

        const result = yield* Effect.tryPromise({
          try: async () => {
            let resultText = "";
            let detectedSessionId = resumeSessionId ?? "";

            for await (const line of readNdjsonLines(stdout)) {
              const parsed = parseRawLine(line);
              if (!parsed) continue;

              switch (parsed.kind) {
                case "init": {
                  detectedSessionId = parsed.sessionId;
                  break;
                }

                case "assistant": {
                  if (!detectedSessionId && parsed.sessionId) {
                    detectedSessionId = parsed.sessionId;
                  }

                  for (const block of parsed.content) {
                    if (block.type === "text" && block.text) {
                      Effect.runSync(
                        emit({
                          type: "agent.output.produced",
                          agentId,
                          sessionId: detectedSessionId,
                          content: block.text,
                          occurredAt: nowIso(),
                        }),
                      );
                    }
                    if (
                      block.type === "tool_use" &&
                      block.name &&
                      block.id
                    ) {
                      Effect.runSync(
                        emit({
                          type: "agent.tool.invoked",
                          agentId,
                          sessionId: detectedSessionId,
                          toolName: block.name,
                          toolInput: block.input ?? null,
                          toolUseId: block.id,
                          occurredAt: nowIso(),
                        }),
                      );
                    }
                  }

                  // Accumulate usage
                  Effect.runSync(
                    Effect.gen(function* () {
                      const sessions = yield* Ref.get(sessionsRef);
                      const session = sessions.get(agentId);
                      if (session) {
                        yield* updateSession(agentId, {
                          cumulativeUsage: addUsage(
                            session.cumulativeUsage,
                            parsed.usage,
                          ),
                        });
                      }
                    }),
                  );
                  break;
                }

                case "result": {
                  resultText = parsed.result;

                  Effect.runSync(
                    Effect.gen(function* () {
                      const sessions = yield* Ref.get(sessionsRef);
                      const session = sessions.get(agentId);
                      if (session) {
                        yield* updateSession(agentId, {
                          cumulativeUsage: addUsage(
                            session.cumulativeUsage,
                            parsed.usage,
                          ),
                          cumulativeCostUsd:
                            session.cumulativeCostUsd + parsed.costUsd,
                          turnCount: session.turnCount + parsed.numTurns,
                          claudeSessionId:
                            detectedSessionId || session.claudeSessionId,
                          process: null,
                        });
                      }

                      yield* emit({
                        type: "agent.turn.completed",
                        agentId,
                        sessionId: detectedSessionId,
                        usage: parsed.usage,
                        durationMs: parsed.durationMs,
                        costUsd: parsed.costUsd,
                        occurredAt: nowIso(),
                      });

                      if (parsed.isError) {
                        yield* emit({
                          type: "agent.error",
                          agentId,
                          sessionId: detectedSessionId,
                          error: parsed.result,
                          occurredAt: nowIso(),
                        });
                      }
                    }),
                  );
                  break;
                }

                case "other":
                  break;
              }
            }

            const exitCode = await proc.exited;

            if (exitCode !== 0 && !resultText) {
              const stderrText = await new Response(stderr).text();
              throw new Error(
                `Claude exited with code ${exitCode}: ${stderrText}`,
              );
            }

            return resultText;
          },
          catch: (err) =>
            new AgentAdapterError({
              agentId,
              operation: "runClaudeProcess",
              detail: String(err),
            }),
        });

        return result;
      });

    // ------------------------------------------------------------------
    // AgentAdapterShape implementation
    // ------------------------------------------------------------------

    const startSession: AgentAdapterShape["startSession"] = (
      agentId,
      config,
    ) =>
      Effect.gen(function* () {
        const existing = yield* Ref.get(sessionsRef);
        if (existing.has(agentId)) {
          return yield* Effect.fail(
            new AgentAdapterError({
              agentId,
              operation: "startSession",
              detail: `Session already exists for agent '${agentId}'.`,
            }),
          );
        }

        const session: ManagedSession = {
          agentId,
          role: config.role,
          claudeSessionId: "",
          model: config.model,
          config,
          cumulativeUsage: { ...ZERO_USAGE },
          cumulativeCostUsd: 0,
          turnCount: 0,
          startedAt: nowIso(),
          process: null,
        };

        yield* Ref.update(sessionsRef, (s) => {
          const next = new Map(s);
          next.set(agentId, session);
          return next;
        });

        yield* emit({
          type: "agent.session.started",
          agentId,
          role: config.role,
          sessionId: "",
          model: config.model,
          occurredAt: session.startedAt,
        });

        return session;
      });

    const sendMessage: AgentAdapterShape["sendMessage"] = (
      agentId,
      prompt,
      taskId,
    ) =>
      Effect.gen(function* () {
        const session = yield* getSessionOrFail(agentId);

        // Budget checks
        if (
          session.config.maxTurns > 0 &&
          session.turnCount >= session.config.maxTurns
        ) {
          return yield* Effect.fail(
            new AgentBudgetExceededError({
              agentId,
              sessionId: session.claudeSessionId,
              budgetType: "turns",
              limit: session.config.maxTurns,
              current: session.turnCount,
            }),
          );
        }

        yield* emit({
          type: "agent.turn.started",
          agentId,
          sessionId: session.claudeSessionId,
          taskId,
          prompt,
          occurredAt: nowIso(),
        });

        const resumeId = session.claudeSessionId || null;
        const result = yield* runClaudeProcess(
          agentId,
          session.config,
          prompt,
          resumeId,
        );

        return result;
      });

    const interrupt: AgentAdapterShape["interrupt"] = (agentId) =>
      Effect.gen(function* () {
        const sessions = yield* Ref.get(sessionsRef);
        const session = sessions.get(agentId);
        if (session?.process) {
          session.process.kill(2); // SIGINT
          yield* updateSession(agentId, { process: null });
        }
      });

    const stopSession: AgentAdapterShape["stopSession"] = (agentId) =>
      Effect.gen(function* () {
        const session = yield* getSessionOrFail(agentId);

        if (session.process) {
          session.process.kill(2);
        }

        yield* emit({
          type: "agent.session.ended",
          agentId,
          sessionId: session.claudeSessionId,
          totalUsage: session.cumulativeUsage,
          totalCostUsd: session.cumulativeCostUsd,
          reason: "stopped",
          occurredAt: nowIso(),
        });

        yield* Ref.update(sessionsRef, (s) => {
          const next = new Map(s);
          next.delete(agentId);
          return next;
        });
      });

    const getSession: AgentAdapterShape["getSession"] = (agentId) =>
      Effect.gen(function* () {
        const sessions = yield* Ref.get(sessionsRef);
        return sessions.get(agentId) ?? null;
      });

    const listSessions: AgentAdapterShape["listSessions"] = () =>
      Effect.gen(function* () {
        const sessions = yield* Ref.get(sessionsRef);
        return Array.from(sessions.values());
      });

    const streamEvents: AgentAdapterShape["streamEvents"] =
      Stream.fromQueue(eventQueue);

    return {
      startSession,
      sendMessage,
      interrupt,
      stopSession,
      getSession,
      listSessions,
      streamEvents,
    } satisfies AgentAdapterShape;
  });
}
