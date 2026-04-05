import { describe, test, expect, beforeEach } from "bun:test";

import { createEmptyReadModel, projectEvent, projectEvents } from "../projector";
import {
  resetCounters,
  makeTask,
  makeMeeting,
  makeReadModelWithTasks,
  makeTaskId,
  makeMeetingId,
  makeAgentId,
  makeTaskCreatedEvent,
  makeTaskAssignedEvent,
  makeTaskStatusUpdatedEvent,
  makeTaskDependencyAddedEvent,
  makeTaskDependencyRemovedEvent,
  makeMeetingScheduledEvent,
  makeMeetingTasksApprovedEvent,
} from "@/test-utils/factories";
import type { TaskId } from "@/shared/types/base-schemas";

beforeEach(() => {
  resetCounters();
});

describe("createEmptyReadModel", () => {
  test("creates model with zero sequence", () => {
    const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");

    expect(model.snapshotSequence).toBe(0);
  });

  test("creates model with empty tasks array", () => {
    const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");

    expect(model.tasks).toEqual([]);
  });

  test("creates model with empty meetings array", () => {
    const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");

    expect(model.meetings).toEqual([]);
  });

  test("sets updatedAt to provided timestamp", () => {
    const timestamp = "2024-01-15T10:00:00.000Z";
    const model = createEmptyReadModel(timestamp);

    expect(model.updatedAt).toBe(timestamp);
  });
});

