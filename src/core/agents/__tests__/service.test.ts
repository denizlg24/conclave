import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Exit, Cause, Stream, Queue } from "effect";

import { createAgentService } from "../service";
import type { AgentAdapterShape, AgentSession, QuotaExhaustedDetector } from "../adapter";
import { AgentAdapterError } from "../errors";
import {
  resetCounters,
  makeAgentId,
  makeAgentRoleConfig,
  makeAgentSession,
} from "@/test-utils/factories";
import type { AgentId, TaskId } from "@/shared/types/base-schemas";
import type { AgentRole } from "@/shared/types/orchestration";
import type { AgentRoleConfig, AgentRuntimeEvent } from "@/shared/types/agent-runtime";

function extractError<E>(exit: Exit.Exit<unknown, E>): E | undefined {
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason);
    return fail?.error as E | undefined;
  }
  return undefined;
}

function createMockAdapter(
  sessions: Map<AgentId, AgentSession> = new Map(),
  overrides: Partial<AgentAdapterShape> = {},
): AgentAdapterShape {
  const startSession: AgentAdapterShape["startSession"] = (
    agentId: AgentId,
    config: AgentRoleConfig,
  ) =>
    Effect.gen(function* () {
      if (sessions.has(agentId)) {
        return yield* Effect.fail(
          new AgentAdapterError({
            agentId,
            operation: "startSession",
            detail: "Session already exists",
          }),
        );
      }
      const session: AgentSession = {
        agentId,
        adapterType: "claude-code",
        role: config.role,
        sessionId: `session-${Date.now()}`,
        model: config.model,
        config,
        cumulativeUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
        cumulativeCostUsd: 0,
        turnCount: 0,
        startedAt: new Date().toISOString(),
      };
      sessions.set(agentId, session);
      return session;
    });

  const sendMessage: AgentAdapterShape["sendMessage"] = (
    agentId: AgentId,
    _prompt: string,
    _taskId: TaskId | null,
  ) =>
    Effect.gen(function* () {
      const session = sessions.get(agentId);
      if (!session) {
        return yield* Effect.fail(
          new AgentAdapterError({
            agentId,
            operation: "sendMessage",
            detail: "Session not found",
          }),
        );
      }
      return "Mock response";
    });

  const interrupt: AgentAdapterShape["interrupt"] = (agentId: AgentId) =>
    Effect.gen(function* () {
      if (!sessions.has(agentId)) {
        return yield* Effect.fail(
          new AgentAdapterError({
            agentId,
            operation: "interrupt",
            detail: "Session not found",
          }),
        );
      }
    });

  const stopSession: AgentAdapterShape["stopSession"] = (agentId: AgentId) =>
    Effect.gen(function* () {
      if (!sessions.has(agentId)) {
        return yield* Effect.fail(
          new AgentAdapterError({
            agentId,
            operation: "stopSession",
            detail: "Session not found",
          }),
        );
      }
      sessions.delete(agentId);
    });

  const getSession: AgentAdapterShape["getSession"] = (agentId: AgentId) =>
    Effect.succeed(sessions.get(agentId) ?? null);

  const listSessions: AgentAdapterShape["listSessions"] = () =>
    Effect.succeed(Array.from(sessions.values()));

  const streamEvents: AgentAdapterShape["streamEvents"] = Stream.empty;

  const quotaDetector: QuotaExhaustedDetector = {
    adapterType: "claude-code",
    check: () => ({ isExhausted: false, rawMessage: null }),
  };

  return {
    adapterType: overrides.adapterType ?? "claude-code",
    startSession: overrides.startSession ?? startSession,
    sendMessage: overrides.sendMessage ?? sendMessage,
    interrupt: overrides.interrupt ?? interrupt,
    stopSession: overrides.stopSession ?? stopSession,
    getSession: overrides.getSession ?? getSession,
    listSessions: overrides.listSessions ?? listSessions,
    streamEvents: overrides.streamEvents ?? streamEvents,
    quotaDetector: overrides.quotaDetector ?? quotaDetector,
  };
}

