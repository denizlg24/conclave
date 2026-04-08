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

  describe("edge cases: null and invalid output", () => {
    test("planning task with output: null dispatches exactly one task.update-status with status done and one meeting.complete with empty proposedTasks", async () => {
      const meetingId = makeMeetingId("null-output-mtg");
      const taskId = makeTaskId("null-output-task");

      const planningTask = makeTask({
        id: taskId,
        taskType: "planning",
        status: "in_progress",
        input: { meetingId },
        output: null,
      });
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const readModel = makeReadModelWithTasks([planningTask], [meeting]);
      const { engine, dispatchedCommands } = makeMockEngine(readModel);

      const statusEvent = makeTaskStatusUpdatedEvent(taskId, "in_progress", "review", 1);

      await runWithReactor(engine, (bus) =>
        Effect.runPromise(bus.publish(statusEvent)),
      );

      const updateStatusCommands = dispatchedCommands.filter(
        (c) => c.type === "task.update-status",
      );
      expect(updateStatusCommands).toHaveLength(1);
      const updateCmd = updateStatusCommands[0];
      if (updateCmd?.type === "task.update-status") {
        expect(updateCmd.status).toBe("done");
      } else {
        expect(updateCmd).toBeDefined();
      }

      const meetingCompleteCommands = dispatchedCommands.filter(
        (c) => c.type === "meeting.complete",
      );
      expect(meetingCompleteCommands).toHaveLength(1);
      const completeCmd = meetingCompleteCommands[0];
      if (completeCmd?.type === "meeting.complete") {
        expect(completeCmd.proposedTasks).toEqual([]);
      } else {
        expect(completeCmd).toBeDefined();
      }
    });

    test("planning task with output: 'not-json' dispatches exactly one task.update-status with status failed", async () => {
      const meetingId = makeMeetingId("invalid-json-mtg");
      const taskId = makeTaskId("invalid-json-task");

      const planningTask = makeTask({
        id: taskId,
        taskType: "planning",
        status: "in_progress",
        input: { meetingId },
        output: "not-json",
      });
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const readModel = makeReadModelWithTasks([planningTask], [meeting]);
      const { engine, dispatchedCommands } = makeMockEngine(readModel);

      const statusEvent = makeTaskStatusUpdatedEvent(taskId, "in_progress", "review", 1);

      await runWithReactor(engine, (bus) =>
        Effect.runPromise(bus.publish(statusEvent)),
      );

      const updateStatusCommands = dispatchedCommands.filter(
        (c) => c.type === "task.update-status",
      );
      expect(updateStatusCommands).toHaveLength(1);
      const cmd = updateStatusCommands[0];
      if (cmd?.type === "task.update-status") {
        expect(cmd.status).toBe("failed");
      } else {
        expect(cmd).toBeDefined();
      }
    });
  });

  describe("review task dependency auto-fix", () => {
    test("(a) review already lists all impl/testing deps — no change made to deps", async () => {
      const meetingId = makeMeetingId("autofix-a-mtg");
      const taskId = makeTaskId("autofix-a-task");

      // impl[0], testing[1], review[2] already depends on both → no auto-fix needed
      const planOutput = JSON.stringify({
        tasks: [
          { title: "Impl Task", description: "Implement feature", taskType: "implementation", deps: [] },
          { title: "Test Task", description: "Test the feature", taskType: "testing", deps: [0] },
          { title: "Review Task", description: "Review everything", taskType: "review", deps: [0, 1] },
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
        const reviewTask = cmd.proposedTasks.find((t) => t.taskType === "review");
        expect(reviewTask).toBeDefined();
        // deps must remain exactly [0, 1] — no duplicates or additions
        expect(reviewTask?.deps).toEqual([0, 1]);
      } else {
        expect(cmd).toBeDefined();
      }
    });

    test("(b) review task has zero deps with 2 impl tasks — auto-fix adds both indices", async () => {
      const meetingId = makeMeetingId("autofix-b-mtg");
      const taskId = makeTaskId("autofix-b-task");

      // impl[0], impl[1], review[2] with deps: [] → both impl indices must be injected
      const planOutput = JSON.stringify({
        tasks: [
          { title: "Impl Task 1", description: "First implementation", taskType: "implementation", deps: [] },
          { title: "Impl Task 2", description: "Second implementation", taskType: "implementation", deps: [0] },
          { title: "Review Task", description: "Review all work", taskType: "review", deps: [] },
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
        const reviewTask = cmd.proposedTasks.find((t) => t.taskType === "review");
        expect(reviewTask).toBeDefined();
        expect(reviewTask?.deps).toContain(0);
        expect(reviewTask?.deps).toContain(1);
        expect(reviewTask?.deps).toHaveLength(2);
      } else {
        expect(cmd).toBeDefined();
      }
    });

    test("(c) review task lists only some deps — missing ones added, existing ones preserved", async () => {
      const meetingId = makeMeetingId("autofix-c-mtg");
      const taskId = makeTaskId("autofix-c-task");

      // impl[0], impl[1], testing[2], review[3] with deps: [0]
      // → auto-fix must add [1, 2] while keeping [0]
      const planOutput = JSON.stringify({
        tasks: [
          { title: "Impl Task 1", description: "First implementation", taskType: "implementation", deps: [] },
          { title: "Impl Task 2", description: "Second implementation", taskType: "implementation", deps: [0] },
          { title: "Test Task", description: "Testing work", taskType: "testing", deps: [1] },
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
      const { engine, dispatchedCommands } = makeMockEngine(
        makeReadModelWithTasks([planningTask], [meeting]),
      );

      const statusEvent = makeTaskStatusUpdatedEvent(taskId, "in_progress", "review", 1);
      await runWithReactor(engine, (bus) =>
        Effect.runPromise(bus.publish(statusEvent)),
      );

      const cmd = dispatchedCommands.find((c) => c.type === "meeting.complete");
      if (cmd?.type === "meeting.complete") {
        const reviewTask = cmd.proposedTasks.find((t) => t.taskType === "review");
        expect(reviewTask).toBeDefined();
        // Original dep preserved, both missing deps injected — total 3 unique entries
        expect(reviewTask?.deps).toContain(0);
        expect(reviewTask?.deps).toContain(1);
        expect(reviewTask?.deps).toContain(2);
        expect(reviewTask?.deps).toHaveLength(3);
      } else {
        expect(cmd).toBeDefined();
      }
    });

    test("(e) plan with two review tasks each missing different impl deps — both independently corrected with no cross-contamination", async () => {
      const meetingId = makeMeetingId("autofix-e-mtg");
      const taskId = makeTaskId("autofix-e-task");

      // impl[0], impl[1]
      // reviewA[2] has deps: [0] — missing [1]
      // reviewB[3] has deps: [1] — missing [0]
      // After auto-fix both reviews must have exactly [0, 1]
      const planOutput = JSON.stringify({
        tasks: [
          { title: "Impl Task 1", description: "First implementation", taskType: "implementation", deps: [] },
          { title: "Impl Task 2", description: "Second implementation", taskType: "implementation", deps: [0] },
          { title: "Review Task A", description: "Review impl 1 only", taskType: "review", deps: [0] },
          { title: "Review Task B", description: "Review impl 2 only", taskType: "review", deps: [1] },
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
        const reviewTasks = cmd.proposedTasks.filter((t) => t.taskType === "review");
        expect(reviewTasks).toHaveLength(2);

        // reviewA originally had [0], must gain [1] — exactly 2 deps, no extras
        const reviewA = reviewTasks[0];
        expect(reviewA?.deps).toContain(0);
        expect(reviewA?.deps).toContain(1);
        expect(reviewA?.deps).toHaveLength(2);

        // reviewB originally had [1], must gain [0] — exactly 2 deps, no extras
        const reviewB = reviewTasks[1];
        expect(reviewB?.deps).toContain(0);
        expect(reviewB?.deps).toContain(1);
        expect(reviewB?.deps).toHaveLength(2);
      } else {
        expect(cmd).toBeDefined();
      }
    });

    test("(d) plan with no review task — no error thrown, meeting.complete dispatched normally", async () => {
      const meetingId = makeMeetingId("autofix-d-mtg");
      const taskId = makeTaskId("autofix-d-task");

      // Only impl tasks — no review node at all
      const planOutput = JSON.stringify({
        tasks: [
          { title: "Impl Task 1", description: "First implementation", taskType: "implementation", deps: [] },
          { title: "Impl Task 2", description: "Second implementation", taskType: "implementation", deps: [0] },
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

      // Must not throw even though there is no review task to auto-fix
      await expect(
        runWithReactor(engine, (bus) =>
          Effect.runPromise(bus.publish(statusEvent)),
        ),
      ).resolves.toBeUndefined();

      const meetingCompleteCommands = dispatchedCommands.filter(
        (c) => c.type === "meeting.complete",
      );
      expect(meetingCompleteCommands).toHaveLength(1);
      const cmd = meetingCompleteCommands[0];
      if (cmd?.type === "meeting.complete") {
        expect(cmd.proposedTasks).toHaveLength(2);
        expect(cmd.proposedTasks.some((t) => t.taskType === "review")).toBe(false);
      }
    });
  });
});
