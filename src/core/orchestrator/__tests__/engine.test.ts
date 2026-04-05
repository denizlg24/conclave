import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Exit, Stream, Cause } from "effect";

import { createOrchestrationEngine } from "../engine";
import { DispatchError } from "../errors";
import {
  resetCounters,
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

describe("createOrchestrationEngine", () => {
  test("creates engine with empty read model", async () => {
    const engine = await Effect.runPromise(createOrchestrationEngine());

    const readModel = await Effect.runPromise(engine.getReadModel());

    expect(readModel.snapshotSequence).toBe(0);
    expect(readModel.tasks).toEqual([]);
    expect(readModel.meetings).toEqual([]);
  });
});

describe("OrchestrationEngine.dispatch", () => {
  describe("basic dispatch flow", () => {
    test("dispatches command and returns persisted events", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const command = makeCreateTaskCommand();

      const result = await Effect.runPromise(engine.dispatch(command));

      expect(result.sequence).toBe(1);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe("task.created");
    });

    test("updates read model after dispatch", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const taskId = makeTaskId("task-1");
      const command = makeCreateTaskCommand({ taskId });

      await Effect.runPromise(engine.dispatch(command));

      const readModel = await Effect.runPromise(engine.getReadModel());
      expect(readModel.tasks).toHaveLength(1);
      expect(readModel.tasks[0].id).toBe(taskId);
    });

    test("sequence increases with each dispatch", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());

      const result1 = await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: makeTaskId("t1") })),
      );
      const result2 = await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: makeTaskId("t2") })),
      );
      const result3 = await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: makeTaskId("t3") })),
      );

      expect(result1.sequence).toBe(1);
      expect(result2.sequence).toBe(2);
      expect(result3.sequence).toBe(3);
    });
  });

  describe("command validation errors", () => {
    test("returns DispatchError for invalid command", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const command = makeCreateTaskCommand({ taskId: makeTaskId("task-1") });

      await Effect.runPromise(engine.dispatch(command));

      const duplicateCommand = makeCreateTaskCommand({ taskId: makeTaskId("task-1") });
      const exit = await Effect.runPromiseExit(engine.dispatch(duplicateCommand));

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      expect(error).toBeInstanceOf(DispatchError);
      if (error instanceof DispatchError) {
        expect(error.commandType).toBe("task.create");
      }
    });

    test("preserves underlying error in DispatchError cause", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const command = makeAssignTaskCommand(makeTaskId("non-existent"));

      const exit = await Effect.runPromiseExit(engine.dispatch(command));

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      if (error instanceof DispatchError) {
        expect(error.cause._tag).toBe("CommandInvariantError");
      }
    });

    test("read model unchanged after failed dispatch", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const command = makeAssignTaskCommand(makeTaskId("non-existent"));

      const beforeModel = await Effect.runPromise(engine.getReadModel());
      await Effect.runPromiseExit(engine.dispatch(command));
      const afterModel = await Effect.runPromise(engine.getReadModel());

      expect(afterModel.tasks).toEqual(beforeModel.tasks);
      expect(afterModel.snapshotSequence).toBe(beforeModel.snapshotSequence);
    });
  });

  describe("full task lifecycle", () => {
    test("complete task workflow: create -> assign -> in_progress -> done", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const taskId = makeTaskId("task-1");
      const agentId = makeAgentId("agent-1");

      await Effect.runPromise(engine.dispatch(makeCreateTaskCommand({ taskId })));

      let model = await Effect.runPromise(engine.getReadModel());
      expect(model.tasks[0].status).toBe("pending");

      await Effect.runPromise(
        engine.dispatch(makeAssignTaskCommand(taskId, { agentId, agentRole: "developer" })),
      );

      model = await Effect.runPromise(engine.getReadModel());
      expect(model.tasks[0].status).toBe("assigned");
      expect(model.tasks[0].owner).toBe(agentId);

      await Effect.runPromise(
        engine.dispatch(makeUpdateStatusCommand(taskId, "in_progress")),
      );

      model = await Effect.runPromise(engine.getReadModel());
      expect(model.tasks[0].status).toBe("in_progress");

      await Effect.runPromise(
        engine.dispatch(makeUpdateStatusCommand(taskId, "done", { output: { result: "success" } })),
      );

      model = await Effect.runPromise(engine.getReadModel());
      expect(model.tasks[0].status).toBe("done");
      expect(model.tasks[0].output).toEqual({ result: "success" });
    });

    test("task failure workflow: create -> assign -> in_progress -> failed", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const taskId = makeTaskId("task-1");

      await Effect.runPromise(engine.dispatch(makeCreateTaskCommand({ taskId })));
      await Effect.runPromise(engine.dispatch(makeAssignTaskCommand(taskId)));
      await Effect.runPromise(
        engine.dispatch(makeUpdateStatusCommand(taskId, "in_progress")),
      );
      await Effect.runPromise(
        engine.dispatch(
          makeUpdateStatusCommand(taskId, "failed", { reason: "Test failed" }),
        ),
      );

      const model = await Effect.runPromise(engine.getReadModel());
      expect(model.tasks[0].status).toBe("failed");
    });
  });

  describe("dependency management", () => {
    test("task created with dependencies starts blocked", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const depTaskId = makeTaskId("dep-task") as TaskId;
      const taskId = makeTaskId("main-task") as TaskId;

      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: depTaskId })),
      );
      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId, deps: [depTaskId] })),
      );

      const model = await Effect.runPromise(engine.getReadModel());
      const mainTask = model.tasks.find((t) => t.id === taskId);
      expect(mainTask?.status).toBe("blocked");
    });

    test("completing dependency unblocks dependent task", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const depTaskId = makeTaskId("dep-task") as TaskId;
      const taskId = makeTaskId("main-task") as TaskId;

      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: depTaskId })),
      );
      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId, deps: [depTaskId] })),
      );

      await Effect.runPromise(
        engine.dispatch(makeAssignTaskCommand(depTaskId)),
      );
      await Effect.runPromise(
        engine.dispatch(makeUpdateStatusCommand(depTaskId, "in_progress")),
      );
      await Effect.runPromise(
        engine.dispatch(makeUpdateStatusCommand(depTaskId, "done")),
      );

      const model = await Effect.runPromise(engine.getReadModel());
      const mainTask = model.tasks.find((t) => t.id === taskId);
      expect(mainTask?.status).toBe("pending");
    });

    test("adding dependency blocks pending task", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;

      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: taskAId })),
      );
      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: taskBId })),
      );

      await Effect.runPromise(
        engine.dispatch(makeAddDependencyCommand(taskAId, taskBId)),
      );

      const model = await Effect.runPromise(engine.getReadModel());
      const taskA = model.tasks.find((t) => t.id === taskAId);
      expect(taskA?.status).toBe("blocked");
      expect(taskA?.deps).toContain(taskBId);
    });

    test("removing dependency unblocks task", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;

      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: taskBId })),
      );
      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: taskAId, deps: [taskBId] })),
      );

      let model = await Effect.runPromise(engine.getReadModel());
      expect(model.tasks.find((t) => t.id === taskAId)?.status).toBe("blocked");

      await Effect.runPromise(
        engine.dispatch(makeRemoveDependencyCommand(taskAId, taskBId)),
      );

      model = await Effect.runPromise(engine.getReadModel());
      const taskA = model.tasks.find((t) => t.id === taskAId);
      expect(taskA?.status).toBe("pending");
      expect(taskA?.deps).toEqual([]);
    });

    test("complex dependency chain: A <- B <- C all unblock in sequence", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const taskAId = makeTaskId("A") as TaskId;
      const taskBId = makeTaskId("B") as TaskId;
      const taskCId = makeTaskId("C") as TaskId;

      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: taskAId })),
      );
      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: taskBId, deps: [taskAId] })),
      );
      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: taskCId, deps: [taskBId] })),
      );

      let model = await Effect.runPromise(engine.getReadModel());
      expect(model.tasks.find((t) => t.id === taskAId)?.status).toBe("pending");
      expect(model.tasks.find((t) => t.id === taskBId)?.status).toBe("blocked");
      expect(model.tasks.find((t) => t.id === taskCId)?.status).toBe("blocked");

      await Effect.runPromise(
        engine.dispatch(makeAssignTaskCommand(taskAId)),
      );
      await Effect.runPromise(
        engine.dispatch(makeUpdateStatusCommand(taskAId, "in_progress")),
      );
      await Effect.runPromise(
        engine.dispatch(makeUpdateStatusCommand(taskAId, "done")),
      );

      model = await Effect.runPromise(engine.getReadModel());
      expect(model.tasks.find((t) => t.id === taskBId)?.status).toBe("pending");
      expect(model.tasks.find((t) => t.id === taskCId)?.status).toBe("blocked");

      await Effect.runPromise(
        engine.dispatch(makeAssignTaskCommand(taskBId)),
      );
      await Effect.runPromise(
        engine.dispatch(makeUpdateStatusCommand(taskBId, "in_progress")),
      );
      await Effect.runPromise(
        engine.dispatch(makeUpdateStatusCommand(taskBId, "done")),
      );

      model = await Effect.runPromise(engine.getReadModel());
      expect(model.tasks.find((t) => t.id === taskCId)?.status).toBe("pending");
    });
  });

  describe("meeting workflows", () => {
    test("schedule meeting and approve tasks", async () => {
      const engine = await Effect.runPromise(createOrchestrationEngine());
      const meetingId = makeMeetingId("mtg-1");
      const task1Id = makeTaskId("task-1");
      const task2Id = makeTaskId("task-2");

      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: task1Id, initialStatus: "proposed" })),
      );
      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: task2Id, initialStatus: "proposed" })),
      );
      await Effect.runPromise(
        engine.dispatch(makeScheduleMeetingCommand({ meetingId })),
      );

      let model = await Effect.runPromise(engine.getReadModel());
      expect(model.meetings).toHaveLength(1);
      expect(model.meetings[0].status).toBe("scheduled");

      await Effect.runPromise(
        engine.dispatch(makeApproveTasksCommand(meetingId, [task1Id], [task2Id])),
      );

      model = await Effect.runPromise(engine.getReadModel());
      expect(model.meetings[0].approvedTaskIds).toContain(task1Id);
      expect(model.meetings[0].rejectedTaskIds).toContain(task2Id);
    });
  });
});

