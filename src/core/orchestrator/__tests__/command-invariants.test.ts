import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Exit, Cause } from "effect";

import {
  requireTask,
  requireTaskAbsent,
  requireTaskStatus,
  requireMeeting,
  requireMeetingAbsent,
  requireNoCyclicDependency,
} from "../command-invariants";
import { CommandInvariantError } from "../errors";
import {
  resetCounters,
  makeEmptyReadModel,
  makeTask,
  makeMeeting,
  makeReadModelWithTasks,
  makeTaskId,
  makeMeetingId,
  makeCreateTaskCommand,
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

describe("requireTask", () => {
  test("succeeds when task exists", async () => {
    const task = makeTask();
    const readModel = makeReadModelWithTasks([task]);
    const command = makeCreateTaskCommand();

    const result = await Effect.runPromise(
      requireTask({ readModel, command, taskId: task.id }),
    );

    expect(result.id).toBe(task.id);
  });

  test("fails when task does not exist", async () => {
    const readModel = makeEmptyReadModel();
    const command = makeCreateTaskCommand();
    const nonExistentId = makeTaskId("nonexistent");

    const exit = await Effect.runPromiseExit(
      requireTask({ readModel, command, taskId: nonExistentId }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = extractError(exit);
    expect(error).toBeInstanceOf(CommandInvariantError);
    if (error instanceof CommandInvariantError) {
      expect(error.detail).toContain("does not exist");
    }
  });

  test("returns correct task when multiple tasks exist", async () => {
    const task1 = makeTask({ id: makeTaskId("task-a") });
    const task2 = makeTask({ id: makeTaskId("task-b") });
    const task3 = makeTask({ id: makeTaskId("task-c") });
    const readModel = makeReadModelWithTasks([task1, task2, task3]);
    const command = makeCreateTaskCommand();

    const result = await Effect.runPromise(
      requireTask({ readModel, command, taskId: task2.id }),
    );

    expect(result.id).toBe(task2.id);
  });
});

describe("requireTaskAbsent", () => {
  test("succeeds when task does not exist", async () => {
    const readModel = makeEmptyReadModel();
    const command = makeCreateTaskCommand();
    const newTaskId = makeTaskId("new-task");

    await expect(
      Effect.runPromise(
        requireTaskAbsent({ readModel, command, taskId: newTaskId }),
      ),
    ).resolves.toBeUndefined();
  });

  test("fails when task already exists", async () => {
    const task = makeTask();
    const readModel = makeReadModelWithTasks([task]);
    const command = makeCreateTaskCommand();

    const exit = await Effect.runPromiseExit(
      requireTaskAbsent({ readModel, command, taskId: task.id }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = extractError(exit);
    expect(error).toBeInstanceOf(CommandInvariantError);
    if (error instanceof CommandInvariantError) {
      expect(error.detail).toContain("already exists");
    }
  });
});

describe("requireTaskStatus", () => {
  test("succeeds when task has allowed status", async () => {
    const task = makeTask({ status: "pending" });
    const readModel = makeReadModelWithTasks([task]);
    const command = makeCreateTaskCommand();

    const result = await Effect.runPromise(
      requireTaskStatus({
        readModel,
        command,
        taskId: task.id,
        allowed: ["pending", "assigned"],
      }),
    );

    expect(result.id).toBe(task.id);
  });

  test("fails when task has disallowed status", async () => {
    const task = makeTask({ status: "done" });
    const readModel = makeReadModelWithTasks([task]);
    const command = makeCreateTaskCommand();

    const exit = await Effect.runPromiseExit(
      requireTaskStatus({
        readModel,
        command,
        taskId: task.id,
        allowed: ["pending", "assigned"],
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = extractError(exit);
    if (error instanceof CommandInvariantError) {
      expect(error.detail).toContain("done");
      expect(error.detail).toContain("pending, assigned");
    }
  });

  test("fails when task does not exist", async () => {
    const readModel = makeEmptyReadModel();
    const command = makeCreateTaskCommand();
    const nonExistentId = makeTaskId("missing");

    const exit = await Effect.runPromiseExit(
      requireTaskStatus({
        readModel,
        command,
        taskId: nonExistentId,
        allowed: ["pending"],
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = extractError(exit);
    if (error instanceof CommandInvariantError) {
      expect(error.detail).toContain("does not exist");
    }
  });

  test("works with all valid status values", async () => {
    const statuses: TaskStatus[] = [
      "pending",
      "assigned",
      "in_progress",
      "review",
      "done",
      "failed",
      "blocked",
    ];

    for (const status of statuses) {
      resetCounters();
      const task = makeTask({ status });
      const readModel = makeReadModelWithTasks([task]);
      const command = makeCreateTaskCommand();

      const result = await Effect.runPromise(
        requireTaskStatus({
          readModel,
          command,
          taskId: task.id,
          allowed: [status],
        }),
      );

      expect(result.status).toBe(status);
    }
  });
});

describe("requireMeeting", () => {
  test("succeeds when meeting exists", async () => {
    const meeting = makeMeeting();
    const readModel = makeReadModelWithTasks([], [meeting]);
    const command = makeCreateTaskCommand();

    const result = await Effect.runPromise(
      requireMeeting({ readModel, command, meetingId: meeting.id }),
    );

    expect(result.id).toBe(meeting.id);
  });

  test("fails when meeting does not exist", async () => {
    const readModel = makeEmptyReadModel();
    const command = makeCreateTaskCommand();
    const nonExistentId = makeMeetingId("missing");

    const exit = await Effect.runPromiseExit(
      requireMeeting({ readModel, command, meetingId: nonExistentId }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = extractError(exit);
    if (error instanceof CommandInvariantError) {
      expect(error.detail).toContain("does not exist");
    }
  });
});

describe("requireMeetingAbsent", () => {
  test("succeeds when meeting does not exist", async () => {
    const readModel = makeEmptyReadModel();
    const command = makeCreateTaskCommand();
    const newMeetingId = makeMeetingId("new-meeting");

    await expect(
      Effect.runPromise(
        requireMeetingAbsent({ readModel, command, meetingId: newMeetingId }),
      ),
    ).resolves.toBeUndefined();
  });

  test("fails when meeting already exists", async () => {
    const meeting = makeMeeting();
    const readModel = makeReadModelWithTasks([], [meeting]);
    const command = makeCreateTaskCommand();

    const exit = await Effect.runPromiseExit(
      requireMeetingAbsent({ readModel, command, meetingId: meeting.id }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = extractError(exit);
    if (error instanceof CommandInvariantError) {
      expect(error.detail).toContain("already exists");
    }
  });
});

describe("requireNoCyclicDependency", () => {
  test("succeeds when adding dependency creates no cycle", async () => {
    const taskA = makeTask({ id: makeTaskId("A"), deps: [] });
    const taskB = makeTask({ id: makeTaskId("B"), deps: [] });
    const readModel = makeReadModelWithTasks([taskA, taskB]);
    const command = makeCreateTaskCommand();

    await expect(
      Effect.runPromise(
        requireNoCyclicDependency({
          readModel,
          command,
          taskId: taskA.id,
          dependsOn: taskB.id,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  test("fails when task would depend on itself", async () => {
    const task = makeTask({ id: makeTaskId("self") });
    const readModel = makeReadModelWithTasks([task]);
    const command = makeCreateTaskCommand();

    const exit = await Effect.runPromiseExit(
      requireNoCyclicDependency({
        readModel,
        command,
        taskId: task.id,
        dependsOn: task.id,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = extractError(exit);
    if (error instanceof CommandInvariantError) {
      expect(error.detail).toContain("cannot depend on itself");
    }
  });

  test("fails when adding dependency would create direct cycle (A -> B -> A)", async () => {
    const taskAId = makeTaskId("A") as TaskId;
    const taskBId = makeTaskId("B") as TaskId;

    const taskA = makeTask({ id: taskAId, deps: [] });
    const taskB = makeTask({ id: taskBId, deps: [taskAId] });
    const readModel = makeReadModelWithTasks([taskA, taskB]);
    const command = makeCreateTaskCommand();

    const exit = await Effect.runPromiseExit(
      requireNoCyclicDependency({
        readModel,
        command,
        taskId: taskAId,
        dependsOn: taskBId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = extractError(exit);
    if (error instanceof CommandInvariantError) {
      expect(error.detail).toContain("would create a cycle");
    }
  });

  test("fails when adding dependency would create indirect cycle (A -> B -> C -> A)", async () => {
    const taskAId = makeTaskId("A") as TaskId;
    const taskBId = makeTaskId("B") as TaskId;
    const taskCId = makeTaskId("C") as TaskId;

    const taskA = makeTask({ id: taskAId, deps: [] });
    const taskB = makeTask({ id: taskBId, deps: [taskAId] });
    const taskC = makeTask({ id: taskCId, deps: [taskBId] });
    const readModel = makeReadModelWithTasks([taskA, taskB, taskC]);
    const command = makeCreateTaskCommand();

    const exit = await Effect.runPromiseExit(
      requireNoCyclicDependency({
        readModel,
        command,
        taskId: taskAId,
        dependsOn: taskCId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = extractError(exit);
    if (error instanceof CommandInvariantError) {
      expect(error.detail).toContain("would create a cycle");
    }
  });

  test("succeeds for valid DAG with multiple paths (diamond shape)", async () => {
    const taskAId = makeTaskId("A") as TaskId;
    const taskBId = makeTaskId("B") as TaskId;
    const taskCId = makeTaskId("C") as TaskId;
    const taskDId = makeTaskId("D") as TaskId;

    const taskA = makeTask({ id: taskAId, deps: [] });
    const taskB = makeTask({ id: taskBId, deps: [taskAId] });
    const taskC = makeTask({ id: taskCId, deps: [taskAId] });
    const taskD = makeTask({ id: taskDId, deps: [taskBId, taskCId] });
    const readModel = makeReadModelWithTasks([taskA, taskB, taskC, taskD]);
    const command = makeCreateTaskCommand();

    await expect(
      Effect.runPromise(
        requireNoCyclicDependency({
          readModel,
          command,
          taskId: taskDId,
          dependsOn: taskAId,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  test("handles missing dependency gracefully in cycle check", async () => {
    const taskAId = makeTaskId("A") as TaskId;
    const taskBId = makeTaskId("B") as TaskId;
    const missingId = makeTaskId("missing") as TaskId;

    const taskA = makeTask({ id: taskAId, deps: [] });
    const taskB = makeTask({ id: taskBId, deps: [missingId] });
    const readModel = makeReadModelWithTasks([taskA, taskB]);
    const command = makeCreateTaskCommand();

    await expect(
      Effect.runPromise(
        requireNoCyclicDependency({
          readModel,
          command,
          taskId: taskAId,
          dependsOn: taskBId,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  test("detects deep cycle in large dependency chain", async () => {
    const taskIds = Array.from({ length: 10 }, (_, i) =>
      makeTaskId(`task-${i}`),
    ) as TaskId[];

    const tasks = taskIds.map((id, index) =>
      makeTask({
        id,
        deps: index > 0 ? [taskIds[index - 1]] : [],
      }),
    );

    const readModel = makeReadModelWithTasks(tasks);
    const command = makeCreateTaskCommand();

    const exit = await Effect.runPromiseExit(
      requireNoCyclicDependency({
        readModel,
        command,
        taskId: taskIds[0],
        dependsOn: taskIds[9],
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = extractError(exit);
    if (error instanceof CommandInvariantError) {
      expect(error.detail).toContain("would create a cycle");
    }
  });
});