describe("projectEvent", () => {
  describe("task.created event", () => {
    test("adds new task to read model", () => {
      const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");
      const taskId = makeTaskId("task-1");
      const event = makeTaskCreatedEvent(taskId, 1);

      const result = projectEvent(model, event);

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].id).toBe(taskId);
    });

    test("sets task to pending status when no dependencies", () => {
      const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");
      const taskId = makeTaskId("task-1");
      const event = makeTaskCreatedEvent(taskId, 1);

      const result = projectEvent(model, event);

      expect(result.tasks[0].status).toBe("pending");
    });

    test("sets task to blocked when dependency exists but not done", () => {
      const depTaskId = makeTaskId("dep-task") as TaskId;
      const depTask = makeTask({ id: depTaskId, status: "pending" });
      const model = makeReadModelWithTasks([depTask]);

      const taskId = makeTaskId("new-task");
      const event = makeTaskCreatedEvent(taskId, 1, {
        payload: {
          taskId,
          taskType: "implementation",
          title: "New Task" as string & { readonly TrimmedNonEmptyString: unique symbol },
          description: "",
          deps: [depTaskId],
          input: null,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      });

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskId)?.status).toBe("blocked");
    });

    test("sets task to pending when all dependencies are done", () => {
      const depTaskId = makeTaskId("dep-task") as TaskId;
      const depTask = makeTask({ id: depTaskId, status: "done" });
      const model = makeReadModelWithTasks([depTask]);

      const taskId = makeTaskId("new-task");
      const event = makeTaskCreatedEvent(taskId, 1, {
        payload: {
          taskId,
          taskType: "implementation",
          title: "New Task" as string & { readonly TrimmedNonEmptyString: unique symbol },
          description: "",
          deps: [depTaskId],
          input: null,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      });

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskId)?.status).toBe("pending");
    });

    test("initializes task with null owner", () => {
      const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");
      const event = makeTaskCreatedEvent(makeTaskId("task-1"), 1);

      const result = projectEvent(model, event);

      expect(result.tasks[0].owner).toBeNull();
      expect(result.tasks[0].ownerRole).toBeNull();
    });

    test("ignores duplicate task creation", () => {
      const taskId = makeTaskId("task-1");
      const existingTask = makeTask({ id: taskId });
      const model = makeReadModelWithTasks([existingTask]);
      const event = makeTaskCreatedEvent(taskId, 1);

      const result = projectEvent(model, event);

      expect(result.tasks).toHaveLength(1);
    });

    test("updates snapshotSequence", () => {
      const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");
      const event = makeTaskCreatedEvent(makeTaskId("task-1"), 42);

      const result = projectEvent(model, event);

      expect(result.snapshotSequence).toBe(42);
    });
  });

  describe("task.assigned event", () => {
    test("sets owner and ownerRole on task", () => {
      const taskId = makeTaskId("task-1");
      const task = makeTask({ id: taskId, status: "pending" });
      const model = makeReadModelWithTasks([task]);
      const agentId = makeAgentId("agent-1");
      const event = makeTaskAssignedEvent(taskId, agentId, 1, {
        payload: {
          taskId,
          agentId,
          agentRole: "developer",
          assignedAt: "2024-01-01T00:00:00.000Z",
        },
      });

      const result = projectEvent(model, event);

      const updatedTask = result.tasks.find((t) => t.id === taskId);
      expect(updatedTask?.owner).toBe(agentId);
      expect(updatedTask?.ownerRole).toBe("developer");
    });

    test("updates task status to assigned", () => {
      const taskId = makeTaskId("task-1");
      const task = makeTask({ id: taskId, status: "pending" });
      const model = makeReadModelWithTasks([task]);
      const event = makeTaskAssignedEvent(taskId, makeAgentId("agent-1"), 1);

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskId)?.status).toBe("assigned");
    });

    test("updates task updatedAt timestamp", () => {
      const taskId = makeTaskId("task-1");
      const task = makeTask({ id: taskId, updatedAt: "2024-01-01T00:00:00.000Z" });
      const model = makeReadModelWithTasks([task]);
      const assignedAt = "2024-01-15T12:00:00.000Z";
      const event = makeTaskAssignedEvent(taskId, makeAgentId("agent-1"), 1, {
        payload: {
          taskId,
          agentId: makeAgentId("agent-1"),
          agentRole: "developer",
          assignedAt,
        },
      });

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskId)?.updatedAt).toBe(assignedAt);
    });
  });

  describe("task.status-updated event", () => {
    test("updates task status", () => {
      const taskId = makeTaskId("task-1");
      const task = makeTask({ id: taskId, status: "assigned" });
      const model = makeReadModelWithTasks([task]);
      const event = makeTaskStatusUpdatedEvent(taskId, "assigned", "in_progress", 1);

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskId)?.status).toBe("in_progress");
    });

    test("stores output when provided", () => {
      const taskId = makeTaskId("task-1");
      const task = makeTask({ id: taskId, status: "in_progress" });
      const model = makeReadModelWithTasks([task]);
      const output = { result: "success", files: ["a.ts", "b.ts"] };
      const event = makeTaskStatusUpdatedEvent(taskId, "in_progress", "done", 1, {
        payload: {
          taskId,
          previousStatus: "in_progress",
          status: "done",
          reason: null,
          output,
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      });

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskId)?.output).toEqual(output);
    });

    test("unblocks dependent tasks when task completes", () => {
      const completedTaskId = makeTaskId("completed") as TaskId;
      const blockedTaskId = makeTaskId("blocked") as TaskId;

      const completedTask = makeTask({ id: completedTaskId, status: "in_progress" });
      const blockedTask = makeTask({
        id: blockedTaskId,
        status: "blocked",
        deps: [completedTaskId],
      });
      const model = makeReadModelWithTasks([completedTask, blockedTask]);

      const event = makeTaskStatusUpdatedEvent(
        completedTaskId,
        "in_progress",
        "done",
        1,
      );

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === blockedTaskId)?.status).toBe("pending");
    });

    test("keeps task blocked if other dependencies are not done", () => {
      const task1Id = makeTaskId("task-1") as TaskId;
      const task2Id = makeTaskId("task-2") as TaskId;
      const blockedTaskId = makeTaskId("blocked") as TaskId;

      const task1 = makeTask({ id: task1Id, status: "in_progress" });
      const task2 = makeTask({ id: task2Id, status: "pending" });
      const blockedTask = makeTask({
        id: blockedTaskId,
        status: "blocked",
        deps: [task1Id, task2Id],
      });
      const model = makeReadModelWithTasks([task1, task2, blockedTask]);

      const event = makeTaskStatusUpdatedEvent(task1Id, "in_progress", "done", 1);

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === blockedTaskId)?.status).toBe("blocked");
    });

    test("unblocks multiple dependent tasks when task completes", () => {
      const completedTaskId = makeTaskId("completed") as TaskId;
      const blocked1Id = makeTaskId("blocked-1") as TaskId;
      const blocked2Id = makeTaskId("blocked-2") as TaskId;

      const completedTask = makeTask({ id: completedTaskId, status: "in_progress" });
      const blocked1 = makeTask({
        id: blocked1Id,
        status: "blocked",
        deps: [completedTaskId],
      });
      const blocked2 = makeTask({
        id: blocked2Id,
        status: "blocked",
        deps: [completedTaskId],
      });
      const model = makeReadModelWithTasks([completedTask, blocked1, blocked2]);

      const event = makeTaskStatusUpdatedEvent(
        completedTaskId,
        "in_progress",
        "done",
        1,
      );

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === blocked1Id)?.status).toBe("pending");
      expect(result.tasks.find((t) => t.id === blocked2Id)?.status).toBe("pending");
    });

    test("does not affect non-blocked tasks on completion", () => {
      const completedTaskId = makeTaskId("completed") as TaskId;
      const pendingTaskId = makeTaskId("pending") as TaskId;

      const completedTask = makeTask({ id: completedTaskId, status: "in_progress" });
      const pendingTask = makeTask({
        id: pendingTaskId,
        status: "pending",
        deps: [completedTaskId],
      });
      const model = makeReadModelWithTasks([completedTask, pendingTask]);

      const event = makeTaskStatusUpdatedEvent(
        completedTaskId,
        "in_progress",
        "done",
        1,
      );

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === pendingTaskId)?.status).toBe("pending");
    });
  });

  describe("task.dependency-added event", () => {
    test("adds dependency to task deps array", () => {
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;
      const taskA = makeTask({ id: taskAId, deps: [] });
      const taskB = makeTask({ id: taskBId, deps: [] });
      const model = makeReadModelWithTasks([taskA, taskB]);

      const event = makeTaskDependencyAddedEvent(taskAId, taskBId, 1);

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskAId)?.deps).toContain(taskBId);
    });

    test("blocks pending task when adding incomplete dependency", () => {
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;
      const taskA = makeTask({ id: taskAId, status: "pending", deps: [] });
      const taskB = makeTask({ id: taskBId, status: "in_progress", deps: [] });
      const model = makeReadModelWithTasks([taskA, taskB]);

      const event = makeTaskDependencyAddedEvent(taskAId, taskBId, 1);

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskAId)?.status).toBe("blocked");
    });

    test("does not block if dependency is already done", () => {
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;
      const taskA = makeTask({ id: taskAId, status: "pending", deps: [] });
      const taskB = makeTask({ id: taskBId, status: "done", deps: [] });
      const model = makeReadModelWithTasks([taskA, taskB]);

      const event = makeTaskDependencyAddedEvent(taskAId, taskBId, 1);

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskAId)?.status).toBe("pending");
    });

    test("does not change status if task is not pending", () => {
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;
      const taskA = makeTask({ id: taskAId, status: "in_progress", deps: [] });
      const taskB = makeTask({ id: taskBId, status: "pending", deps: [] });
      const model = makeReadModelWithTasks([taskA, taskB]);

      const event = makeTaskDependencyAddedEvent(taskAId, taskBId, 1);

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskAId)?.status).toBe("in_progress");
    });

    test("does not duplicate existing dependency", () => {
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;
      const taskA = makeTask({ id: taskAId, deps: [taskBId] });
      const taskB = makeTask({ id: taskBId, deps: [] });
      const model = makeReadModelWithTasks([taskA, taskB]);

      const event = makeTaskDependencyAddedEvent(taskAId, taskBId, 1);

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskAId)?.deps).toEqual([taskBId]);
    });

    test("handles non-existent task gracefully", () => {
      const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");
      const event = makeTaskDependencyAddedEvent(
        makeTaskId("non-existent"),
        makeTaskId("dep"),
        1,
      );

      const result = projectEvent(model, event);

      expect(result.tasks).toHaveLength(0);
    });
  });

  describe("task.dependency-removed event", () => {
    test("removes dependency from task deps array", () => {
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;
      const taskA = makeTask({ id: taskAId, deps: [taskBId] });
      const taskB = makeTask({ id: taskBId, deps: [] });
      const model = makeReadModelWithTasks([taskA, taskB]);

      const event = makeTaskDependencyRemovedEvent(taskAId, taskBId, 1);

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskAId)?.deps).toEqual([]);
    });

    test("unblocks task when removing last incomplete dependency", () => {
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;
      const taskA = makeTask({ id: taskAId, status: "blocked", deps: [taskBId] });
      const taskB = makeTask({ id: taskBId, status: "pending", deps: [] });
      const model = makeReadModelWithTasks([taskA, taskB]);

      const event = makeTaskDependencyRemovedEvent(taskAId, taskBId, 1);

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskAId)?.status).toBe("pending");
    });

    test("keeps task blocked if other incomplete dependencies remain", () => {
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;
      const taskCId = makeTaskId("C") as TaskId;
      const taskA = makeTask({
        id: taskAId,
        status: "blocked",
        deps: [taskBId, taskCId],
      });
      const taskB = makeTask({ id: taskBId, status: "pending", deps: [] });
      const taskC = makeTask({ id: taskCId, status: "pending", deps: [] });
      const model = makeReadModelWithTasks([taskA, taskB, taskC]);

      const event = makeTaskDependencyRemovedEvent(taskAId, taskBId, 1);

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskAId)?.status).toBe("blocked");
    });

    test("unblocks task when all remaining dependencies are done", () => {
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;
      const taskCId = makeTaskId("C") as TaskId;
      const taskA = makeTask({
        id: taskAId,
        status: "blocked",
        deps: [taskBId, taskCId],
      });
      const taskB = makeTask({ id: taskBId, status: "pending", deps: [] });
      const taskC = makeTask({ id: taskCId, status: "done", deps: [] });
      const model = makeReadModelWithTasks([taskA, taskB, taskC]);

      const event = makeTaskDependencyRemovedEvent(taskAId, taskBId, 1);

      const result = projectEvent(model, event);

      expect(result.tasks.find((t) => t.id === taskAId)?.status).toBe("pending");
    });

    test("handles non-existent task gracefully", () => {
      const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");
      const event = makeTaskDependencyRemovedEvent(
        makeTaskId("non-existent"),
        makeTaskId("dep"),
        1,
      );

      const result = projectEvent(model, event);

      expect(result.tasks).toHaveLength(0);
    });
  });

  describe("meeting.scheduled event", () => {
    test("adds new meeting to read model", () => {
      const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");
      const meetingId = makeMeetingId("mtg-1");
      const event = makeMeetingScheduledEvent(meetingId, 1);

      const result = projectEvent(model, event);

      expect(result.meetings).toHaveLength(1);
      expect(result.meetings[0].id).toBe(meetingId);
    });

    test("sets meeting status to scheduled", () => {
      const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");
      const event = makeMeetingScheduledEvent(makeMeetingId("mtg-1"), 1);

      const result = projectEvent(model, event);

      expect(result.meetings[0].status).toBe("scheduled");
    });

    test("initializes empty approved/rejected task arrays", () => {
      const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");
      const event = makeMeetingScheduledEvent(makeMeetingId("mtg-1"), 1);

      const result = projectEvent(model, event);

      expect(result.meetings[0].approvedTaskIds).toEqual([]);
      expect(result.meetings[0].rejectedTaskIds).toEqual([]);
    });

    test("ignores duplicate meeting creation", () => {
      const meetingId = makeMeetingId("mtg-1");
      const meeting = makeMeeting({ id: meetingId });
      const model = makeReadModelWithTasks([], [meeting]);
      const event = makeMeetingScheduledEvent(meetingId, 1);

      const result = projectEvent(model, event);

      expect(result.meetings).toHaveLength(1);
    });
  });

  describe("meeting.tasks-approved event", () => {
    test("sets approved and rejected task IDs on meeting", () => {
      const meetingId = makeMeetingId("mtg-1");
      const meeting = makeMeeting({ id: meetingId });
      const task1Id = makeTaskId("task-1") as TaskId;
      const task2Id = makeTaskId("task-2") as TaskId;
      const model = makeReadModelWithTasks([], [meeting]);

      const event = makeMeetingTasksApprovedEvent(
        meetingId,
        [task1Id],
        [task2Id],
        1,
      );

      const result = projectEvent(model, event);

      const updatedMeeting = result.meetings.find((m) => m.id === meetingId);
      expect(updatedMeeting?.approvedTaskIds).toContain(task1Id);
      expect(updatedMeeting?.rejectedTaskIds).toContain(task2Id);
    });

    test("updates meeting updatedAt timestamp", () => {
      const meetingId = makeMeetingId("mtg-1");
      const meeting = makeMeeting({
        id: meetingId,
        updatedAt: "2024-01-01T00:00:00.000Z",
      });
      const model = makeReadModelWithTasks([], [meeting]);

      const event = makeMeetingTasksApprovedEvent(meetingId, [], [], 1);

      const result = projectEvent(model, event);

      expect(result.meetings.find((m) => m.id === meetingId)?.updatedAt).toBe(
        event.payload.approvedAt,
      );
    });
  });

  describe("model metadata updates", () => {
    test("updates snapshotSequence on every event", () => {
      let model = createEmptyReadModel("2024-01-01T00:00:00.000Z");

      model = projectEvent(model, makeTaskCreatedEvent(makeTaskId("t1"), 1));
      expect(model.snapshotSequence).toBe(1);

      model = projectEvent(model, makeTaskCreatedEvent(makeTaskId("t2"), 5));
      expect(model.snapshotSequence).toBe(5);

      model = projectEvent(model, makeTaskCreatedEvent(makeTaskId("t3"), 10));
      expect(model.snapshotSequence).toBe(10);
    });

    test("updates updatedAt on every event", () => {
      const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");
      const eventTime = "2024-06-15T14:30:00.000Z";
      const event = makeTaskCreatedEvent(makeTaskId("t1"), 1);
      const eventWithTime = { ...event, occurredAt: eventTime };

      const result = projectEvent(model, eventWithTime);

      expect(result.updatedAt).toBe(eventTime);
    });
  });
});