describe("OrchestrationEngine.readEvents", () => {
  test("returns stream of events from given sequence", async () => {
    const engine = await Effect.runPromise(createOrchestrationEngine());

    await Effect.runPromise(
      engine.dispatch(makeCreateTaskCommand({ taskId: makeTaskId("t1") })),
    );
    await Effect.runPromise(
      engine.dispatch(makeCreateTaskCommand({ taskId: makeTaskId("t2") })),
    );
    await Effect.runPromise(
      engine.dispatch(makeCreateTaskCommand({ taskId: makeTaskId("t3") })),
    );

    const stream = engine.readEvents(1);
    const events = await Effect.runPromise(Stream.runCollect(stream));
    const eventsArray = Array.from(events);

    expect(eventsArray).toHaveLength(2);
    expect(eventsArray[0].sequence).toBe(2);
    expect(eventsArray[1].sequence).toBe(3);
  });

  test("returns all events when starting from 0", async () => {
    const engine = await Effect.runPromise(createOrchestrationEngine());

    await Effect.runPromise(
      engine.dispatch(makeCreateTaskCommand({ taskId: makeTaskId("t1") })),
    );
    await Effect.runPromise(
      engine.dispatch(makeCreateTaskCommand({ taskId: makeTaskId("t2") })),
    );

    const stream = engine.readEvents(0);
    const events = await Effect.runPromise(Stream.runCollect(stream));

    expect(Array.from(events)).toHaveLength(2);
  });
});

