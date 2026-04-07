import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Duration, Stream } from "effect";

import { createPlanningReactor } from "../planning-reactor";
import { createEventBus, type EventBusShape } from "../event-bus";
import { createReceiptStore } from "../receipt-store";
import type { OrchestrationEngineShape } from "../../orchestrator/engine";
import type {
  OrchestrationCommand,
  OrchestrationReadModel,
} from "@/shared/types/orchestration";
import {
  resetCounters,
  makeTaskId,
  makeMeetingId,
  makeTask,
  makeMeeting,
  makeReadModelWithTasks,
  makeTaskStatusUpdatedEvent,
} from "@/test-utils/factories";

// Builds a minimal mock engine that captures dispatched commands
// and always returns the same static read model.
function makeMockEngine(readModel: OrchestrationReadModel): {
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

// Runs the planning reactor inside a bounded scope, publishes an event,
// and waits for the reactor to process it before the scope closes.
async function runWithReactor(
  engine: OrchestrationEngineShape,
  publishEvent: (bus: EventBusShape) => Promise<void>,
): Promise<void> {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* createEventBus();
        const receiptStore = yield* createReceiptStore();
        yield* createPlanningReactor({ engine, bus, receiptStore });
        // Allow PubSub subscription to register
        yield* Effect.sleep(Duration.millis(20));
        yield* Effect.promise(() => publishEvent(bus));
        // Allow the reactor fiber to process the event
        yield* Effect.sleep(Duration.millis(80));
      }),
    ),
  );
}

beforeEach(() => {
  resetCounters();
});