beforeEach(() => {
  resetCounters();
});

describe("createAgentService", () => {
  describe("startAgent", () => {
    test("starts agent with default role config", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(adapter);
      const agentId = makeAgentId("agent-1");

      const session = await Effect.runPromise(
        service.startAgent(agentId, "developer", "/tmp/test"),
      );

      expect(session.agentId).toBe(agentId);
      expect(session.role).toBe("developer");
    });

    test("applies role-specific default configuration for pm", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(adapter);
      const agentId = makeAgentId("pm-agent");

      const session = await Effect.runPromise(
        service.startAgent(agentId, "pm", "/tmp/test"),
      );

      expect(session.role).toBe("pm");
      expect(session.config.systemPrompt).toContain("Project Manager");
    });

    test("applies role-specific default configuration for developer", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(adapter);
      const agentId = makeAgentId("dev-agent");

      const session = await Effect.runPromise(
        service.startAgent(agentId, "developer", "/tmp/test"),
      );

      expect(session.role).toBe("developer");
      expect(session.config.systemPrompt).toContain("Developer");
      expect(session.config.allowedTools).toContain("Write");
      expect(session.config.allowedTools).toContain("Edit");
    });

    test("uses Codex defaults when the adapter type is openai-codex", async () => {
      const adapter = createMockAdapter(new Map(), {
        adapterType: "openai-codex",
      });
      const service = createAgentService(adapter);
      const agentId = makeAgentId("codex-agent");

      const session = await Effect.runPromise(
        service.startAgent(agentId, "developer", "/tmp/test"),
      );

      expect(session.config.model).toBe("gpt-5.4");
    });

    test("uses an explicit default model override when provided", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(
        adapter,
        undefined,
        "opus",
      );
      const agentId = makeAgentId("custom-model-agent");

      const session = await Effect.runPromise(
        service.startAgent(agentId, "developer", "/tmp/test"),
      );

      expect(session.config.model).toBe("opus");
    });

    test("applies role-specific default configuration for reviewer", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(adapter);
      const agentId = makeAgentId("reviewer-agent");

      const session = await Effect.runPromise(
        service.startAgent(agentId, "reviewer", "/tmp/test"),
      );

      expect(session.role).toBe("reviewer");
      expect(session.config.systemPrompt).toContain("Reviewer");
    });

    test("sets working directory from parameter", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(adapter);
      const agentId = makeAgentId("agent-1");
      const workDir = "/projects/my-app";

      const session = await Effect.runPromise(
        service.startAgent(agentId, "developer", workDir),
      );

      expect(session.config.workingDirectory).toBe(workDir);
    });

    test("fails for unknown role", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(adapter);
      const agentId = makeAgentId("agent-1");

      const exit = await Effect.runPromiseExit(
        service.startAgent(agentId, "unknown" as AgentRole, "/tmp/test"),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      expect(error).toBeInstanceOf(AgentAdapterError);
    });

    test("propagates adapter errors", async () => {
      const adapter = createMockAdapter(new Map(), {
        startSession: () =>
          Effect.fail(
            new AgentAdapterError({
              agentId: "test",
              operation: "startSession",
              detail: "Adapter failure",
            }),
          ),
      });
      const service = createAgentService(adapter);

      const exit = await Effect.runPromiseExit(
        service.startAgent(makeAgentId("agent-1"), "developer", "/tmp"),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });
  });

  describe("sendMessage", () => {
    test("sends message to agent and returns response", async () => {
      const sessions = new Map<AgentId, AgentSession>();
      const adapter = createMockAdapter(sessions, {
        sendMessage: () => Effect.succeed("Response from agent"),
      });
      const service = createAgentService(adapter);
      const agentId = makeAgentId("agent-1");

      await Effect.runPromise(service.startAgent(agentId, "developer", "/tmp"));
      const response = await Effect.runPromise(
        service.sendMessage(agentId, "Hello agent"),
      );

      expect(response).toBe("Response from agent");
    });

    test("passes taskId to adapter when provided", async () => {
      let receivedTaskId: string | null = null;
      const sessions = new Map<AgentId, AgentSession>();
      const adapter = createMockAdapter(sessions, {
        sendMessage: (_agentId, _prompt, taskId) => {
          receivedTaskId = taskId;
          return Effect.succeed("ok");
        },
      });
      const service = createAgentService(adapter);
      const agentId = makeAgentId("agent-1");
      const taskId = "task-123" as TaskId;

      await Effect.runPromise(service.startAgent(agentId, "developer", "/tmp"));
      await Effect.runPromise(service.sendMessage(agentId, "work on task", taskId));

      expect(String(receivedTaskId)).toBe("task-123");
    });

    test("passes null taskId when not provided", async () => {
      let receivedTaskId: TaskId | null | undefined = undefined;
      const sessions = new Map<AgentId, AgentSession>();
      const adapter = createMockAdapter(sessions, {
        sendMessage: (_agentId, _prompt, taskId) => {
          receivedTaskId = taskId;
          return Effect.succeed("ok");
        },
      });
      const service = createAgentService(adapter);
      const agentId = makeAgentId("agent-1");

      await Effect.runPromise(service.startAgent(agentId, "developer", "/tmp"));
      await Effect.runPromise(service.sendMessage(agentId, "hello"));

      expect(receivedTaskId).toBeNull();
    });

    test("fails when session does not exist", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(adapter);

      const exit = await Effect.runPromiseExit(
        service.sendMessage(makeAgentId("non-existent"), "hello"),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });
  });

  describe("interruptAgent", () => {
    test("interrupts running agent", async () => {
      let interrupted = false;
      const sessions = new Map<AgentId, AgentSession>();
      const adapter = createMockAdapter(sessions, {
        interrupt: () => {
          interrupted = true;
          return Effect.void;
        },
      });
      const service = createAgentService(adapter);
      const agentId = makeAgentId("agent-1");

      await Effect.runPromise(service.startAgent(agentId, "developer", "/tmp"));
      await Effect.runPromise(service.interruptAgent(agentId));

      expect(interrupted).toBe(true);
    });

    test("fails when session does not exist", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(adapter);

      const exit = await Effect.runPromiseExit(
        service.interruptAgent(makeAgentId("non-existent")),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });
  });

  describe("stopAgent", () => {
    test("stops and removes agent session", async () => {
      const sessions = new Map<AgentId, AgentSession>();
      const adapter = createMockAdapter(sessions);
      const service = createAgentService(adapter);
      const agentId = makeAgentId("agent-1");

      await Effect.runPromise(service.startAgent(agentId, "developer", "/tmp"));
      expect(sessions.size).toBe(1);

      await Effect.runPromise(service.stopAgent(agentId));
      expect(sessions.size).toBe(0);
    });

    test("fails when session does not exist", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(adapter);

      const exit = await Effect.runPromiseExit(
        service.stopAgent(makeAgentId("non-existent")),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });
  });

  describe("stopAll", () => {
    test("stops all running agent sessions", async () => {
      const sessions = new Map<AgentId, AgentSession>();
      const adapter = createMockAdapter(sessions);
      const service = createAgentService(adapter);

      await Effect.runPromise(service.startAgent(makeAgentId("a1"), "pm", "/tmp"));
      await Effect.runPromise(service.startAgent(makeAgentId("a2"), "developer", "/tmp"));
      await Effect.runPromise(service.startAgent(makeAgentId("a3"), "reviewer", "/tmp"));
      expect(sessions.size).toBe(3);

      await Effect.runPromise(service.stopAll());

      expect(sessions.size).toBe(0);
    });

    test("succeeds even when no sessions exist", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(adapter);

      await expect(Effect.runPromise(service.stopAll())).resolves.toBeUndefined();
    });

    test("ignores errors from individual session stops", async () => {
      const sessions = new Map<AgentId, AgentSession>();
      let stopCallCount = 0;
      const adapter = createMockAdapter(sessions, {
        stopSession: (agentId) => {
          stopCallCount++;
          if (stopCallCount === 2) {
            return Effect.fail(
              new AgentAdapterError({
                agentId,
                operation: "stopSession",
                detail: "Simulated error",
              }),
            );
          }
          sessions.delete(agentId);
          return Effect.void;
        },
      });
      const service = createAgentService(adapter);

      await Effect.runPromise(service.startAgent(makeAgentId("a1"), "pm", "/tmp"));
      await Effect.runPromise(service.startAgent(makeAgentId("a2"), "developer", "/tmp"));
      await Effect.runPromise(service.startAgent(makeAgentId("a3"), "reviewer", "/tmp"));

      await expect(Effect.runPromise(service.stopAll())).resolves.toBeUndefined();
    });
  });

  describe("getAgent", () => {
    test("returns session when exists", async () => {
      const sessions = new Map<AgentId, AgentSession>();
      const adapter = createMockAdapter(sessions);
      const service = createAgentService(adapter);
      const agentId = makeAgentId("agent-1");

      await Effect.runPromise(service.startAgent(agentId, "developer", "/tmp"));

      const session = await Effect.runPromise(service.getAgent(agentId));

      expect(session).not.toBeNull();
      expect(session?.agentId).toBe(agentId);
    });

    test("returns null when session does not exist", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(adapter);

      const session = await Effect.runPromise(
        service.getAgent(makeAgentId("non-existent")),
      );

      expect(session).toBeNull();
    });
  });

  describe("listAgents", () => {
    test("returns empty array when no sessions", async () => {
      const adapter = createMockAdapter();
      const service = createAgentService(adapter);

      const sessions = await Effect.runPromise(service.listAgents());

      expect(sessions).toEqual([]);
    });

    test("returns all active sessions", async () => {
      const sessions = new Map<AgentId, AgentSession>();
      const adapter = createMockAdapter(sessions);
      const service = createAgentService(adapter);

      await Effect.runPromise(service.startAgent(makeAgentId("a1"), "pm", "/tmp"));
      await Effect.runPromise(service.startAgent(makeAgentId("a2"), "developer", "/tmp"));

      const list = await Effect.runPromise(service.listAgents());

      expect(list).toHaveLength(2);
      expect(list.map((s) => s.role)).toContain("pm");
      expect(list.map((s) => s.role)).toContain("developer");
    });
  });

  describe("findOrSpawnAgent", () => {
    test("starts a session with requested config overrides", async () => {
      const adapter = createMockAdapter(new Map(), {
        adapterType: "openai-codex",
      });
      const service = createAgentService(adapter);

      const session = await Effect.runPromise(
        service.findOrSpawnAgent("developer", "/tmp/project", {
          model: "gpt-5.4-mini",
        }),
      );

      expect(session).not.toBeNull();
      expect(session?.config.model).toBe("gpt-5.4-mini");
      expect(session?.config.workingDirectory).toBe("/tmp/project");
    });

    test("restarts an idle session when the requested model changes", async () => {
      const agentId = makeAgentId("existing-dev");
      const existingSession = makeAgentSession({
        agentId,
        adapterType: "openai-codex",
        role: "developer",
        sessionId: "session-existing",
        model: "gpt-5.4",
        config: makeAgentRoleConfig({
          role: "developer",
          workingDirectory: "/tmp/original",
          model: "gpt-5.4" as AgentRoleConfig["model"],
        }),
        cumulativeUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
      });
      const sessions = new Map<AgentId, AgentSession>([[agentId, existingSession]]);
      const adapter = createMockAdapter(sessions, {
        adapterType: "openai-codex",
      });
      const service = createAgentService(adapter);

      const session = await Effect.runPromise(
        service.findOrSpawnAgent("developer", "/tmp/requested", {
          model: "gpt-5.4-mini",
        }),
      );

      expect(session).not.toBeNull();
      expect(session?.agentId).toBe(agentId);
      expect(session?.config.model).toBe("gpt-5.4-mini");
      expect(session?.config.workingDirectory).toBe("/tmp/requested");
    });
  });

  describe("streamEvents", () => {
    test("exposes adapter event stream", async () => {
      const eventQueue = Effect.runSync(Queue.unbounded<AgentRuntimeEvent>());

      const mockEvent: AgentRuntimeEvent = {
        type: "agent.session.started",
        schemaVersion: 1,
        agentId: makeAgentId("agent-1"),
        role: "developer",
        sessionId: "session-123",
        model: "claude-sonnet-4-6" as string & { readonly TrimmedNonEmptyString: unique symbol },
        occurredAt: new Date().toISOString(),
      };

      const adapter = createMockAdapter(new Map(), {
        streamEvents: Stream.fromQueue(eventQueue),
      });
      const service = createAgentService(adapter);

      const collectPromise = Effect.runPromise(
        Stream.take(service.streamEvents, 1).pipe(Stream.runCollect),
      );

      await Effect.runPromise(Queue.offer(eventQueue, mockEvent));

      const events = await collectPromise;
      const eventsArray = Array.from(events);

      expect(eventsArray).toHaveLength(1);
      expect(eventsArray[0].type).toBe("agent.session.started");
    });
  });
});

