import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Duration, Stream } from "effect";

import { createMeetingReactor } from "../meeting-reactor";
import { createEventBus } from "../event-bus";
import { createReceiptStore } from "../receipt-store";
import type { OrchestrationEngineShape } from "../../orchestrator/engine";
import type {
  MeetingTaskDependencyRef,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@/shared/types/orchestration";
import {
  resetCounters,
  makeTaskId,
  makeMeetingId,
  makeEventId,
  makeCommandId,
  makeIsoDate,
  makeEmptyReadModel,
} from "@/test-utils/factories";

type TrimStr = string & { readonly TrimmedNonEmptyString: unique symbol };
const str = (s: string): TrimStr => s as TrimStr;

// Builds a meeting.completed event with the given proposedTasks
function makeMeetingCompletedEvent(
  meetingId: ReturnType<typeof makeMeetingId>,
  proposedTasks: Array<{
    taskType: "decomposition" | "implementation" | "review" | "testing" | "planning";
    title: TrimStr;
    description: string;
    deps: MeetingTaskDependencyRef[];
    input: unknown;
  }>,
  sequence = 1,
): Extract<OrchestrationEvent, { type: "meeting.completed" }> {
  const now = makeIsoDate();
  return {
    schemaVersion: 1 as const,
    sequence,
    eventId: makeEventId(),
    aggregateKind: "meeting",
    aggregateId: meetingId,
    occurredAt: now,
    commandId: makeCommandId(),
    causationEventId: null,
    correlationId: makeCommandId(),
    metadata: {},
    type: "meeting.completed",
    payload: {
      meetingId,
      summary: "Planning meeting concluded.",
      proposedTaskIds: [],
      proposedTasks,
      completedAt: now,
    },
  };
}

// Builds a minimal mock engine that captures dispatched commands.
function makeMockEngine(readModel: OrchestrationReadModel = makeEmptyReadModel()): {
  engine: OrchestrationEngineShape;
  dispatchedCommands: OrchestrationCommand[];
} {
  const dispatchedCommands: OrchestrationCommand[] = [];
  const engine: OrchestrationEngineShape = {
    getReadModel: () => Effect.succeed(readModel),
    dispatch: (command) => {
      dispatchedCommands.push(command);
      return Effect.succeed({ sequence: dispatchedCommands.length, events: [] });
    },
    readEvents: () => Stream.empty as never,
    replay: () => Effect.succeed(readModel),
  };
  return { engine, dispatchedCommands };
}

async function runWithReactor(
  engine: OrchestrationEngineShape,
  event: OrchestrationEvent,
): Promise<void> {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* createEventBus();
        const receiptStore = yield* createReceiptStore();
        yield* createMeetingReactor({ engine, bus, receiptStore });
        yield* Effect.sleep(Duration.millis(20));
        yield* bus.publish(event);
        yield* Effect.sleep(Duration.millis(80));
      }),
    ),
  );
}

beforeEach(() => {
  resetCounters();
});

