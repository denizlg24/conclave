import { beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";

import { createOrchestrationEngine } from "../../orchestrator/engine";
import { createInMemoryEventStore } from "../../orchestrator/event-store";
import {
  materializeProposalTasksForMeeting,
  rejectLegacyDuplicateProposedTasks,
} from "../proposal-task-materializer";
import type { MeetingProposedTask } from "@/shared/types/orchestration";
import type { CommandId, MeetingId, ProposalId, TaskId } from "@/shared/types/base-schemas";
import {
  makeCommandId,
  makeIsoDate,
  makeMeetingId,
  resetCounters,
} from "@/test-utils/factories";

function makeProposedTask(overrides: Partial<MeetingProposedTask> = {}): MeetingProposedTask {
  return {
    taskType: "implementation",
    title: "Implement feature" as MeetingProposedTask["title"],
    description: "Build the feature",
    deps: [],
    input: {},
    ...overrides,
  };
}

beforeEach(() => {
  resetCounters();
});

describe("proposal-task-materializer", () => {
  test("materializes each proposal at most once per meeting", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const engine = yield* createOrchestrationEngine({ eventStore });
        const meetingId = makeMeetingId("materialize") as MeetingId;
        const occurredAt = makeIsoDate();
        const proposals = [
          {
            proposalId: crypto.randomUUID() as ProposalId,
            proposedTask: makeProposedTask({
              title: "Task A" as MeetingProposedTask["title"],
            }),
          },
          {
            proposalId: crypto.randomUUID() as ProposalId,
            proposedTask: makeProposedTask({
              title: "Task B" as MeetingProposedTask["title"],
              deps: [0],
            }),
          },
        ];

        yield* materializeProposalTasksForMeeting({
          engine,
          meetingId,
          proposals,
          occurredAt,
          logPrefix: "[test]",
        });
        yield* materializeProposalTasksForMeeting({
          engine,
          meetingId,
          proposals,
          occurredAt,
          logPrefix: "[test]",
        });

        return yield* engine.getReadModel();
      }),
    );

    const proposedTasks = result.tasks.filter((task) => task.status === "proposed");
    expect(proposedTasks).toHaveLength(2);
    expect(proposedTasks[1]?.deps).toContain(proposedTasks[0]?.id);
  });

  test("rejects legacy meeting-backed duplicates when proposal-backed tasks exist", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const engine = yield* createOrchestrationEngine({ eventStore });
        const meetingId = makeMeetingId("dedupe") as MeetingId;
        const occurredAt = makeIsoDate();
        const proposalId = crypto.randomUUID() as ProposalId;
        const canonicalTaskId = crypto.randomUUID() as TaskId;
        const legacyTaskId = crypto.randomUUID() as TaskId;

        yield* engine.dispatch({
          type: "task.create",
          schemaVersion: 1 as const,
          commandId: makeCommandId() as CommandId,
          taskId: canonicalTaskId,
          taskType: "implementation",
          title: "Implement queue fix" as MeetingProposedTask["title"],
          description: "Canonical proposal-backed task",
          deps: [],
          input: {
            proposalId,
            proposedByMeeting: meetingId,
          },
          initialStatus: "proposed" as const,
          createdAt: occurredAt,
        });

        yield* engine.dispatch({
          type: "task.create",
          schemaVersion: 1 as const,
          commandId: makeCommandId() as CommandId,
          taskId: legacyTaskId,
          taskType: "implementation",
          title: "Implement queue fix" as MeetingProposedTask["title"],
          description: "Legacy duplicate",
          deps: [],
          input: {
            proposedByMeeting: meetingId,
          },
          initialStatus: "proposed" as const,
          createdAt: occurredAt,
        });

        yield* rejectLegacyDuplicateProposedTasks({
          engine,
          occurredAt,
          logPrefix: "[test]",
        });

        return yield* engine.getReadModel();
      }),
    );

    const canonical = result.tasks.find(
      (task) => (task.input as Record<string, unknown>)?.proposalId !== undefined,
    );
    const legacy = result.tasks.find(
      (task) =>
        (task.input as Record<string, unknown>)?.proposalId === undefined &&
        (task.input as Record<string, unknown>)?.proposedByMeeting !== undefined,
    );

    expect(canonical?.status).toBe("proposed");
    expect(legacy?.status).toBe("rejected");
  });
});