describe("planning-reactor", () => {
  describe("given a planning task that reaches review status with valid PM output", () => {
    test("dispatches meeting.complete with non-empty proposedTasks", async () => {
      const meetingId = makeMeetingId("plan-mtg");
      const taskId = makeTaskId("plan-task");

      const planOutput = JSON.stringify({
        tasks: [
          { title: "Impl Task", description: "Implement the feature", taskType: "implementation", deps: [] },
          { title: "Review Task", description: "Review the implementation", taskType: "review", deps: [0] },
        ],
      });

      const planningTask = makeTask({
        id: taskId,
        taskType: "planning",
        status: "in_progress",
        input: { meetingId },
        output: planOutput,
      });
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const readModel = makeReadModelWithTasks([planningTask], [meeting]);
      const { engine, dispatchedCommands } = makeMockEngine(readModel);

      const statusEvent = makeTaskStatusUpdatedEvent(taskId, "in_progress", "review", 1);

      await runWithReactor(engine, (bus) =>
        Effect.runPromise(bus.publish(statusEvent)),
      );

      const meetingCompleteCommands = dispatchedCommands.filter(
        (c) => c.type === "meeting.complete",
      );
      expect(meetingCompleteCommands).toHaveLength(1);

      const cmd = meetingCompleteCommands[0];
      if (cmd?.type === "meeting.complete") {
        expect(cmd.proposedTasks.length).toBeGreaterThan(0);
        expect(cmd.meetingId).toBe(meetingId);
      }
    });

    test("proposed tasks reflect the number of tasks in the PM output", async () => {
      const meetingId = makeMeetingId("plan-mtg-2");
      const taskId = makeTaskId("plan-task-2");

      const planOutput = JSON.stringify({
        tasks: [
          { title: "Setup DB", description: "Configure database", taskType: "implementation", deps: [] },
          { title: "Build API", description: "Implement REST API", taskType: "implementation", deps: [0] },
          { title: "Write Tests", description: "Cover API endpoints", taskType: "testing", deps: [1] },
        ],
      });

      const planningTask = makeTask({
        id: taskId,
        taskType: "planning",
        status: "in_progress",
        input: { meetingId },
        output: planOutput,
      });
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const { engine, dispatchedCommands } = makeMockEngine(
        makeReadModelWithTasks([planningTask], [meeting]),
      );

      const statusEvent = makeTaskStatusUpdatedEvent(taskId, "in_progress", "review", 1);
      await runWithReactor(engine, (bus) =>
        Effect.runPromise(bus.publish(statusEvent)),
      );

      const cmd = dispatchedCommands.find((c) => c.type === "meeting.complete");
      if (cmd?.type === "meeting.complete") {
        expect(cmd.proposedTasks).toHaveLength(3);
      } else {
        expect(cmd).toBeDefined();
      }
    });

    test("does NOT dispatch any task.create commands (meeting-reactor handles that separately)", async () => {
      const meetingId = makeMeetingId("plan-mtg-3");
      const taskId = makeTaskId("plan-task-3");

      const planOutput = JSON.stringify({
        tasks: [
          { title: "Task A", description: "Do A", taskType: "implementation", deps: [] },
        ],
      });

      const planningTask = makeTask({
        id: taskId,
        taskType: "planning",
        status: "in_progress",
        input: { meetingId },
        output: planOutput,
      });
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const { engine, dispatchedCommands } = makeMockEngine(
        makeReadModelWithTasks([planningTask], [meeting]),
      );

      const statusEvent = makeTaskStatusUpdatedEvent(taskId, "in_progress", "review", 1);
      await runWithReactor(engine, (bus) =>
        Effect.runPromise(bus.publish(statusEvent)),
      );

      const taskCreateCommands = dispatchedCommands.filter((c) => c.type === "task.create");
      expect(taskCreateCommands).toHaveLength(0);
    });

    test("each proposed task carries parentPlanningTaskId in input", async () => {
      const meetingId = makeMeetingId("plan-mtg-4");
      const taskId = makeTaskId("plan-task-4");

      const planOutput = JSON.stringify({
        tasks: [
          { title: "Subtask 1", description: "Do subtask 1", taskType: "implementation", deps: [] },
          { title: "Subtask 2", description: "Do subtask 2", taskType: "review", deps: [0] },
        ],
      });

      const planningTask = makeTask({
        id: taskId,
        taskType: "planning",
        status: "in_progress",
        input: { meetingId },
        output: planOutput,
      });
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const { engine, dispatchedCommands } = makeMockEngine(
        makeReadModelWithTasks([planningTask], [meeting]),
      );

      const statusEvent = makeTaskStatusUpdatedEvent(taskId, "in_progress", "review", 1);
      await runWithReactor(engine, (bus) =>
        Effect.runPromise(bus.publish(statusEvent)),
      );

      const cmd = dispatchedCommands.find((c) => c.type === "meeting.complete");
      if (cmd?.type === "meeting.complete") {
        for (const proposed of cmd.proposedTasks) {
          const input = proposed.input as Record<string, unknown>;
          expect(input?.parentPlanningTaskId).toBe(taskId);
        }
      } else {
        expect(cmd).toBeDefined();
      }
    });
  });

  describe("given events that should NOT trigger the reactor", () => {
    test("ignores task.status-updated for non-planning task types", async () => {
      const taskId = makeTaskId("impl-task");
      const implTask = makeTask({
        id: taskId,
        taskType: "implementation",
        status: "in_progress",
        output: JSON.stringify({ tasks: [{ title: "T", description: "D", taskType: "implementation", deps: [] }] }),
      });
      const { engine, dispatchedCommands } = makeMockEngine(
        makeReadModelWithTasks([implTask]),
      );

      const statusEvent = makeTaskStatusUpdatedEvent(taskId, "in_progress", "review", 1);
      await runWithReactor(engine, (bus) =>
        Effect.runPromise(bus.publish(statusEvent)),
      );

      expect(dispatchedCommands).toHaveLength(0);
    });

    test("ignores task.status-updated when new status is not review", async () => {
      const meetingId = makeMeetingId("mtg-ignore");
      const taskId = makeTaskId("plan-task-done");
      const planningTask = makeTask({
        id: taskId,
        taskType: "planning",
        status: "in_progress",
        input: { meetingId },
        output: JSON.stringify({ tasks: [{ title: "T", description: "D", taskType: "implementation", deps: [] }] }),
      });
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const { engine, dispatchedCommands } = makeMockEngine(
        makeReadModelWithTasks([planningTask], [meeting]),
      );

      // Transition to "done" directly, not "review"
      const statusEvent = makeTaskStatusUpdatedEvent(taskId, "in_progress", "done", 1);
      await runWithReactor(engine, (bus) =>
        Effect.runPromise(bus.publish(statusEvent)),
      );

      expect(dispatchedCommands).toHaveLength(0);
    });

    test("does not reprocess the same event twice (receipt store idempotency)", async () => {
      const meetingId = makeMeetingId("plan-mtg-idem");
      const taskId = makeTaskId("plan-task-idem");

      const planOutput = JSON.stringify({
        tasks: [
          { title: "Task X", description: "Do X", taskType: "implementation", deps: [] },
        ],
      });

      const planningTask = makeTask({
        id: taskId,
        taskType: "planning",
        status: "in_progress",
        input: { meetingId },
        output: planOutput,
      });
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const readModel = makeReadModelWithTasks([planningTask], [meeting]);
      const { engine, dispatchedCommands } = makeMockEngine(readModel);

      const statusEvent = makeTaskStatusUpdatedEvent(taskId, "in_progress", "review", 1);

      // Publish the same event twice in the same reactor scope
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const bus = yield* createEventBus();
            const receiptStore = yield* createReceiptStore();
            yield* createPlanningReactor({ engine, bus, receiptStore });
            yield* Effect.sleep(Duration.millis(20));
            yield* bus.publish(statusEvent);
            yield* bus.publish(statusEvent); // duplicate
            yield* Effect.sleep(Duration.millis(80));
          }),
        ),
      );

      const meetingCompleteCommands = dispatchedCommands.filter(
        (c) => c.type === "meeting.complete",
      );
      // Receipt store prevents double-processing
      expect(meetingCompleteCommands).toHaveLength(1);
    });
  });
});
