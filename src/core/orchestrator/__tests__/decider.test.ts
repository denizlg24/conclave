import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Exit, Cause } from "effect";

import { decideOrchestrationCommand } from "../decider";
import { CommandInvariantError } from "../errors";
import {
  resetCounters,
  makeEmptyReadModel,
  makeTask,
  makeMeeting,
  makeReadModelWithTasks,
  makeTaskId,
  makeMeetingId,
  makeAgentId,
  makeCreateTaskCommand,
  makeAssignTaskCommand,
  makeUpdateStatusCommand,
  makeAddDependencyCommand,
  makeRemoveDependencyCommand,
  makeScheduleMeetingCommand,
  makeApproveTasksCommand,
} from "@/test-utils/factories";
import type { TaskId } from "@/shared/types/base-schemas";
import type { TaskStatus } from "@/shared/types/orchestration";

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

describe("decideOrchestrationCommand", () => {
  describe("task.create command", () => {
    test("produces task.created event for valid command", async () => {
      const command = makeCreateTaskCommand({
        taskId: makeTaskId("new-task"),
        title: "New Task" as string & { readonly TrimmedNonEmptyString: unique symbol },
        description: "Description",
        taskType: "implementation",
        deps: [],
      });
      const readModel = makeEmptyReadModel();

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("task.created");
      if (event.type === "task.created") {
        expect(event.payload.taskId).toBe(command.taskId);
        expect(event.payload.title).toBe(command.title);
        expect(event.payload.taskType).toBe(command.taskType);
        expect(event.payload.deps).toEqual([]);
      }
    });

    test("sets correct aggregate metadata", async () => {
      const command = makeCreateTaskCommand();
      const readModel = makeEmptyReadModel();

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.aggregateKind).toBe("task");
      expect(event.aggregateId).toBe(command.taskId);
      expect(event.commandId).toBe(command.commandId);
    });

    test("fails when task already exists", async () => {
      const existingTask = makeTask({ id: makeTaskId("existing") });
      const command = makeCreateTaskCommand({ taskId: existingTask.id });
      const readModel = makeReadModelWithTasks([existingTask]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      expect(error).toBeInstanceOf(CommandInvariantError);
      if (error instanceof CommandInvariantError) {
        expect(error.detail).toContain("already exists");
      }
    });

    test("succeeds when declaring existing tasks as dependencies", async () => {
      const depTask = makeTask({ id: makeTaskId("dep-task") });
      const command = makeCreateTaskCommand({
        taskId: makeTaskId("new-task"),
        deps: [depTask.id],
      });
      const readModel = makeReadModelWithTasks([depTask]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("task.created");
      if (event.type === "task.created") {
        expect(event.payload.deps).toContain(depTask.id);
      }
    });

    test("fails when dependency does not exist", async () => {
      const nonExistentDepId = makeTaskId("non-existent");
      const command = makeCreateTaskCommand({
        deps: [nonExistentDepId],
      });
      const readModel = makeEmptyReadModel();

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      if (error instanceof CommandInvariantError) {
        expect(error.detail).toContain("does not exist");
      }
    });
  });

  describe("task.assign command", () => {
    test("produces task.assigned event for pending task", async () => {
      const task = makeTask({ id: makeTaskId("task-1"), status: "pending" });
      const agentId = makeAgentId("agent-1");
      const command = makeAssignTaskCommand(task.id, {
        agentId,
        agentRole: "developer",
      });
      const readModel = makeReadModelWithTasks([task]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("task.assigned");
      if (event.type === "task.assigned") {
        expect(event.payload.taskId).toBe(task.id);
        expect(event.payload.agentId).toBe(agentId);
        expect(event.payload.agentRole).toBe("developer");
      }
    });

    test("allows re-assignment of already assigned task", async () => {
      const task = makeTask({
        id: makeTaskId("task-1"),
        status: "assigned",
        owner: makeAgentId("old-agent"),
      });
      const newAgentId = makeAgentId("new-agent");
      const command = makeAssignTaskCommand(task.id, {
        agentId: newAgentId,
        agentRole: "reviewer",
      });
      const readModel = makeReadModelWithTasks([task]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("task.assigned");
    });

    test("fails when task does not exist", async () => {
      const command = makeAssignTaskCommand(makeTaskId("non-existent"));
      const readModel = makeEmptyReadModel();

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });

    test("fails when task is in_progress", async () => {
      const task = makeTask({ id: makeTaskId("task-1"), status: "in_progress" });
      const command = makeAssignTaskCommand(task.id);
      const readModel = makeReadModelWithTasks([task]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      if (error instanceof CommandInvariantError) {
        expect(error.detail).toContain("in_progress");
      }
    });

    test("fails when task is done", async () => {
      const task = makeTask({ id: makeTaskId("task-1"), status: "done" });
      const command = makeAssignTaskCommand(task.id);
      const readModel = makeReadModelWithTasks([task]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });
  });

  describe("task.update-status command", () => {
    test("produces status-updated event for valid transition", async () => {
      const task = makeTask({ id: makeTaskId("task-1"), status: "assigned" });
      const command = makeUpdateStatusCommand(task.id, "in_progress");
      const readModel = makeReadModelWithTasks([task]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("task.status-updated");
      if (event.type === "task.status-updated") {
        expect(event.payload.previousStatus).toBe("assigned");
        expect(event.payload.status).toBe("in_progress");
      }
    });

    test("includes output when provided", async () => {
      const task = makeTask({ id: makeTaskId("task-1"), status: "in_progress" });
      const output = { result: "success", artifacts: ["file.txt"] };
      const command = makeUpdateStatusCommand(task.id, "done", { output });
      const readModel = makeReadModelWithTasks([task]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      if (event.type === "task.status-updated") {
        expect(event.payload.output).toEqual(output);
      }
    });

    test("includes reason when provided", async () => {
      const task = makeTask({ id: makeTaskId("task-1"), status: "in_progress" });
      const command = makeUpdateStatusCommand(task.id, "failed", {
        reason: "Build failed with errors",
      });
      const readModel = makeReadModelWithTasks([task]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      if (event.type === "task.status-updated") {
        expect(event.payload.reason).toBe("Build failed with errors");
      }
    });

    describe("status transition rules", () => {
      const validTransitions: Array<[TaskStatus, TaskStatus[]]> = [
        ["pending", ["assigned", "blocked", "failed"]],
        ["assigned", ["in_progress", "blocked", "failed"]],
        ["in_progress", ["review", "done", "failed", "blocked"]],
        ["review", ["done", "failed", "in_progress"]],
        ["blocked", ["pending", "assigned", "failed"]],
      ];

      for (const [from, toStatuses] of validTransitions) {
        for (const to of toStatuses) {
          test(`allows ${from} -> ${to}`, async () => {
            const task = makeTask({ id: makeTaskId("task"), status: from });
            const command = makeUpdateStatusCommand(task.id, to);
            const readModel = makeReadModelWithTasks([task]);

            const exit = await Effect.runPromiseExit(
              decideOrchestrationCommand({ command, readModel }),
            );

            expect(Exit.isSuccess(exit)).toBe(true);
          });
        }
      }

      const terminalStatuses: TaskStatus[] = ["done", "failed"];
      for (const terminal of terminalStatuses) {
        test(`rejects transition from terminal state ${terminal}`, async () => {
          const task = makeTask({ id: makeTaskId("task"), status: terminal });
          const command = makeUpdateStatusCommand(task.id, "pending");
          const readModel = makeReadModelWithTasks([task]);

          const exit = await Effect.runPromiseExit(
            decideOrchestrationCommand({ command, readModel }),
          );

          expect(Exit.isFailure(exit)).toBe(true);
          const error = extractError(exit);
          if (error instanceof CommandInvariantError) {
            expect(error.detail).toContain("Cannot transition");
          }
        });
      }

      test("rejects invalid pending -> done transition", async () => {
        const task = makeTask({ id: makeTaskId("task"), status: "pending" });
        const command = makeUpdateStatusCommand(task.id, "done");
        const readModel = makeReadModelWithTasks([task]);

        const exit = await Effect.runPromiseExit(
          decideOrchestrationCommand({ command, readModel }),
        );

        expect(Exit.isFailure(exit)).toBe(true);
      });

      test("rejects invalid assigned -> done transition", async () => {
        const task = makeTask({ id: makeTaskId("task"), status: "assigned" });
        const command = makeUpdateStatusCommand(task.id, "done");
        const readModel = makeReadModelWithTasks([task]);

        const exit = await Effect.runPromiseExit(
          decideOrchestrationCommand({ command, readModel }),
        );

        expect(Exit.isFailure(exit)).toBe(true);
      });
    });
  });

  describe("task.add-dependency command", () => {
    test("produces dependency-added event", async () => {
      const taskA = makeTask({ id: makeTaskId("A"), deps: [] });
      const taskB = makeTask({ id: makeTaskId("B"), deps: [] });
      const command = makeAddDependencyCommand(taskA.id, taskB.id);
      const readModel = makeReadModelWithTasks([taskA, taskB]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("task.dependency-added");
      if (event.type === "task.dependency-added") {
        expect(event.payload.taskId).toBe(taskA.id);
        expect(event.payload.dependsOn).toBe(taskB.id);
      }
    });

    test("fails when task does not exist", async () => {
      const taskB = makeTask({ id: makeTaskId("B") });
      const command = makeAddDependencyCommand(
        makeTaskId("non-existent"),
        taskB.id,
      );
      const readModel = makeReadModelWithTasks([taskB]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });

    test("fails when dependency task does not exist", async () => {
      const taskA = makeTask({ id: makeTaskId("A") });
      const command = makeAddDependencyCommand(
        taskA.id,
        makeTaskId("non-existent"),
      );
      const readModel = makeReadModelWithTasks([taskA]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });

    test("fails when adding self-dependency", async () => {
      const task = makeTask({ id: makeTaskId("A") });
      const command = makeAddDependencyCommand(task.id, task.id);
      const readModel = makeReadModelWithTasks([task]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      if (error instanceof CommandInvariantError) {
        expect(error.detail).toContain("cannot depend on itself");
      }
    });

    test("fails when creating cycle", async () => {
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;
      const taskA = makeTask({ id: taskAId, deps: [] });
      const taskB = makeTask({ id: taskBId, deps: [taskAId] });
      const command = makeAddDependencyCommand(taskAId, taskBId);
      const readModel = makeReadModelWithTasks([taskA, taskB]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      if (error instanceof CommandInvariantError) {
        expect(error.detail).toContain("cycle");
      }
    });
  });

  describe("task.remove-dependency command", () => {
    test("produces dependency-removed event", async () => {
      const taskBId = makeTaskId("B") as TaskId;
      const taskA = makeTask({ id: makeTaskId("A"), deps: [taskBId] });
      const taskB = makeTask({ id: taskBId, deps: [] });
      const command = makeRemoveDependencyCommand(taskA.id, taskBId);
      const readModel = makeReadModelWithTasks([taskA, taskB]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("task.dependency-removed");
      if (event.type === "task.dependency-removed") {
        expect(event.payload.taskId).toBe(taskA.id);
        expect(event.payload.dependsOn).toBe(taskBId);
      }
    });

    test("fails when task does not exist", async () => {
      const command = makeRemoveDependencyCommand(
        makeTaskId("non-existent"),
        makeTaskId("B"),
      );
      const readModel = makeEmptyReadModel();

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });

    test("fails when dependency does not exist in task deps", async () => {
      const task = makeTask({ id: makeTaskId("A"), deps: [] });
      const command = makeRemoveDependencyCommand(
        task.id,
        makeTaskId("not-a-dep"),
      );
      const readModel = makeReadModelWithTasks([task]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      if (error instanceof CommandInvariantError) {
        expect(error.detail).toContain("does not depend on");
      }
    });
  });

  describe("meeting.schedule command", () => {
    test("produces meeting.scheduled event", async () => {
      const command = makeScheduleMeetingCommand({
        meetingId: makeMeetingId("mtg-1"),
        meetingType: "planning",
        agenda: ["Item 1" as string & { readonly TrimmedNonEmptyString: unique symbol }],
        participants: ["pm", "developer"],
      });
      const readModel = makeEmptyReadModel();

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("meeting.scheduled");
      if (event.type === "meeting.scheduled") {
        expect(event.payload.meetingId).toBe(command.meetingId);
        expect(event.payload.meetingType).toBe("planning");
        expect(event.payload.participants).toContain("pm");
        expect(event.payload.participants).toContain("developer");
      }
    });

    test("sets correct aggregate metadata", async () => {
      const command = makeScheduleMeetingCommand();
      const readModel = makeEmptyReadModel();

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.aggregateKind).toBe("meeting");
      expect(event.aggregateId).toBe(command.meetingId);
    });

    test("fails when meeting already exists", async () => {
      const meeting = makeMeeting({ id: makeMeetingId("existing") });
      const command = makeScheduleMeetingCommand({ meetingId: meeting.id });
      const readModel = makeReadModelWithTasks([], [meeting]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      if (error instanceof CommandInvariantError) {
        expect(error.detail).toContain("already exists");
      }
    });
  });

  describe("meeting.approve-tasks command", () => {
    test("produces meeting.tasks-approved event", async () => {
      const meeting = makeMeeting({ id: makeMeetingId("mtg-1") });
      const task1 = makeTask({ id: makeTaskId("task-1"), status: "proposed" });
      const task2 = makeTask({ id: makeTaskId("task-2"), status: "proposed" });
      const command = makeApproveTasksCommand(
        meeting.id,
        [task1.id],
        [task2.id],
      );
      const readModel = makeReadModelWithTasks([task1, task2], [meeting]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("meeting.tasks-approved");
      if (event.type === "meeting.tasks-approved") {
        expect(event.payload.meetingId).toBe(meeting.id);
        expect(event.payload.approvedTaskIds).toContain(task1.id);
        expect(event.payload.rejectedTaskIds).toContain(task2.id);
      }
    });

    test("fails when meeting does not exist", async () => {
      const task = makeTask();
      const command = makeApproveTasksCommand(
        makeMeetingId("non-existent"),
        [task.id],
        [],
      );
      const readModel = makeReadModelWithTasks([task]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });

    test("fails when approved task does not exist", async () => {
      const meeting = makeMeeting();
      const command = makeApproveTasksCommand(
        meeting.id,
        [makeTaskId("non-existent")],
        [],
      );
      const readModel = makeReadModelWithTasks([], [meeting]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });

    test("fails when rejected task does not exist", async () => {
      const meeting = makeMeeting();
      const task = makeTask();
      const command = makeApproveTasksCommand(
        meeting.id,
        [task.id],
        [makeTaskId("non-existent")],
      );
      const readModel = makeReadModelWithTasks([task], [meeting]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });

    test("succeeds with empty approval lists", async () => {
      const meeting = makeMeeting();
      const command = makeApproveTasksCommand(meeting.id, [], []);
      const readModel = makeReadModelWithTasks([], [meeting]);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });

  describe("event metadata", () => {
    test("generates unique eventId for each event", async () => {
      const command1 = makeCreateTaskCommand({ taskId: makeTaskId("t1") });
      const command2 = makeCreateTaskCommand({ taskId: makeTaskId("t2") });
      const readModel = makeEmptyReadModel();

      const [result1, result2] = await Promise.all([
        Effect.runPromise(decideOrchestrationCommand({ command: command1, readModel })),
        Effect.runPromise(decideOrchestrationCommand({ command: command2, readModel })),
      ]);

      const event1 = Array.isArray(result1) ? result1[0] : result1;
      const event2 = Array.isArray(result2) ? result2[0] : result2;

      expect(event1.eventId).not.toBe(event2.eventId);
    });

    test("preserves command timestamp in occurredAt", async () => {
      const timestamp = "2024-01-15T10:00:00.000Z";
      const command = makeCreateTaskCommand({ createdAt: timestamp });
      const readModel = makeEmptyReadModel();

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.occurredAt).toBe(timestamp);
    });

    test("sets correlationId to commandId", async () => {
      const command = makeCreateTaskCommand();
      const readModel = makeEmptyReadModel();

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.correlationId).toBe(command.commandId);
    });
  });
});