describe("OrchestrationEngine.replay", () => {
  test("rebuilds read model from event store", async () => {
    const engine = await Effect.runPromise(createOrchestrationEngine());
    const taskId = makeTaskId("task-1");

    await Effect.runPromise(
      engine.dispatch(makeCreateTaskCommand({ taskId })),
    );
    await Effect.runPromise(
      engine.dispatch(makeAssignTaskCommand(taskId)),
    );
    await Effect.runPromise(
      engine.dispatch(makeUpdateStatusCommand(taskId, "in_progress")),
    );

    const rebuiltModel = await Effect.runPromise(engine.replay());

    expect(rebuiltModel.tasks).toHaveLength(1);
    expect(rebuiltModel.tasks[0].status).toBe("in_progress");
    expect(rebuiltModel.snapshotSequence).toBe(3);
  });

  test("replay produces same state as incremental updates", async () => {
    const engine = await Effect.runPromise(createOrchestrationEngine());
    const task1Id = makeTaskId("task-1") as TaskId;
    const task2Id = makeTaskId("task-2") as TaskId;

    await Effect.runPromise(engine.dispatch(makeCreateTaskCommand({ taskId: task1Id })));
    await Effect.runPromise(engine.dispatch(makeCreateTaskCommand({ taskId: task2Id, deps: [task1Id] })));
    await Effect.runPromise(engine.dispatch(makeAssignTaskCommand(task1Id)));
    await Effect.runPromise(engine.dispatch(makeUpdateStatusCommand(task1Id, "in_progress")));
    await Effect.runPromise(engine.dispatch(makeUpdateStatusCommand(task1Id, "done")));

    const currentModel = await Effect.runPromise(engine.getReadModel());
    const rebuiltModel = await Effect.runPromise(engine.replay());

    expect(rebuiltModel.tasks.length).toBe(currentModel.tasks.length);
    expect(rebuiltModel.snapshotSequence).toBe(currentModel.snapshotSequence);

    for (const task of currentModel.tasks) {
      const rebuiltTask = rebuiltModel.tasks.find((t) => t.id === task.id);
      expect(rebuiltTask?.status).toBe(task.status);
      expect(rebuiltTask?.owner).toBe(task.owner);
    }
  });

  test("replay updates engine read model state", async () => {
    const engine = await Effect.runPromise(createOrchestrationEngine());
    const taskId = makeTaskId("task-1");

    await Effect.runPromise(engine.dispatch(makeCreateTaskCommand({ taskId })));

    await Effect.runPromise(engine.replay());

    const model = await Effect.runPromise(engine.getReadModel());
    expect(model.tasks).toHaveLength(1);
    expect(model.tasks[0].id).toBe(taskId);
  });
});