describe("projectEvents", () => {
  test("applies multiple events in sequence", () => {
    const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");
    const taskId = makeTaskId("task-1");
    const agentId = makeAgentId("agent-1");

    const events = [
      makeTaskCreatedEvent(taskId, 1),
      makeTaskAssignedEvent(taskId, agentId, 2),
      makeTaskStatusUpdatedEvent(taskId, "assigned", "in_progress", 3),
    ];

    const result = projectEvents(model, events);

    expect(result.snapshotSequence).toBe(3);
    const task = result.tasks.find((t) => t.id === taskId);
    expect(task?.status).toBe("in_progress");
    expect(task?.owner).toBe(agentId);
  });

  test("returns original model for empty event array", () => {
    const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");

    const result = projectEvents(model, []);

    expect(result).toEqual(model);
  });

  test("correctly handles complex task dependency chain", () => {
    const model = createEmptyReadModel("2024-01-01T00:00:00.000Z");

    const taskAId = makeTaskId("A") as TaskId;
    const taskBId = makeTaskId("B") as TaskId;
    const taskCId = makeTaskId("C") as TaskId;

    const events = [
      makeTaskCreatedEvent(taskAId, 1),
      makeTaskCreatedEvent(taskBId, 2, {
        payload: {
          taskId: taskBId,
          taskType: "implementation",
          title: "Task B" as string & { readonly TrimmedNonEmptyString: unique symbol },
          description: "",
          deps: [taskAId],
          input: null,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      }),
      makeTaskCreatedEvent(taskCId, 3, {
        payload: {
          taskId: taskCId,
          taskType: "implementation",
          title: "Task C" as string & { readonly TrimmedNonEmptyString: unique symbol },
          description: "",
          deps: [taskBId],
          input: null,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      }),
    ];

    let result = projectEvents(model, events);

    expect(result.tasks.find((t) => t.id === taskAId)?.status).toBe("pending");
    expect(result.tasks.find((t) => t.id === taskBId)?.status).toBe("blocked");
    expect(result.tasks.find((t) => t.id === taskCId)?.status).toBe("blocked");

    result = projectEvent(
      result,
      makeTaskStatusUpdatedEvent(taskAId, "pending", "done", 4),
    );

    expect(result.tasks.find((t) => t.id === taskBId)?.status).toBe("pending");
    expect(result.tasks.find((t) => t.id === taskCId)?.status).toBe("blocked");

    result = projectEvent(
      result,
      makeTaskStatusUpdatedEvent(taskBId, "pending", "done", 5),
    );

    expect(result.tasks.find((t) => t.id === taskCId)?.status).toBe("pending");
  });

  test("maintains immutability - original model unchanged", () => {
    const originalModel = createEmptyReadModel("2024-01-01T00:00:00.000Z");
    const events = [makeTaskCreatedEvent(makeTaskId("task-1"), 1)];

    const newModel = projectEvents(originalModel, events);

    expect(originalModel.tasks).toHaveLength(0);
    expect(newModel.tasks).toHaveLength(1);
  });
});