describe("meeting-reactor", () => {
  describe("on meeting.completed with proposedTasks", () => {
    test("dispatches one task.create per proposed task", async () => {
      const meetingId = makeMeetingId("mtg-create");
      const { engine, dispatchedCommands } = makeMockEngine();

      const event = makeMeetingCompletedEvent(meetingId, [
        { taskType: "implementation", title: str("Build API"), description: "REST endpoints", deps: [], input: null },
        { taskType: "review", title: str("Code Review"), description: "Review PR", deps: [], input: null },
      ]);

      await runWithReactor(engine, event);

      const createCommands = dispatchedCommands.filter((c) => c.type === "task.create");
      expect(createCommands).toHaveLength(2);
    });

    test("all task.create commands carry initialStatus 'proposed'", async () => {
      const meetingId = makeMeetingId("mtg-proposed-status");
      const { engine, dispatchedCommands } = makeMockEngine();

      const event = makeMeetingCompletedEvent(meetingId, [
        { taskType: "implementation", title: str("Task 1"), description: "First task", deps: [], input: null },
        { taskType: "testing", title: str("Task 2"), description: "Second task", deps: [], input: null },
        { taskType: "review", title: str("Task 3"), description: "Third task", deps: [], input: null },
      ]);

      await runWithReactor(engine, event);

      const createCommands = dispatchedCommands.filter((c) => c.type === "task.create");
      expect(createCommands).toHaveLength(3);

      for (const cmd of createCommands) {
        if (cmd.type === "task.create") {
          expect(cmd.initialStatus).toBe("proposed");
        }
      }
    });

    test("each task.create has a unique taskId", async () => {
      const meetingId = makeMeetingId("mtg-unique-ids");
      const { engine, dispatchedCommands } = makeMockEngine();

      const event = makeMeetingCompletedEvent(meetingId, [
        { taskType: "implementation", title: str("T1"), description: "T1", deps: [], input: null },
        { taskType: "implementation", title: str("T2"), description: "T2", deps: [], input: null },
      ]);

      await runWithReactor(engine, event);

      const createCommands = dispatchedCommands.filter((c) => c.type === "task.create");
      const ids = createCommands.map((c) => (c.type === "task.create" ? c.taskId : null));
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(2);
    });

    test("inter-task deps are resolved to TaskIds of sibling tasks (index-based resolution)", async () => {
      const meetingId = makeMeetingId("mtg-deps");
      const { engine, dispatchedCommands } = makeMockEngine();

      // task[1] depends on task[0] expressed as the zero-based index 0
      const event = makeMeetingCompletedEvent(meetingId, [
        { taskType: "implementation", title: str("Base Task"), description: "Do base work", deps: [], input: null },
        { taskType: "review", title: str("Dependent Task"), description: "Depends on base", deps: [0], input: null },
      ]);

      await runWithReactor(engine, event);

      const createCommands = dispatchedCommands.filter((c) => c.type === "task.create");
      expect(createCommands).toHaveLength(2);

      const baseCreate = createCommands[0];
      const depCreate = createCommands[1];

      if (baseCreate?.type === "task.create" && depCreate?.type === "task.create") {
        // The dep in task[1]'s create should resolve to task[0]'s generated TaskId
        expect(depCreate.deps).toContain(baseCreate.taskId);
      } else {
        expect(baseCreate).toBeDefined();
        expect(depCreate).toBeDefined();
      }
    });

    test("tasks with no deps are created with empty deps array", async () => {
      const meetingId = makeMeetingId("mtg-no-deps");
      const { engine, dispatchedCommands } = makeMockEngine();

      const event = makeMeetingCompletedEvent(meetingId, [
        { taskType: "implementation", title: str("Solo Task"), description: "Independent work", deps: [], input: null },
      ]);

      await runWithReactor(engine, event);

      const createCmd = dispatchedCommands.find((c) => c.type === "task.create");
      if (createCmd?.type === "task.create") {
        expect(createCmd.deps).toHaveLength(0);
      } else {
        expect(createCmd).toBeDefined();
      }
    });

    test("task input includes proposedByMeeting field pointing to the source meeting", async () => {
      const meetingId = makeMeetingId("mtg-input-check");
      const { engine, dispatchedCommands } = makeMockEngine();

      const event = makeMeetingCompletedEvent(meetingId, [
        { taskType: "implementation", title: str("Task With Input"), description: "Some task", deps: [], input: { extra: "data" } },
      ]);

      await runWithReactor(engine, event);

      const createCmd = dispatchedCommands.find((c) => c.type === "task.create");
      if (createCmd?.type === "task.create") {
        const input = createCmd.input as Record<string, unknown>;
        expect(input?.proposedByMeeting).toBe(meetingId);
      } else {
        expect(createCmd).toBeDefined();
      }
    });

    test("extra input fields from proposed task are preserved alongside proposedByMeeting", async () => {
      const meetingId = makeMeetingId("mtg-input-merge");
      const { engine, dispatchedCommands } = makeMockEngine();

      const event = makeMeetingCompletedEvent(meetingId, [
        { taskType: "implementation", title: str("Merge Task"), description: "Check input merge", deps: [], input: { parentPlanningTaskId: makeTaskId("parent") } },
      ]);

      await runWithReactor(engine, event);

      const createCmd = dispatchedCommands.find((c) => c.type === "task.create");
      if (createCmd?.type === "task.create") {
        const input = createCmd.input as Record<string, unknown>;
        expect(input?.proposedByMeeting).toBe(meetingId);
        expect(input?.parentPlanningTaskId).toBeDefined();
      } else {
        expect(createCmd).toBeDefined();
      }
    });
  });

  describe("when meeting.completed has no proposed tasks", () => {
    test("dispatches no task.create commands", async () => {
      const meetingId = makeMeetingId("mtg-empty");
      const { engine, dispatchedCommands } = makeMockEngine();

      const event = makeMeetingCompletedEvent(meetingId, []);
      await runWithReactor(engine, event);

      const createCommands = dispatchedCommands.filter((c) => c.type === "task.create");
      expect(createCommands).toHaveLength(0);
    });
  });

  describe("idempotency via receipt store", () => {
    test("does not process the same meeting.completed event twice", async () => {
      const meetingId = makeMeetingId("mtg-idem");
      const { engine, dispatchedCommands } = makeMockEngine();

      const event = makeMeetingCompletedEvent(meetingId, [
        { taskType: "implementation", title: str("Idem Task"), description: "Should only be created once", deps: [], input: null },
      ]);

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const bus = yield* createEventBus();
            const receiptStore = yield* createReceiptStore();
            yield* createMeetingReactor({ engine, bus, receiptStore });
            yield* Effect.sleep(Duration.millis(20));
            yield* bus.publish(event);
            yield* bus.publish(event); // duplicate — same eventId
            yield* Effect.sleep(Duration.millis(80));
          }),
        ),
      );

      const createCommands = dispatchedCommands.filter((c) => c.type === "task.create");
      expect(createCommands).toHaveLength(1);
    });
  });
});
