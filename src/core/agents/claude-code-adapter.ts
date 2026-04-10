import { Effect, Queue, Ref, Stream } from "effect";

import type { AgentId, TaskId } from "@/shared/types/base-schemas";
import type {
  AgentRoleConfig,
  AgentRuntimeEvent,
  TokenUsage,
  WorkspaceChanges,
} from "@/shared/types/agent-runtime";

import type {
  AdapterBinaryPathResolver,
  AgentAdapterShape,
  AgentSession,
  QuotaExhaustedCheckResult,
  QuotaExhaustedDetector,
} from "./adapter";
import { resolveAdapterBinaryPath } from "./binary-path";
import {
  AgentAdapterError,
  AgentBudgetExceededError,
  AgentSessionNotFoundError,
  AgentSpawnError,
  AgentQuotaExhaustedError,
} from "./errors";
import {
  createWorkspaceChangeTracker,
  EMPTY_WORKSPACE_CHANGES,
} from "./workspace-change-tracker";

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

type CompletedTurn = {
  readonly sessionId: string;
  readonly usage: TokenUsage;
  readonly durationMs: number;
  readonly costUsd: number;
};

const nowIso = () => new Date().toISOString();

export interface ClaudeCodeAdapterOptions {
  readonly resolveBinaryPath?: AdapterBinaryPathResolver;
}

// ---------------------------------------------------------------------------
// Claude Code Quota Exhausted Detector
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate Claude Code quota/credits exhaustion.
 * These are checked against both stdout and stderr output.
 */
const CLAUDE_QUOTA_PATTERNS: readonly RegExp[] = [
  /you'?re out of extra usage/i,
  /out of credits/i,
  /usage limit reached/i,
  /rate limit exceeded/i,
  /quota exceeded/i,
  /insufficient credits/i,
  /billing.*limit/i,
  /subscription.*expired/i,
  /plan.*limit.*reached/i,
];

export const claudeCodeQuotaDetector: QuotaExhaustedDetector = {
  adapterType: "claude-code",
  check: (content: string): QuotaExhaustedCheckResult => {
    for (const pattern of CLAUDE_QUOTA_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        return {
          isExhausted: true,
          rawMessage: match[0],
        };
      }
    }
    return {
      isExhausted: false,
      rawMessage: null,
    };
  },
};

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
  resumeSessionId: string | null,
): string[] {
  // NOTE: Prompt is NOT included in CLI args to avoid ENAMETOOLONG on Windows.
  // The prompt is passed via stdin instead (see runClaudeProcess).
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    config.model,
    "-p", // Read prompt from stdin
  ];

  if (config.allowedTools.length > 0) {
    args.push("--allowedTools", config.allowedTools.join(","));
  }

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  } else {
    args.push("--system-prompt", config.systemPrompt);
  }

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

function createSpawnEnv(): Record<string, string> {
  const spawnEnv = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      spawnEnv[key] = value;
    }
  }
  if (!spawnEnv.HOME && spawnEnv.USERPROFILE) {
    spawnEnv.HOME = spawnEnv.USERPROFILE;
  }
  if (!spawnEnv.PATH && spawnEnv.Path) {
    spawnEnv.PATH = spawnEnv.Path;
  }
  return spawnEnv;
}

