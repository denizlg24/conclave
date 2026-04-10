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
  AgentQuotaExhaustedError,
  AgentSessionNotFoundError,
  AgentSpawnError,
} from "./errors";
import {
  createWorkspaceChangeTracker,
  EMPTY_WORKSPACE_CHANGES,
} from "./workspace-change-tracker";

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

export interface OpenAICodexAdapterOptions {
  readonly resolveBinaryPath?: AdapterBinaryPathResolver;
}

const CODEX_QUOTA_PATTERNS: readonly RegExp[] = [
  /quota exceeded/i,
  /rate limit exceeded/i,
  /usage limit reached/i,
  /insufficient credits/i,
  /billing.*limit/i,
  /too many requests/i,
];

export const openAICodexQuotaDetector: QuotaExhaustedDetector = {
  adapterType: "openai-codex",
  check: (content: string): QuotaExhaustedCheckResult => {
    for (const pattern of CODEX_QUOTA_PATTERNS) {
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

function canWriteWorkspace(config: AgentRoleConfig): boolean {
  return (
    config.allowedTools.includes("Write") || config.allowedTools.includes("Edit")
  );
}

function canUseSearch(config: AgentRoleConfig): boolean {
  return (
    config.allowedTools.includes("WebSearch") ||
    config.allowedTools.includes("WebFetch")
  );
}

function buildCapabilityPolicy(config: AgentRoleConfig): string {
  const allowed = config.allowedTools.join(", ") || "none";
  const constraints: string[] = [];

  constraints.push(
    canWriteWorkspace(config)
      ? "File edits are allowed only inside the workspace and only when required by the task."
      : "Do not modify files. Read-only analysis only.",
  );

  constraints.push(
    config.allowedTools.includes("Bash")
      ? "Shell commands are allowed only when needed for the assigned task."
      : "Do not run shell commands.",
  );

  constraints.push(
    canUseSearch(config)
      ? "Web access is allowed only when necessary."
      : "Do not use web search or fetch external resources.",
  );

  constraints.push(
    config.allowedTools.includes("LSP")
      ? "Language-server style code inspection is allowed when useful."
      : "Do not rely on LSP or IDE-only capabilities.",
  );

  return [
    `Allowed capabilities: ${allowed}.`,
    ...constraints.map((line) => `- ${line}`),
  ].join("\n");
}

type ParsedEvent =
  | {
      readonly kind: "thread_started";
      readonly threadId: string;
    }
  | {
      readonly kind: "agent_message";
      readonly itemId: string;
      readonly text: string;
    }
  | {
      readonly kind: "command_started";
      readonly itemId: string;
      readonly command: string;
    }
  | {
      readonly kind: "turn_completed";
      readonly usage: TokenUsage;
    }
  | {
      readonly kind: "other";
    };

function parseRawLine(line: string): ParsedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const type = raw["type"];
  if (type === "thread.started") {
    return {
      kind: "thread_started",
      threadId: (raw["thread_id"] as string) ?? "",
    };
  }

  if (type === "turn.completed") {
    const usage = raw["usage"] as Record<string, number> | undefined;
    return {
      kind: "turn_completed",
      usage: {
        inputTokens: usage?.["input_tokens"] ?? 0,
        outputTokens: usage?.["output_tokens"] ?? 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: usage?.["cached_input_tokens"] ?? 0,
      },
    };
  }

  if (
    (type === "item.started" || type === "item.completed") &&
    typeof raw["item"] === "object" &&
    raw["item"] !== null
  ) {
    const item = raw["item"] as Record<string, unknown>;
    const itemType = item["type"];
    if (type === "item.started" && itemType === "command_execution") {
      return {
        kind: "command_started",
        itemId: (item["id"] as string) ?? "",
        command: (item["command"] as string) ?? "",
      };
    }

    if (type === "item.completed" && itemType === "agent_message") {
      return {
        kind: "agent_message",
        itemId: (item["id"] as string) ?? "",
        text: (item["text"] as string) ?? "",
      };
    }
  }

  return { kind: "other" };
}

function buildCodexArgs(
  config: AgentRoleConfig,
  resumeSessionId: string | null,
): string[] {
  const globalArgs = canWriteWorkspace(config)
    ? ["-a", "never", "-s", "workspace-write"]
    : ["-a", "never", "-s", "read-only"];

  if (canUseSearch(config)) {
    globalArgs.push("--search");
  }

  const commandArgs = resumeSessionId
    ? [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "--model",
        config.model,
        resumeSessionId,
        "-",
      ]
    : [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--model",
        config.model,
        "-",
      ];

  return [...globalArgs, ...commandArgs];
}

function buildPrompt(
  config: AgentRoleConfig,
  prompt: string,
  resumeSessionId: string | null,
): string {
  const capabilityPolicy = buildCapabilityPolicy(config);

  if (resumeSessionId) {
    return [
      "## Capability Policy",
      capabilityPolicy,
      "",
      prompt,
    ].join("\n");
  }

  return [
    "## System Instructions",
    config.systemPrompt,
    "",
    "## Capability Policy",
    capabilityPolicy,
    "",
    "## Task Prompt",
    prompt,
  ].join("\n");
}

async function* readJsonLines(
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

export function createOpenAICodexAdapter(
  options: OpenAICodexAdapterOptions = {},
): Effect.Effect<AgentAdapterShape> {
  return Effect.gen(function* () {
    const sessionsRef = yield* Ref.make<Map<string, ManagedSession>>(new Map());
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

    const runCodexProcess = (
      agentId: AgentId,
      config: AgentRoleConfig,
      prompt: string,
      taskId: TaskId | null,
      resumeSessionId: string | null,
    ): Effect.Effect<
      string,
      AgentAdapterError | AgentSpawnError | AgentQuotaExhaustedError
    > =>
      Effect.gen(function* () {
        const args = buildCodexArgs(config, resumeSessionId);
        const fullPrompt = buildPrompt(config, prompt, resumeSessionId);
        const startedAtMs = Date.now();
        const resolution = yield* Effect.tryPromise({
          try: () =>
            options.resolveBinaryPath?.() ??
            resolveAdapterBinaryPath({
              adapterType: "openai-codex",
              manualPath: null,
              cwd: config.workingDirectory,
            }),
          catch: (err) =>
            new AgentSpawnError({
              agentId,
              command: "codex",
              detail: String(err),
            }),
        });

        if (!resolution.resolvedPath) {
          return yield* Effect.fail(
            new AgentSpawnError({
              agentId,
              command: resolution.manualPath ?? resolution.command,
              detail: resolution.errorMessage ?? "Codex binary could not be resolved.",
            }),
          );
        }
        const resolvedPath = resolution.resolvedPath;

        console.log(
          `[codex-adapter] Spawning ${resolvedPath} (${resolution.source ?? "unresolved"}) (cwd: ${config.workingDirectory}), promptLength: ${fullPrompt.length}`,
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
          catch: (err) =>
            new AgentSpawnError({
              agentId,
              command: `${resolvedPath} ${args.join(" ")}`,
              detail: String(err),
            }),
        });

        const stdinSink = proc.stdin;
        yield* Effect.try({
          try: () => {
            stdinSink.write(fullPrompt);
            stdinSink.end();
          },
          catch: (err) =>
            new AgentSpawnError({
              agentId,
              command: "stdin write",
              detail: `Failed to write prompt to stdin: ${String(err)}`,
            }),
        });

        yield* updateSession(agentId, {
          process: { kill: (signal) => proc.kill(signal) },
        });

        const stdout = proc.stdout as ReadableStream<Uint8Array>;
        const stderr = proc.stderr as ReadableStream<Uint8Array>;

        const result = yield* Effect.tryPromise({
          try: async () => {
            const outputChunks: string[] = [];
            let detectedThreadId = resumeSessionId ?? "";
            let usage = { ...ZERO_USAGE };
            let completedTurn: CompletedTurn | null = null;
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

            for await (const line of readJsonLines(stdout)) {
              const parsed = parseRawLine(line);
              if (!parsed) continue;

              switch (parsed.kind) {
                case "thread_started": {
                  detectedThreadId = parsed.threadId;
                  break;
                }

                case "agent_message": {
                  if (parsed.text.trim()) {
                    outputChunks.push(parsed.text);
                    Effect.runSync(
                      emit({
                        type: "agent.output.produced",
                        schemaVersion: 1 as const,
                        agentId,
                        sessionId: detectedThreadId,
                        content: parsed.text,
                        occurredAt: nowIso(),
                      }),
                    );
                  }
                  break;
                }

                case "command_started": {
                  Effect.runSync(
                    emit({
                      type: "agent.tool.invoked",
                      schemaVersion: 1 as const,
                      agentId,
                      sessionId: detectedThreadId,
                      toolName: "command_execution",
                      toolInput: { command: parsed.command },
                      toolUseId: parsed.itemId,
                      occurredAt: nowIso(),
                    }),
                  );
                  break;
                }

                case "turn_completed": {
                  usage = parsed.usage;
                  completedTurn = {
                    sessionId: detectedThreadId,
                    usage: parsed.usage,
                    durationMs: Math.max(Date.now() - startedAtMs, 0),
                    costUsd: 0,
                  };

                  Effect.runSync(
                    Effect.gen(function* () {
                      const sessions = yield* Ref.get(sessionsRef);
                      const session = sessions.get(agentId);
                      if (session) {
                        yield* updateSession(agentId, {
                          sessionId: detectedThreadId || session.sessionId,
                          cumulativeUsage: addUsage(
                            session.cumulativeUsage,
                            parsed.usage,
                          ),
                          turnCount: session.turnCount + 1,
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
            const stderrText = await new Response(stderr).text();
            const resultText = outputChunks.join("\n\n");
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

            if (stderrText) {
              console.error(`[codex-adapter] stderr for ${agentId}:`, stderrText);
            }

            const stderrQuotaCheck = openAICodexQuotaDetector.check(stderrText);
            if (stderrQuotaCheck.isExhausted) {
              throw new AgentQuotaExhaustedError({
                agentId,
                sessionId: detectedThreadId,
                adapterType: "openai-codex",
                rawMessage: stderrQuotaCheck.rawMessage ?? stderrText,
                detectedAt: nowIso(),
              });
            }

            const resultQuotaCheck = openAICodexQuotaDetector.check(resultText);
            if (resultQuotaCheck.isExhausted) {
              throw new AgentQuotaExhaustedError({
                agentId,
                sessionId: detectedThreadId,
                adapterType: "openai-codex",
                rawMessage: resultQuotaCheck.rawMessage ?? resultText,
                detectedAt: nowIso(),
              });
            }

            if (exitCode !== 0) {
              throw new Error(
                `Codex exited with code ${exitCode}: ${stderrText || resultText || "unknown error"}`,
              );
            }

            if (!resultText && usage.outputTokens === 0) {
              Effect.runSync(updateSession(agentId, { process: null }));
            }

            return resultText;
          },
          catch: (err) => {
            if (err instanceof AgentQuotaExhaustedError) {
              return err;
            }

            const errorMessage = String(err);
            const quotaCheck = openAICodexQuotaDetector.check(errorMessage);
            if (quotaCheck.isExhausted) {
              return new AgentQuotaExhaustedError({
                agentId,
                sessionId: "",
                adapterType: "openai-codex",
                rawMessage: quotaCheck.rawMessage ?? errorMessage,
                detectedAt: nowIso(),
              });
            }

            return new AgentAdapterError({
              agentId,
              operation: "runCodexProcess",
              detail: errorMessage,
            });
          },
        });

        return result;
      });

    const startSession: AgentAdapterShape["startSession"] = (agentId, config) =>
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
          adapterType: "openai-codex",
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

        yield* Ref.update(sessionsRef, (sessions) => {
          const next = new Map(sessions);
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

        return yield* runCodexProcess(
          agentId,
          session.config,
          prompt,
          taskId,
          effectiveSessionId || null,
        );
      });

    const interrupt: AgentAdapterShape["interrupt"] = (agentId) =>
      Effect.gen(function* () {
        const sessions = yield* Ref.get(sessionsRef);
        const session = sessions.get(agentId);
        if (session?.process) {
          session.process.kill(2);
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

        yield* Ref.update(sessionsRef, (sessions) => {
          const next = new Map(sessions);
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

    return {
      adapterType: "openai-codex",
      startSession,
      sendMessage,
      interrupt,
      stopSession,
      getSession,
      listSessions,
      streamEvents: Stream.fromQueue(eventQueue),
      quotaDetector: openAICodexQuotaDetector,
    } satisfies AgentAdapterShape;
  });
}
