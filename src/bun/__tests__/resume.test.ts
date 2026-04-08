import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Stream } from "effect";

import { createResumeHandler } from "../resume-handler";
import { AgentAdapterError, AgentQuotaExhaustedError } from "@/core/agents/errors";
import {
  resetCounters,
  makeTaskId,
  makeAgentId,
  makeTask,
  makeAgentSession,
  makeEmptyReadModel,
  makeReadModelWithTasks,
} from "@/test-utils/factories";
import type { OrchestrationEngineShape } from "@/core/orchestrator/engine";
import type { AgentServiceShape, AgentPoolConfig, TeamComposition } from "@/core/agents/service";
import type { SuspensionStoreShape, SuspensionContext } from "@/core/memory/suspension-store";
import type { EventBusShape } from "@/core/communication/event-bus";
import type { OrchestrationCommand, OrchestrationEvent, OrchestrationReadModel } from "@/shared/types/orchestration";
import type { AgentId, TaskId } from "@/shared/types/base-schemas";
import type { AgentRuntimeEvent } from "@/shared/types/agent-runtime";
import type { DispatchError } from "@/core/orchestrator/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeSuspensionContext(
  taskId: TaskId,
  overrides: Partial<SuspensionContext> = {},
): SuspensionContext {
  return {
    id: "suspension-test-1",
    taskId,
    agentId: makeAgentId("dev") as AgentId,
    agentRole: "developer",
    sessionId: "claude-session-abc123",
    suspendedAt: new Date().toISOString(),
    reason: "quota_exhausted",
    executionContext: {
      prompt: "Implement the feature",
      taskType: "implementation",
      taskTitle: "Implement feature X",
    },
    ...overrides,
  };
}

type DispatchCall = { type: string; status?: string };

function makeMockEngine(
  overrides: Partial<{
    dispatch: (cmd: OrchestrationCommand) => Effect.Effect<
      { readonly sequence: number; readonly events: ReadonlyArray<OrchestrationEvent> },
      DispatchError
    >;
    getReadModel: () => Effect.Effect<OrchestrationReadModel>;
  }> = {},
): OrchestrationEngineShape {
  return {
    dispatch:
      overrides.dispatch ??
      (() => Effect.succeed({ sequence: 1, events: [] as ReadonlyArray<OrchestrationEvent> })),
    getReadModel:
      overrides.getReadModel ?? (() => Effect.succeed(makeEmptyReadModel())),
    readEvents: () => Stream.empty,
    replay: () => Effect.succeed(makeEmptyReadModel()),
  };
}

function makeMockAgentService(
  overrides: Partial<AgentServiceShape> = {},
): AgentServiceShape {
  const poolConfig: AgentPoolConfig = {
    maxPerRole: { pm: 1, developer: 3, reviewer: 1, tester: 2 },
  };
  const composition: TeamComposition = {
    pm: { max: 1, active: 0 },
    developer: { max: 3, active: 0 },
    reviewer: { max: 1, active: 0 },
    tester: { max: 2, active: 0 },
  };
  return {
    startAgent: overrides.startAgent ?? (() => Effect.succeed(makeAgentSession())),
    sendMessage: overrides.sendMessage ?? (() => Effect.succeed("mock output")),
    interruptAgent: overrides.interruptAgent ?? (() => Effect.void),
    stopAgent: overrides.stopAgent ?? (() => Effect.void),
    stopAll: overrides.stopAll ?? (() => Effect.void),
    getAgent: overrides.getAgent ?? (() => Effect.succeed(null)),
    listAgents: overrides.listAgents ?? (() => Effect.succeed([])),
    streamEvents: (overrides.streamEvents ?? Stream.empty) as Stream.Stream<AgentRuntimeEvent>,
    markBusy: overrides.markBusy ?? (() => {}),
    markAvailable: overrides.markAvailable ?? (() => {}),
    findOrSpawnAgent: overrides.findOrSpawnAgent ?? (() => Effect.succeed(null)),
    getTeamComposition: overrides.getTeamComposition ?? (() => composition),
    poolConfig: overrides.poolConfig ?? poolConfig,
    onRosterChange: overrides.onRosterChange ?? (() => {}),
  };
}