export function createClaudeCodeAdapter(
  options: ClaudeCodeAdapterOptions = {},
): Effect.Effect<AgentAdapterShape> {
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
      taskId: TaskId | null,
      resumeSessionId: string | null,
    ): Effect.Effect<string, AgentAdapterError | AgentSpawnError | AgentQuotaExhaustedError> =>
      Effect.gen(function* () {
        const args = buildClaudeArgs(config, resumeSessionId);
        const resolution = yield* Effect.tryPromise({
          try: () =>
            options.resolveBinaryPath?.() ??
            resolveAdapterBinaryPath({
              adapterType: "claude-code",
              manualPath: null,
              cwd: config.workingDirectory,
            }),
          catch: (err) =>
            new AgentSpawnError({
              agentId,
              command: "claude",
              detail: String(err),
            }),
        });

        if (!resolution.resolvedPath) {
          return yield* Effect.fail(
            new AgentSpawnError({
              agentId,
              command: resolution.manualPath ?? resolution.command,
              detail: resolution.errorMessage ?? "Claude binary could not be resolved.",
            }),
          );
        }
        const resolvedPath = resolution.resolvedPath;

        console.log(`[claude-adapter] HOME=${process.env.HOME}, USERPROFILE=${process.env.USERPROFILE}`);
        console.log(
          `[claude-adapter] Spawning ${resolvedPath} (${resolution.source ?? "unresolved"}) (cwd: ${config.workingDirectory}), promptLength: ${prompt.length}`,
        );

        const spawnEnv = createSpawnEnv();

        const proc = yield* Effect.try({
          try: () =>
            Bun.spawn([resolvedPath, ...args], {
              cwd: config.workingDirectory,
              env: spawnEnv,
              stdout: "pipe",
              stderr: "pipe",
              stdin: "pipe",
            }),
          catch: (err) => {
            console.error(`[claude-adapter] Spawn failed for ${agentId}:`, String(err));
            return new AgentSpawnError({
              agentId,
              command: `${resolvedPath} ${args.join(" ")}`,
              detail: String(err),
            });
          },
        });

        // Write prompt to stdin and close the stream
        // Bun's stdin is a FileSink with write() and end() methods
        const stdinSink = proc.stdin;
        yield* Effect.try({
          try: () => {
            stdinSink.write(prompt);
            stdinSink.end();
          },
          catch: (err) => new AgentSpawnError({
            agentId,
            command: "stdin write",
            detail: `Failed to write prompt to stdin: ${String(err)}`,
          }),
        });

        console.log(`[claude-adapter] Process spawned for ${agentId}, PID: ${proc.pid}`);

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
            let completedTurn: CompletedTurn | null = null;
            let errorText: string | null = null;
            let tracker = await createWorkspaceChangeTracker(
              config.workingDirectory,
            ).catch(() => null);
            const finishTracking = async (): Promise<WorkspaceChanges> => {
              if (!tracker) {
                return EMPTY_WORKSPACE_CHANGES;
              }

              const activeTracker = tracker;
              tracker = null;
              return activeTracker.finish().catch(() => EMPTY_WORKSPACE_CHANGES);
            };

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
                      console.log(`[claude-adapter] ${agentId} output: ${block.text.slice(0, 200)}`);
                      Effect.runSync(
                      emit({
                          type: "agent.output.produced",
                          schemaVersion: 1 as const,
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
                      console.log(`[claude-adapter] ${agentId} tool: ${block.name}`);
                      Effect.runSync(
                        emit({
                          type: "agent.tool.invoked",
                          schemaVersion: 1 as const,
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

                  break;
                }

                case "result": {
                  resultText = parsed.result;
                  completedTurn = {
                    sessionId: detectedSessionId,
                    usage: parsed.usage,
                    durationMs: parsed.durationMs,
                    costUsd: parsed.costUsd,
                  };
                  errorText = parsed.isError ? parsed.result : null;

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
                          sessionId: detectedSessionId || session.sessionId,
                          process: null,
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
            console.log(`[claude-adapter] Process exited for ${agentId}, code: ${exitCode}, resultLength: ${resultText.length}`);
            const workspaceChanges = await finishTracking();

            if (completedTurn) {
              Effect.runSync(
                emit({
                  type: "agent.turn.completed",
                  schemaVersion: 1 as const,
                  agentId,
                  sessionId: completedTurn.sessionId,
                  taskId,
                  usage: completedTurn.usage,
                  workspaceChanges,
                  durationMs: completedTurn.durationMs,
                  costUsd: completedTurn.costUsd,
                  occurredAt: nowIso(),
                }),
              );
            }

            if (errorText) {
              Effect.runSync(
                emit({
                  type: "agent.error",
                  schemaVersion: 1 as const,
                  agentId,
                  sessionId: detectedSessionId,
                  error: errorText,
                  occurredAt: nowIso(),
                }),
              );
            }

            if (exitCode !== 0 && !resultText) {
              const stderrText = await new Response(stderr).text();
              console.error(`[claude-adapter] stderr for ${agentId}:`, stderrText);
              
              // Check for quota exhaustion in stderr
              const quotaCheck = claudeCodeQuotaDetector.check(stderrText);
              if (quotaCheck.isExhausted) {
                throw new AgentQuotaExhaustedError({
                  agentId,
                  sessionId: detectedSessionId,
                  adapterType: "claude-code",
                  rawMessage: quotaCheck.rawMessage ?? stderrText,
                  detectedAt: nowIso(),
                });
              }
              
              throw new Error(
                `Claude exited with code ${exitCode}: ${stderrText}`,
              );
            }
            
            // Also check the result text for quota messages (sometimes embedded in output)
            const resultQuotaCheck = claudeCodeQuotaDetector.check(resultText);
            if (resultQuotaCheck.isExhausted) {
              throw new AgentQuotaExhaustedError({
                agentId,
                sessionId: detectedSessionId,
                adapterType: "claude-code",
                rawMessage: resultQuotaCheck.rawMessage ?? resultText,
                detectedAt: nowIso(),
              });
            }

            return resultText;
          },
          catch: (err) => {
            // If it's already an AgentQuotaExhaustedError, propagate it as-is
            if (err instanceof AgentQuotaExhaustedError) {
              return err;
            }
            
            // Check error message for quota exhaustion patterns
            const errorMessage = String(err);
            const quotaCheck = claudeCodeQuotaDetector.check(errorMessage);
            if (quotaCheck.isExhausted) {
              return new AgentQuotaExhaustedError({
                agentId,
                sessionId: "",
                adapterType: "claude-code",
                rawMessage: quotaCheck.rawMessage ?? errorMessage,
                detectedAt: nowIso(),
              });
            }
            
            console.error(`[claude-adapter] runClaudeProcess error for ${agentId}:`, errorMessage);
            return new AgentAdapterError({
              agentId,
              operation: "runClaudeProcess",
              detail: errorMessage,
            });
          },
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
          adapterType: "claude-code",
          role: config.role,
          sessionId: "",
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
          schemaVersion: 1 as const,
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
      resumeSessionId,
    ) =>
      Effect.gen(function* () {
        console.log(`[claude-adapter] sendMessage called for ${agentId}, taskId: ${taskId}, resumeSessionId: ${resumeSessionId ?? "none"}`);
        const session = yield* getSessionOrFail(agentId);

        if (
          session.config.maxTurns > 0 &&
          session.turnCount >= session.config.maxTurns
        ) {
          return yield* Effect.fail(
            new AgentBudgetExceededError({
              agentId,
              sessionId: session.sessionId,
              budgetType: "turns",
              limit: session.config.maxTurns,
              current: session.turnCount,
            }),
          );
        }

        // Use explicit resumeSessionId if provided (for resuming suspended tasks),
        // otherwise fall back to the session's current adapter session ID
        const effectiveSessionId = resumeSessionId ?? session.sessionId;

        yield* emit({
          type: "agent.turn.started",
          schemaVersion: 1 as const,
          agentId,
          sessionId: effectiveSessionId,
          taskId,
          prompt,
          occurredAt: nowIso(),
        });

        const resumeId = effectiveSessionId || null;
        const result = yield* runClaudeProcess(
          agentId,
          session.config,
          prompt,
          taskId,
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
          schemaVersion: 1 as const,
          agentId,
          sessionId: session.sessionId,
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
      adapterType: "claude-code",
      startSession,
      sendMessage,
      interrupt,
      stopSession,
      getSession,
      listSessions,
      streamEvents,
      quotaDetector: claudeCodeQuotaDetector,
    } satisfies AgentAdapterShape;
  });
}
