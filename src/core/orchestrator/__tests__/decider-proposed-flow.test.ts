import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Exit, Cause } from "effect";

import { decideOrchestrationCommand } from "../decider";
import { CommandInvariantError } from "../errors";
import type { OrchestrationEvent } from "@/shared/types/orchestration";
import {
  resetCounters,
  makeEmptyReadModel,
  makeTask,
  makeMeeting,
  makeReadModelWithTasks,
  makeTaskId,
  makeMeetingId,
  makeCreateTaskCommand,
  makeApproveTasksCommand,
} from "@/test-utils/factories";

type EventWithoutSequence = Omit<OrchestrationEvent, "sequence">;
type EventsArray = ReadonlyArray<EventWithoutSequence>;
type DeciderResult = EventWithoutSequence | EventsArray;

function toArray(result: DeciderResult): EventsArray {
  return (Array.isArray(result) ? result : [result]) as EventsArray;
}

function extractError<E>(exit: Exit.Exit<unknown, E>): E | undefined {
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason);
    return fail?.error as E | undefined;
  }
  return undefined;
}

beforeEach(() => {
  resetCounters();
});

describe("decider — proposed task approval flow", () => {
  describe("task.create with initialStatus 'proposed'", () => {
    test("emits task.created with initialStatus 'proposed' in payload", async () => {
      const command = makeCreateTaskCommand({
        taskId: makeTaskId("proposed-task"),
        initialStatus: "proposed",
      });
      const readModel = makeEmptyReadModel();

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      const event = events[0];
      expect(event?.type).toBe("task.created");
      if (event?.type === "task.created") {
        const payload = event.payload as { initialStatus?: "proposed" };
        expect(payload.initialStatus).toBe("proposed");
      }
    });

    test("task.create without initialStatus omits initialStatus from payload", async () => {
      const command = makeCreateTaskCommand({ taskId: makeTaskId("normal-task") });
      const readModel = makeEmptyReadModel();

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      const event = events[0];
      expect(event?.type).toBe("task.created");
      if (event?.type === "task.created") {
        const payload = event.payload as { initialStatus?: "proposed" };
        expect(payload.initialStatus).toBeUndefined();
      }
    });

    test("proposed task create still validates that deps exist", async () => {
      const command = makeCreateTaskCommand({
        taskId: makeTaskId("proposed-with-missing-dep"),
        initialStatus: "proposed",
        deps: [makeTaskId("ghost-dep")],
      });
      const readModel = makeEmptyReadModel();

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      expect(error).toBeInstanceOf(CommandInvariantError);
    });
  });

  describe("meeting.approve-tasks status transitions", () => {
    test("approved proposed task transitions from proposed to pending", async () => {
      const meeting = makeMeeting({ id: makeMeetingId("approval-mtg") });
      const approvedTask = makeTask({
        id: makeTaskId("approved-t"),
        status: "proposed",
      });
      const command = makeApproveTasksCommand(meeting.id, [approvedTask.id], []);
      const readModel = makeReadModelWithTasks([approvedTask], [meeting]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      const statusEvent = events.find(
        (e) => e.type === "task.status-updated" && e.aggregateId === approvedTask.id,
      );

      expect(statusEvent).toBeDefined();
      if (statusEvent?.type === "task.status-updated") {
        const payload = statusEvent.payload as { previousStatus: string; status: string; reason: string };
        expect(payload.previousStatus).toBe("proposed");
        expect(payload.status).toBe("pending");
        expect(payload.reason).toContain(meeting.id);
      }
    });

    test("rejected proposed task transitions from proposed to failed", async () => {
      const meeting = makeMeeting({ id: makeMeetingId("rejection-mtg") });
      const rejectedTask = makeTask({
        id: makeTaskId("rejected-t"),
        status: "proposed",
      });
      const command = makeApproveTasksCommand(meeting.id, [], [rejectedTask.id]);
      const readModel = makeReadModelWithTasks([rejectedTask], [meeting]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      const statusEvent = events.find(
        (e) => e.type === "task.status-updated" && e.aggregateId === rejectedTask.id,
      );

      expect(statusEvent).toBeDefined();
      if (statusEvent?.type === "task.status-updated") {
        const payload = statusEvent.payload as { previousStatus: string; status: string; reason: string };
        expect(payload.previousStatus).toBe("proposed");
        expect(payload.status).toBe("failed");
        expect(payload.reason).toContain(meeting.id);
      }
    });

    test("mixed approval emits pending for approved and failed for rejected in same batch", async () => {
      const meeting = makeMeeting({ id: makeMeetingId("mixed-mtg") });
      const taskApproved = makeTask({ id: makeTaskId("t-approve"), status: "proposed" });
      const taskRejected = makeTask({ id: makeTaskId("t-reject"), status: "proposed" });
      const command = makeApproveTasksCommand(
        meeting.id,
        [taskApproved.id],
        [taskRejected.id],
      );
      const readModel = makeReadModelWithTasks([taskApproved, taskRejected], [meeting]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      // meeting.tasks-approved + task.status-updated (approved) + task.status-updated (rejected)
      expect(events).toHaveLength(3);

      const approvedEvent = events.find(
        (e) => e.type === "task.status-updated" && e.aggregateId === taskApproved.id,
      );
      const rejectedEvent = events.find(
        (e) => e.type === "task.status-updated" && e.aggregateId === taskRejected.id,
      );

      const approvedPayload = approvedEvent?.payload as { status: string } | undefined;
      const rejectedPayload = rejectedEvent?.payload as { status: string } | undefined;

      expect(approvedPayload?.status).toBe("pending");
      expect(rejectedPayload?.status).toBe("failed");
    });

    test("first event in batch is always meeting.tasks-approved", async () => {
      const meeting = makeMeeting({ id: makeMeetingId("order-mtg") });
      const task1 = makeTask({ id: makeTaskId("t-order-1"), status: "proposed" });
      const command = makeApproveTasksCommand(meeting.id, [task1.id], []);
      const readModel = makeReadModelWithTasks([task1], [meeting]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      expect(events[0]?.type).toBe("meeting.tasks-approved");
      if (events[0]?.type === "meeting.tasks-approved") {
        const payload = events[0].payload as unknown as { approvedTaskIds: string[] };
        expect(payload.approvedTaskIds).toContain(task1.id);
      }
    });

    test("fails when trying to approve a non-proposed task", async () => {
      const meeting = makeMeeting({ id: makeMeetingId("bad-approve-mtg") });
      const pendingTask = makeTask({ id: makeTaskId("pending-t"), status: "pending" });
      const command = makeApproveTasksCommand(meeting.id, [pendingTask.id], []);
      const readModel = makeReadModelWithTasks([pendingTask], [meeting]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      expect(error).toBeInstanceOf(CommandInvariantError);
      if (error instanceof CommandInvariantError) {
        expect(error.detail).toContain("proposed");
      }
    });

    test("fails when trying to reject a non-proposed task", async () => {
      const meeting = makeMeeting({ id: makeMeetingId("bad-reject-mtg") });
      const doneTask = makeTask({ id: makeTaskId("done-t"), status: "done" });
      const command = makeApproveTasksCommand(meeting.id, [], [doneTask.id]);
      const readModel = makeReadModelWithTasks([doneTask], [meeting]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });
  });
});