function makeMockSuspensionStore(
  overrides: Partial<SuspensionStoreShape> = {},
): SuspensionStoreShape {
  return {
    save:
      overrides.save ??
      ((ctx) =>
        Effect.succeed({
          ...ctx,
          id: "mock-suspension-id",
          suspendedAt: new Date().toISOString(),
        } as SuspensionContext)),
    getByTask: overrides.getByTask ?? (() => Effect.succeed(null)),
    getByAgent: overrides.getByAgent ?? (() => Effect.succeed([])),
    getAllPending: overrides.getAllPending ?? (() => Effect.succeed([])),
    remove: overrides.remove ?? (() => Effect.void),
    clear: overrides.clear ?? (() => Effect.void),
  };
}

function makeMockBus(overrides: Partial<EventBusShape> = {}): EventBusShape {
  return {
    publish: overrides.publish ?? (() => Effect.void),
    subscribeFiltered: overrides.subscribeFiltered ?? (() => Stream.empty),
    shutdown: overrides.shutdown ?? (() => Effect.void),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetCounters();
});

describe("createResumeHandler", () => {
  describe("resumeSuspendedTask", () => {
    test("re-registers agent and calls sendMessage when agent session is absent from adapter", async () => {
      const taskId = makeTaskId("task-1");
      const agentId = makeAgentId("dev");
      const suspension = makeSuspensionContext(taskId, { agentId });

      const asyncDone = makeDeferred();
      const dispatchCalls: DispatchCall[] = [];
      let startAgentCalled = false;
      let sendMessageCalled = false;

      const engine = makeMockEngine({
        dispatch: (cmd) => {
          if (cmd.type === "task.update-status") {
            dispatchCalls.push({ type: cmd.type, status: cmd.status });
          }
          return Effect.succeed({ sequence: 1, events: [] });
        },
        getReadModel: () =>
          Effect.succeed(
            makeReadModelWithTasks([makeTask({ id: taskId, taskType: "implementation" })]),
          ),
      });

      const agentService = makeMockAgentService({
        getAgent: () => Effect.succeed(null), // absent from adapter
        startAgent: (_id, _role, _dir) => {
          startAgentCalled = true;
          return Effect.succeed(makeAgentSession({ agentId }));
        },
        sendMessage: () => {
          sendMessageCalled = true;
          return Effect.succeed("task output");
        },
        markAvailable: () => asyncDone.resolve(),
      });

      const suspensionStore = makeMockSuspensionStore({
        getByTask: () => Effect.succeed(suspension),
      });

      const { resumeSuspendedTask } = createResumeHandler({
        engine,
        agentService,
        suspensionStore,
        bus: makeMockBus(),
        projectPath: "/tmp/test",
      });

      const result = await resumeSuspendedTask(taskId);
      expect(result.success).toBe(true);

      await asyncDone.promise;

      expect(startAgentCalled).toBe(true);
      expect(sendMessageCalled).toBe(true);
      const finalStatus = dispatchCalls[dispatchCalls.length - 1]?.status;
      expect(finalStatus === "done" || finalStatus === "review").toBe(true);
    });

    test("re-suspends task and preserves context when sendMessage fails with a non-quota error", async () => {
      const taskId = makeTaskId("task-2");
      const agentId = makeAgentId("dev");
      const suspension = makeSuspensionContext(taskId, { agentId });

      const asyncDone = makeDeferred();
      const dispatchCalls: DispatchCall[] = [];
      let removeCalled = false;
      let saveCalled = false;

      const engine = makeMockEngine({
        dispatch: (cmd) => {
          if (cmd.type === "task.update-status") {
            dispatchCalls.push({ type: cmd.type, status: cmd.status });
          }
          return Effect.succeed({ sequence: 1, events: [] });
        },
        getReadModel: () =>
          Effect.succeed(makeReadModelWithTasks([makeTask({ id: taskId })])),
      });

      const agentService = makeMockAgentService({
        getAgent: () => Effect.succeed(makeAgentSession({ agentId })), // session exists
        sendMessage: () =>
          Effect.fail(
            new AgentAdapterError({
              agentId,
              operation: "sendMessage",
              detail: "network timeout",
            }),
          ),
        markAvailable: () => asyncDone.resolve(),
      });

      const suspensionStore = makeMockSuspensionStore({
        getByTask: () => Effect.succeed(suspension),
        remove: () => {
          removeCalled = true;
          return Effect.void;
        },
        save: (ctx) => {
          saveCalled = true;
          return Effect.succeed({
            ...ctx,
            id: "mock-id",
            suspendedAt: new Date().toISOString(),
          } as SuspensionContext);
        },
      });

      const { resumeSuspendedTask } = createResumeHandler({
        engine,
        agentService,
        suspensionStore,
        bus: makeMockBus(),
        projectPath: "/tmp/test",
      });

      const result = await resumeSuspendedTask(taskId);
      expect(result.success).toBe(true);

      await asyncDone.promise;

      // Suspension record was never removed — it persists as-is for manual retry
      expect(removeCalled).toBe(false);
      // No re-save needed because the record was never removed
      expect(saveCalled).toBe(false);
      // Task dispatched back to suspended, not failed
      const statuses = dispatchCalls.map((c) => c.status);
      expect(statuses).toContain("suspended");
      expect(statuses).not.toContain("failed");
      expect(statuses).not.toContain("done");
    });

    test("re-suspends task and returns early without orphaning when startAgent throws", async () => {
      const taskId = makeTaskId("task-3");
      const agentId = makeAgentId("dev");
      const suspension = makeSuspensionContext(taskId, { agentId });

      const dispatchCalls: DispatchCall[] = [];
      let sendMessageCalled = false;
      let removeCalled = false;

      const engine = makeMockEngine({
        dispatch: (cmd) => {
          if (cmd.type === "task.update-status") {
            dispatchCalls.push({ type: cmd.type, status: cmd.status });
          }
          return Effect.succeed({ sequence: 1, events: [] });
        },
        getReadModel: () =>
          Effect.succeed(makeReadModelWithTasks([makeTask({ id: taskId })])),
      });

      const agentService = makeMockAgentService({
        getAgent: () => Effect.succeed(null), // absent from adapter
        startAgent: () =>
          Effect.fail(
            new AgentAdapterError({
              agentId,
              operation: "startSession",
              detail: "process spawn failed",
            }),
          ),
        sendMessage: () => {
          sendMessageCalled = true;
          return Effect.succeed("output");
        },
      });

      const suspensionStore = makeMockSuspensionStore({
        getByTask: () => Effect.succeed(suspension),
        remove: () => {
          removeCalled = true;
          return Effect.void;
        },
      });

      const { resumeSuspendedTask } = createResumeHandler({
        engine,
        agentService,
        suspensionStore,
        bus: makeMockBus(),
        projectPath: "/tmp/test",
      });

      // Returns synchronously (no fire-and-forget reached)
      const result = await resumeSuspendedTask(taskId);

      expect(result.success).toBe(false);
      expect(sendMessageCalled).toBe(false); // never reached
      expect(removeCalled).toBe(false); // suspension record untouched

      const statuses = dispatchCalls.map((c) => c.status);
      // Task moved in_progress then immediately re-suspended — not orphaned
      expect(statuses).toContain("in_progress");
      expect(statuses).toContain("suspended");
      expect(statuses).not.toContain("done");
      expect(statuses).not.toContain("failed");
    });

    test("removes suspension context only inside onSuccess and transitions task to done", async () => {
      const taskId = makeTaskId("task-4");
      const agentId = makeAgentId("dev");
      const suspension = makeSuspensionContext(taskId, { agentId });

      const asyncDone = makeDeferred();
      const dispatchCalls: DispatchCall[] = [];
      let removedTaskId: string | null = null;
      let saveCalled = false;

      // Track order: removal must happen before the done dispatch
      const operationOrder: string[] = [];

      const engine = makeMockEngine({
        dispatch: (cmd) => {
          if (cmd.type === "task.update-status") {
            dispatchCalls.push({ type: cmd.type, status: cmd.status });
            operationOrder.push(`dispatch:${cmd.status}`);
          }
          return Effect.succeed({ sequence: 1, events: [] });
        },
        getReadModel: () =>
          Effect.succeed(
            makeReadModelWithTasks([makeTask({ id: taskId, taskType: "implementation" })]),
          ),
      });

      const agentService = makeMockAgentService({
        getAgent: () => Effect.succeed(makeAgentSession({ agentId })),
        sendMessage: () => Effect.succeed("implementation output"),
        markAvailable: () => asyncDone.resolve(),
      });

      const suspensionStore = makeMockSuspensionStore({
        getByTask: () => Effect.succeed(suspension),
        remove: (tid) => {
          removedTaskId = tid;
          operationOrder.push("remove");
          return Effect.void;
        },
        save: (ctx) => {
          saveCalled = true;
          return Effect.succeed({
            ...ctx,
            id: "x",
            suspendedAt: new Date().toISOString(),
          } as SuspensionContext);
        },
      });

      const { resumeSuspendedTask } = createResumeHandler({
        engine,
        agentService,
        suspensionStore,
        bus: makeMockBus(),
        projectPath: "/tmp/test",
      });

      await resumeSuspendedTask(taskId);
      await asyncDone.promise;

      // Suspension removed with the right task ID
      expect(removedTaskId as unknown).toEqual(taskId);
      // Not re-saved on success
      expect(saveCalled).toBe(false);

      const statuses = dispatchCalls.map((c) => c.status);
      expect(statuses).toContain("done");
      expect(statuses).not.toContain("suspended");
      expect(statuses).not.toContain("failed");

      // remove() happened before the final done dispatch
      const removeIdx = operationOrder.indexOf("remove");
      const doneIdx = operationOrder.indexOf("dispatch:done");
      expect(removeIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(removeIdx);
    });

    test("transitions planning task to review (not done) on success", async () => {
      const taskId = makeTaskId("task-5");
      const agentId = makeAgentId("pm");
      const suspension = makeSuspensionContext(taskId, {
        agentId,
        agentRole: "pm",
        executionContext: {
          prompt: "Plan the project",
          taskType: "planning",
          taskTitle: "Initial Planning",
        },
      });

      const asyncDone = makeDeferred();
      const dispatchCalls: DispatchCall[] = [];

      const engine = makeMockEngine({
        dispatch: (cmd) => {
          if (cmd.type === "task.update-status") {
            dispatchCalls.push({ type: cmd.type, status: cmd.status });
          }
          return Effect.succeed({ sequence: 1, events: [] });
        },
        getReadModel: () =>
          Effect.succeed(
            makeReadModelWithTasks([makeTask({ id: taskId, taskType: "planning" })]),
          ),
      });

      const agentService = makeMockAgentService({
        getAgent: () => Effect.succeed(makeAgentSession({ agentId })),
        sendMessage: () => Effect.succeed("planning output"),
        markAvailable: () => asyncDone.resolve(),
      });

      const { resumeSuspendedTask } = createResumeHandler({
        engine,
        agentService,
        suspensionStore: makeMockSuspensionStore({ getByTask: () => Effect.succeed(suspension) }),
        bus: makeMockBus(),
        projectPath: "/tmp/test",
      });

      await resumeSuspendedTask(taskId);
      await asyncDone.promise;

      const statuses = dispatchCalls.map((c) => c.status);
      expect(statuses).toContain("review");
      expect(statuses).not.toContain("done");
    });

    test("returns success:false immediately when no suspension context exists for the task", async () => {
      const engine = makeMockEngine();
      let dispatchCalled = false;
      const engineWithSpy = makeMockEngine({
        dispatch: (cmd) => {
          dispatchCalled = true;
          return engine.dispatch(cmd);
        },
      });

      const { resumeSuspendedTask } = createResumeHandler({
        engine: engineWithSpy,
        agentService: makeMockAgentService(),
        suspensionStore: makeMockSuspensionStore({
          getByTask: () => Effect.succeed(null),
        }),
        bus: makeMockBus(),
        projectPath: "/tmp/test",
      });

      const result = await resumeSuspendedTask("nonexistent-task");

      expect(result.success).toBe(false);
      expect(dispatchCalled).toBe(false);
    });

    test("preserves the original task prompt when a resumed task hits quota again", async () => {
      const taskId = makeTaskId("task-6");
      const agentId = makeAgentId("dev");
      const suspension = makeSuspensionContext(taskId, {
        agentId,
        executionContext: {
          prompt: "Implement the feature",
          taskType: "implementation",
          taskTitle: "Implement feature X",
          partialOutput: "Completed the parser changes.",
        },
      });

      const asyncDone = makeDeferred();
      let savedExecutionContext: SuspensionContext["executionContext"] | null = null;

      const engine = makeMockEngine({
        dispatch: () => Effect.succeed({ sequence: 1, events: [] }),
        getReadModel: () =>
          Effect.succeed(makeReadModelWithTasks([makeTask({ id: taskId })])),
      });

      const agentService = makeMockAgentService({
        getAgent: () => Effect.succeed(makeAgentSession({ agentId })),
        sendMessage: () =>
          Effect.fail(
            new AgentQuotaExhaustedError({
              agentId,
              sessionId: "codex-thread-2",
              adapterType: "openai-codex",
              rawMessage: "quota exceeded",
              detectedAt: new Date().toISOString(),
            }),
          ),
        markAvailable: () => asyncDone.resolve(),
      });

      const suspensionStore = makeMockSuspensionStore({
        getByTask: () => Effect.succeed(suspension),
        save: (ctx) => {
          const savedContext = {
            ...ctx,
            id: "saved-id",
            suspendedAt: new Date().toISOString(),
          } as SuspensionContext;
          savedExecutionContext = savedContext.executionContext;
          return Effect.succeed(savedContext);
        },
      });

      const { resumeSuspendedTask } = createResumeHandler({
        engine,
        agentService,
        suspensionStore,
        bus: makeMockBus(),
        projectPath: "/tmp/test",
      });

      const result = await resumeSuspendedTask(taskId);
      expect(result.success).toBe(true);

      await asyncDone.promise;

      expect(savedExecutionContext).not.toBeNull();
      if (!savedExecutionContext) {
        throw new Error("Expected execution context to be saved");
      }
      const executionContext = savedExecutionContext as NonNullable<
        SuspensionContext["executionContext"]
      >;
      expect(executionContext.prompt).toBe("Implement the feature");
      expect(executionContext.prompt).not.toContain("## Task Continuation");
      expect(executionContext.partialOutput).toBe(
        "Completed the parser changes.",
      );
    });
  });

  describe("retryTask", () => {
    test("dispatches task.update-status with pending to transition a failed task back to pending", async () => {
      const taskId = makeTaskId("failed-task");
      const dispatchCalls: DispatchCall[] = [];

      const engine = makeMockEngine({
        dispatch: (cmd) => {
          if (cmd.type === "task.update-status") {
            dispatchCalls.push({ type: cmd.type, status: cmd.status });
          }
          return Effect.succeed({ sequence: 1, events: [] });
        },
      });

      const { retryTask } = createResumeHandler({
        engine,
        agentService: makeMockAgentService(),
        suspensionStore: makeMockSuspensionStore(),
        bus: makeMockBus(),
        projectPath: "/tmp/test",
      });

      const result = await retryTask(taskId);

      expect(result.success).toBe(true);
      expect(dispatchCalls).toHaveLength(1);
      expect(dispatchCalls[0].status).toBe("pending");
    });

    test("dispatches exactly once per retryTask call", async () => {
      const taskId = makeTaskId("task-retry");
      let dispatchCount = 0;

      const engine = makeMockEngine({
        dispatch: () => {
          dispatchCount++;
          return Effect.succeed({ sequence: 1, events: [] });
        },
      });

      const { retryTask } = createResumeHandler({
        engine,
        agentService: makeMockAgentService(),
        suspensionStore: makeMockSuspensionStore(),
        bus: makeMockBus(),
        projectPath: "/tmp/test",
      });

      await retryTask(taskId);
      expect(dispatchCount).toBe(1);
    });
  });
});