describe("default role configurations", () => {
  test("pm role has planning tools but no code modification tools", async () => {
    const sessions = new Map<AgentId, AgentSession>();
    const adapter = createMockAdapter(sessions);
    const service = createAgentService(adapter);

    const session = await Effect.runPromise(
      service.startAgent(makeAgentId("pm"), "pm", "/tmp"),
    );

    // PM can write planning documents to .conclave/planning/
    expect(session.config.allowedTools).toContain("Write");
    expect(session.config.allowedTools).toContain("Read");
    // PM cannot edit existing code or run commands
    expect(session.config.allowedTools).not.toContain("Edit");
    expect(session.config.allowedTools).not.toContain("Bash");
  });

  test("developer role has code writing tools", async () => {
    const sessions = new Map<AgentId, AgentSession>();
    const adapter = createMockAdapter(sessions);
    const service = createAgentService(adapter);

    const session = await Effect.runPromise(
      service.startAgent(makeAgentId("dev"), "developer", "/tmp"),
    );

    expect(session.config.allowedTools).toContain("Read");
    expect(session.config.allowedTools).toContain("Write");
    expect(session.config.allowedTools).toContain("Edit");
    expect(session.config.allowedTools).toContain("Bash");
  });

  test("reviewer role has limited tools (read-only + bash for tests)", async () => {
    const sessions = new Map<AgentId, AgentSession>();
    const adapter = createMockAdapter(sessions);
    const service = createAgentService(adapter);

    const session = await Effect.runPromise(
      service.startAgent(makeAgentId("reviewer"), "reviewer", "/tmp"),
    );

    expect(session.config.allowedTools).toContain("Read");
    expect(session.config.allowedTools).toContain("Bash");
    expect(session.config.allowedTools).not.toContain("Write");
    expect(session.config.allowedTools).not.toContain("Edit");
  });

  test("each role has appropriate turn limits for their complexity", async () => {
    const sessions = new Map<AgentId, AgentSession>();
    const adapter = createMockAdapter(sessions);
    const service = createAgentService(adapter);

    const pmSession = await Effect.runPromise(
      service.startAgent(makeAgentId("pm"), "pm", "/tmp"),
    );
    const devSession = await Effect.runPromise(
      service.startAgent(makeAgentId("dev"), "developer", "/tmp"),
    );
    const reviewerSession = await Effect.runPromise(
      service.startAgent(makeAgentId("reviewer"), "reviewer", "/tmp"),
    );

    // Developer needs most turns for implementation work
    expect(devSession.config.maxTurns).toBeGreaterThan(reviewerSession.config.maxTurns);
    // Reviewer needs more turns than PM for thorough code review
    expect(reviewerSession.config.maxTurns).toBeGreaterThan(pmSession.config.maxTurns);
  });
});