describe("OrchestrationEngine concurrency", () => {
  test("handles sequential dispatches correctly", async () => {
    const engine = await Effect.runPromise(createOrchestrationEngine());

    for (let i = 0; i < 10; i++) {
      await Effect.runPromise(
        engine.dispatch(makeCreateTaskCommand({ taskId: makeTaskId(`task-${i}`) })),
      );
    }

    const model = await Effect.runPromise(engine.getReadModel());
    expect(model.tasks).toHaveLength(10);
    expect(model.snapshotSequence).toBe(10);
  });
});

describe("integration scenarios", () => {
  test("parallel task execution with shared dependency", async () => {
    const engine = await Effect.runPromise(createOrchestrationEngine());
    const rootTaskId = makeTaskId("root") as TaskId;
    const parallelTask1Id = makeTaskId("parallel-1") as TaskId;
    const parallelTask2Id = makeTaskId("parallel-2") as TaskId;
    const finalTaskId = makeTaskId("final") as TaskId;

    await Effect.runPromise(
      engine.dispatch(makeCreateTaskCommand({ taskId: rootTaskId })),
    );
    await Effect.runPromise(
      engine.dispatch(
        makeCreateTaskCommand({ taskId: parallelTask1Id, deps: [rootTaskId] }),
      ),
    );
    await Effect.runPromise(
      engine.dispatch(
        makeCreateTaskCommand({ taskId: parallelTask2Id, deps: [rootTaskId] }),
      ),
    );
    await Effect.runPromise(
      engine.dispatch(
        makeCreateTaskCommand({
          taskId: finalTaskId,
          deps: [parallelTask1Id, parallelTask2Id],
        }),
      ),
    );

    await Effect.runPromise(engine.dispatch(makeAssignTaskCommand(rootTaskId)));
    await Effect.runPromise(
      engine.dispatch(makeUpdateStatusCommand(rootTaskId, "in_progress")),
    );
    await Effect.runPromise(
      engine.dispatch(makeUpdateStatusCommand(rootTaskId, "done")),
    );

    let model = await Effect.runPromise(engine.getReadModel());
    expect(model.tasks.find((t) => t.id === parallelTask1Id)?.status).toBe("pending");
    expect(model.tasks.find((t) => t.id === parallelTask2Id)?.status).toBe("pending");
    expect(model.tasks.find((t) => t.id === finalTaskId)?.status).toBe("blocked");

    await Effect.runPromise(engine.dispatch(makeAssignTaskCommand(parallelTask1Id)));
    await Effect.runPromise(engine.dispatch(makeAssignTaskCommand(parallelTask2Id)));

    await Effect.runPromise(
      engine.dispatch(makeUpdateStatusCommand(parallelTask1Id, "in_progress")),
    );
    await Effect.runPromise(
      engine.dispatch(makeUpdateStatusCommand(parallelTask1Id, "done")),
    );

    model = await Effect.runPromise(engine.getReadModel());
    expect(model.tasks.find((t) => t.id === finalTaskId)?.status).toBe("blocked");

    await Effect.runPromise(
      engine.dispatch(makeUpdateStatusCommand(parallelTask2Id, "in_progress")),
    );
    await Effect.runPromise(
      engine.dispatch(makeUpdateStatusCommand(parallelTask2Id, "done")),
    );

    model = await Effect.runPromise(engine.getReadModel());
    expect(model.tasks.find((t) => t.id === finalTaskId)?.status).toBe("pending");
  });

  test("event sourcing: rebuilding from scratch matches current state", async () => {
    const engine = await Effect.runPromise(createOrchestrationEngine());
    const meetingId = makeMeetingId("mtg-1");
    const task1 = makeTaskId("task-1") as TaskId;
    const task2 = makeTaskId("task-2") as TaskId;
    const proposed1 = makeTaskId("proposed-1") as TaskId;
    const proposed2 = makeTaskId("proposed-2") as TaskId;

    await Effect.runPromise(
      engine.dispatch(makeCreateTaskCommand({ taskId: task1 })),
    );
    await Effect.runPromise(
      engine.dispatch(makeCreateTaskCommand({ taskId: task2, deps: [task1] })),
    );
    await Effect.runPromise(
      engine.dispatch(makeCreateTaskCommand({ taskId: proposed1, initialStatus: "proposed" })),
    );
    await Effect.runPromise(
      engine.dispatch(makeCreateTaskCommand({ taskId: proposed2, initialStatus: "proposed" })),
    );
    await Effect.runPromise(
      engine.dispatch(makeScheduleMeetingCommand({ meetingId })),
    );
    await Effect.runPromise(
      engine.dispatch(makeAssignTaskCommand(task1)),
    );
    await Effect.runPromise(
      engine.dispatch(makeUpdateStatusCommand(task1, "in_progress")),
    );
    await Effect.runPromise(
      engine.dispatch(makeUpdateStatusCommand(task1, "done")),
    );
    await Effect.runPromise(
      engine.dispatch(makeApproveTasksCommand(meetingId, [proposed1], [proposed2])),
    );

    const currentModel = await Effect.runPromise(engine.getReadModel());
    const replayedModel = await Effect.runPromise(engine.replay());

    expect(replayedModel.snapshotSequence).toBe(currentModel.snapshotSequence);
    expect(replayedModel.tasks.length).toBe(currentModel.tasks.length);
    expect(replayedModel.meetings.length).toBe(currentModel.meetings.length);

    const replayedTask1 = replayedModel.tasks.find((t) => t.id === task1);
    const currentTask1 = currentModel.tasks.find((t) => t.id === task1);
    expect(replayedTask1?.status).toBe(currentTask1?.status);
    expect(replayedTask1?.output).toEqual(currentTask1?.output);
  });
});
