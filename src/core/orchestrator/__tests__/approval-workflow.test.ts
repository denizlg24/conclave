/**
 * Integration tests for the meeting-proposal → approval workflow.
 *
 * These tests exercise engine + proposal store together — simulating what the
 * orchestrator reactor does (creating proposed tasks from meeting proposals)
 * without needing a live bus or agent service.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { Effect } from "effect";

import { createOrchestrationEngine, type OrchestrationEngineShape } from "../engine";
import { createInMemoryEventStore } from "../event-store";
import { createMeetingTaskProposalStore } from "@/core/memory/meeting-task-proposal-store";
import type {
  MeetingProposedTask,
  MeetingTaskProposedPayload,
} from "@/shared/types/orchestration";
import type { CommandId, EventId, MeetingId, ProposalId, TaskId } from "@/shared/types/base-schemas";
import {
  resetCounters,
  makeMeetingId,
  makeCommandId,
  makeIsoDate,
  makeEventId,
} from "@/test-utils/factories";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

function makeProposalPayload(
  meetingId: MeetingId,
  proposalId: ProposalId,
  now: string,
  overrides: Partial<MeetingTaskProposedPayload> = {},
): MeetingTaskProposedPayload {
  return {
    proposalId,
    meetingId,
    agendaItemIndex: 0,
    proposedTask: makeProposedTask(),
    originatingAgentRole: "pm" as const,
    requiresApproval: true,
    proposedAt: now,
    ...overrides,
  };
}

function makeProposalEventBody(meetingId: MeetingId, proposalId: ProposalId, now: string) {
  return {
    type: "meeting.task-proposed" as const,
    schemaVersion: 1 as const,
    eventId: makeEventId() as unknown as EventId,
    aggregateKind: "meeting" as const,
    aggregateId: meetingId,
    occurredAt: now,
    commandId: makeCommandId(),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: makeProposalPayload(meetingId, proposalId, now),
  };
}

/**
 * Simulate what the orchestrator reactor does on meeting.completed:
 * create a DAG task in "proposed" status for each proposal, resolving
 * numeric index deps to concrete task IDs.
 */
function createProposedTasksFromProposals(
  engine: OrchestrationEngineShape,
  proposals: ReadonlyArray<MeetingTaskProposedPayload>,
  occurredAt: string,
): Effect.Effect<ReadonlyArray<TaskId>> {
  return Effect.gen(function* () {
    const indexToTaskId: TaskId[] = proposals.map(() => crypto.randomUUID() as TaskId);
    const created: TaskId[] = [];

    for (let i = 0; i < proposals.length; i++) {
      const proposal = proposals[i]!;
      const taskId = indexToTaskId[i]!;

      const currentModel = yield* engine.getReadModel();
      if (currentModel.tasks.some((t) => t.id === taskId)) continue;

      const resolvedDeps: TaskId[] = [];
      for (const dep of proposal.proposedTask.deps) {
        if (typeof dep === "number") {
          const depId = indexToTaskId[dep];
          if (depId !== undefined && currentModel.tasks.some((t) => t.id === depId)) {
            resolvedDeps.push(depId);
          }
        } else {
          resolvedDeps.push(dep as TaskId);
        }
      }

      yield* engine.dispatch({
        type: "task.create",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId,
        taskType: proposal.proposedTask.taskType,
        title: proposal.proposedTask.title,
        description: proposal.proposedTask.description,
        deps: resolvedDeps,
        input: { proposalId: proposal.proposalId },
        initialStatus: "proposed" as const,
        createdAt: occurredAt,
      }).pipe(
        Effect.catch((_err: unknown) => Effect.void),
      );

      created.push(taskId);
    }

    return created;
  });
}

beforeEach(() => {
  resetCounters();
});

// ---------------------------------------------------------------------------
// Proposal store — ingest
// ---------------------------------------------------------------------------

describe("MeetingTaskProposalStore.ingest", () => {
  test("live ingest adds proposal to pending queue", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });

        const meetingId = makeMeetingId("live-mtg") as MeetingId;
        const proposalId = crypto.randomUUID() as ProposalId;
        const now = makeIsoDate();

        yield* store.ingest(makeProposalPayload(meetingId, proposalId, now));

        return yield* store.getPendingApproval();
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.requiresApproval).toBe(true);
    expect(result[0]?.resolvedTaskId).toBeNull();
  });

  test("ingest is idempotent — calling twice with same proposalId is a no-op", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });

        const meetingId = makeMeetingId("idem-mtg") as MeetingId;
        const proposalId = crypto.randomUUID() as ProposalId;
        const now = makeIsoDate();
        const payload = makeProposalPayload(meetingId, proposalId, now);

        yield* store.ingest(payload);
        yield* store.ingest(payload);

        return yield* store.getPendingApproval();
      }),
    );

    expect(result).toHaveLength(1);
  });

  test("rebuild and ingest produce identical state for the same proposal", async () => {
    const meetingId = makeMeetingId("rebuild-vs-ingest") as MeetingId;
    const proposalId = crypto.randomUUID() as ProposalId;
    const now = makeIsoDate();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        yield* eventStore.append(makeProposalEventBody(meetingId, proposalId, now));

        // Store A: use rebuild()
        const storeA = yield* createMeetingTaskProposalStore({ eventStore });
        yield* storeA.rebuild();

        // Store B: use ingest()
        const storeB = yield* createMeetingTaskProposalStore({ eventStore });
        yield* storeB.ingest(makeProposalPayload(meetingId, proposalId, now));

        return {
          a: yield* storeA.getPendingApproval(),
          b: yield* storeB.getPendingApproval(),
        };
      }),
    );

    expect(result.a).toHaveLength(1);
    expect(result.b).toHaveLength(1);
    expect(result.a[0]?.proposalId).toBe(result.b[0]?.proposalId);
  });
});

// ---------------------------------------------------------------------------
// Proposed task creation
// ---------------------------------------------------------------------------

describe("proposed task creation from meeting proposals", () => {
  test("creates DAG tasks in 'proposed' status, one per proposal", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const engine = yield* createOrchestrationEngine({ eventStore });

        const meetingId = makeMeetingId("create-mtg") as MeetingId;
        const now = makeIsoDate();

        const proposals = [
          makeProposalPayload(meetingId, crypto.randomUUID() as ProposalId, now, {
            proposedTask: makeProposedTask({ title: "Task A" as MeetingProposedTask["title"] }),
          }),
          makeProposalPayload(meetingId, crypto.randomUUID() as ProposalId, now, {
            proposedTask: makeProposedTask({ title: "Task B" as MeetingProposedTask["title"] }),
          }),
        ];

        yield* createProposedTasksFromProposals(engine, proposals, now);

        return yield* engine.getReadModel();
      }),
    );

    const proposedTasks = result.tasks.filter((t) => t.status === "proposed");
    expect(proposedTasks).toHaveLength(2);
    expect(proposedTasks.every((t) => t.taskType === "implementation")).toBe(true);
  });

  test("each created task embeds proposalId in its input", async () => {
    const proposalId = crypto.randomUUID() as ProposalId;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const engine = yield* createOrchestrationEngine({ eventStore });

        const meetingId = makeMeetingId("input-mtg") as MeetingId;
        const now = makeIsoDate();
        const proposals = [makeProposalPayload(meetingId, proposalId, now)];

        yield* createProposedTasksFromProposals(engine, proposals, now);

        return yield* engine.getReadModel();
      }),
    );

    const task = result.tasks[0];
    expect(task?.status).toBe("proposed");
    expect((task?.input as Record<string, unknown>)?.["proposalId"]).toBe(proposalId);
  });

  test("index-based dep: task 1 depending on task 0 is resolved to task 0's DAG id", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const engine = yield* createOrchestrationEngine({ eventStore });

        const meetingId = makeMeetingId("dep-mtg") as MeetingId;
        const now = makeIsoDate();

        const proposals = [
          makeProposalPayload(meetingId, crypto.randomUUID() as ProposalId, now, {
            proposedTask: makeProposedTask({ title: "First" as MeetingProposedTask["title"] }),
          }),
          makeProposalPayload(meetingId, crypto.randomUUID() as ProposalId, now, {
            proposedTask: makeProposedTask({
              title: "Second" as MeetingProposedTask["title"],
              deps: [0],
            }),
          }),
        ];

        yield* createProposedTasksFromProposals(engine, proposals, now);

        return yield* engine.getReadModel();
      }),
    );

    const [first, second] = result.tasks;
    expect(first?.status).toBe("proposed");
    expect(second?.status).toBe("proposed");
    expect(second?.deps).toContain(first?.id);
  });

  test("creating a task with the same id twice is a no-op (idempotency guard)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const engine = yield* createOrchestrationEngine({ eventStore });

        const proposalId = crypto.randomUUID() as ProposalId;
        const taskId = crypto.randomUUID() as TaskId;
        const now = makeIsoDate();

        const createCmd = {
          type: "task.create" as const,
          schemaVersion: 1 as const,
          commandId: crypto.randomUUID() as CommandId,
          taskId,
          taskType: "implementation" as const,
          title: "Idempotent task" as MeetingProposedTask["title"],
          description: "Test",
          deps: [] as TaskId[],
          input: { proposalId },
          initialStatus: "proposed" as const,
          createdAt: now,
        };

        yield* engine.dispatch(createCmd);
        // Second dispatch with same taskId must fail — the catch swallows it
        yield* engine.dispatch(createCmd).pipe(Effect.catch((_: unknown) => Effect.void));

        return yield* engine.getReadModel();
      }),
    );

    expect(result.tasks.filter((t) => t.status === "proposed")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Approval flow — status transitions
// ---------------------------------------------------------------------------

describe("approval workflow — status transitions", () => {
  test("approving a proposed task via meeting.approve-tasks → task becomes pending", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const engine = yield* createOrchestrationEngine({ eventStore });

        const meetingId = makeMeetingId("approve-mtg") as MeetingId;
        const taskId = crypto.randomUUID() as TaskId;
        const now = makeIsoDate();

        yield* engine.dispatch({ type: "meeting.schedule", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, meetingType: "planning", agenda: ["Do stuff" as MeetingProposedTask["title"]], participants: ["pm"], createdAt: now });
        yield* engine.dispatch({ type: "meeting.start", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, createdAt: now });

        yield* engine.dispatch({ type: "task.create", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, taskId, taskType: "implementation", title: "Feature X" as MeetingProposedTask["title"], description: "Do it", deps: [], input: { proposalId: crypto.randomUUID() as ProposalId }, initialStatus: "proposed" as const, createdAt: now });

        yield* engine.dispatch({ type: "meeting.approve-tasks", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, approvedTaskIds: [taskId], rejectedTaskIds: [], createdAt: now });

        return yield* engine.getReadModel();
      }),
    );

    const task = result.tasks.find((t) => t.id);
    expect(task?.status).toBe("pending");
  });

  test("rejecting a proposed task → task transitions to rejected", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const engine = yield* createOrchestrationEngine({ eventStore });

        const meetingId = makeMeetingId("reject-mtg") as MeetingId;
        const taskId = crypto.randomUUID() as TaskId;
        const now = makeIsoDate();

        yield* engine.dispatch({ type: "meeting.schedule", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, meetingType: "planning", agenda: ["Do stuff" as MeetingProposedTask["title"]], participants: ["pm"], createdAt: now });
        yield* engine.dispatch({ type: "meeting.start", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, createdAt: now });

        yield* engine.dispatch({ type: "task.create", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, taskId, taskType: "implementation", title: "Rejected feature" as MeetingProposedTask["title"], description: "Will be rejected", deps: [], input: { proposalId: crypto.randomUUID() as ProposalId }, initialStatus: "proposed" as const, createdAt: now });

        yield* engine.dispatch({ type: "meeting.approve-tasks", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, approvedTaskIds: [], rejectedTaskIds: [taskId], createdAt: now });

        return yield* engine.getReadModel();
      }),
    );

    expect(result.tasks[0]?.status).toBe("rejected");
  });

  test("approved task with an incomplete dep becomes blocked, not pending", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const engine = yield* createOrchestrationEngine({ eventStore });

        const meetingId = makeMeetingId("blocked-mtg") as MeetingId;
        const depTaskId = crypto.randomUUID() as TaskId;
        const reviewTaskId = crypto.randomUUID() as TaskId;
        const now = makeIsoDate();

        yield* engine.dispatch({ type: "meeting.schedule", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, meetingType: "planning", agenda: ["Do stuff" as MeetingProposedTask["title"]], participants: ["pm"], createdAt: now });
        yield* engine.dispatch({ type: "meeting.start", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, createdAt: now });

        yield* engine.dispatch({ type: "task.create", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, taskId: depTaskId, taskType: "implementation", title: "Dep task" as MeetingProposedTask["title"], description: "", deps: [], input: { proposalId: crypto.randomUUID() as ProposalId }, initialStatus: "proposed" as const, createdAt: now });
        yield* engine.dispatch({ type: "task.create", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, taskId: reviewTaskId, taskType: "review", title: "Review task" as MeetingProposedTask["title"], description: "", deps: [depTaskId], input: { proposalId: crypto.randomUUID() as ProposalId }, initialStatus: "proposed" as const, createdAt: now });

        yield* engine.dispatch({ type: "meeting.approve-tasks", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, approvedTaskIds: [depTaskId, reviewTaskId], rejectedTaskIds: [], createdAt: now });

        return yield* engine.getReadModel();
      }),
    );

    const dep = result.tasks.find((t) => t.id === result.tasks[0]?.id)!;
    const review = result.tasks.find((t) => t.deps.length > 0)!;

    expect(dep.status).toBe("pending");
    expect(review.status).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// markResolved and proposal-store interaction
// ---------------------------------------------------------------------------

describe("proposal store — markResolved after approval", () => {
  test("marking all decided proposals resolved empties the approval queue", async () => {
    const meetingId = makeMeetingId("resolve-mtg") as MeetingId;
    const now = makeIsoDate();
    const proposalId = crypto.randomUUID() as ProposalId;
    const taskId = crypto.randomUUID() as TaskId;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const engine = yield* createOrchestrationEngine({ eventStore });
        const store = yield* createMeetingTaskProposalStore({ eventStore });

        yield* store.ingest(makeProposalPayload(meetingId, proposalId, now));

        yield* engine.dispatch({ type: "meeting.schedule", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, meetingType: "planning", agenda: ["Do stuff" as MeetingProposedTask["title"]], participants: ["pm"], createdAt: now });
        yield* engine.dispatch({ type: "meeting.start", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, createdAt: now });
        yield* engine.dispatch({ type: "task.create", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, taskId, taskType: "implementation", title: "Task" as MeetingProposedTask["title"], description: "", deps: [], input: { proposalId }, initialStatus: "proposed" as const, createdAt: now });
        yield* engine.dispatch({ type: "meeting.approve-tasks", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, approvedTaskIds: [taskId], rejectedTaskIds: [], createdAt: now });

        // Simulate what approveProposedTasks does in conclave.ts
        yield* store.markResolved(proposalId, taskId);

        return yield* store.getPendingApproval();
      }),
    );

    expect(result).toHaveLength(0);
  });

  test("startup hydration: proposals already decided are not shown as pending", async () => {
    const meetingId = makeMeetingId("hydrate-mtg") as MeetingId;
    const proposalId = crypto.randomUUID() as ProposalId;
    const taskId = crypto.randomUUID() as TaskId;
    const now = makeIsoDate();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const engine = yield* createOrchestrationEngine({ eventStore });
        const store = yield* createMeetingTaskProposalStore({ eventStore });

        yield* eventStore.append(makeProposalEventBody(meetingId, proposalId, now));
        yield* store.rebuild();

        // Simulate a previously approved task in the DAG
        yield* engine.dispatch({ type: "meeting.schedule", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, meetingType: "planning", agenda: ["Do stuff" as MeetingProposedTask["title"]], participants: ["pm"], createdAt: now });
        yield* engine.dispatch({ type: "meeting.start", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, createdAt: now });
        yield* engine.dispatch({ type: "task.create", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, taskId, taskType: "implementation", title: "Previously approved" as MeetingProposedTask["title"], description: "", deps: [], input: { proposalId }, initialStatus: "proposed" as const, createdAt: now });
        yield* engine.dispatch({ type: "meeting.approve-tasks", schemaVersion: 1, commandId: crypto.randomUUID() as CommandId, meetingId, approvedTaskIds: [taskId], rejectedTaskIds: [], createdAt: now });

        // Startup hydration pass (mirrors bootstrapConclave logic)
        const readModel = yield* engine.getReadModel();
        for (const task of readModel.tasks) {
          const inp = task.input as Record<string, unknown> | null;
          if (
            inp !== null &&
            typeof inp === "object" &&
            typeof inp["proposalId"] === "string" &&
            task.status !== "proposed"
          ) {
            yield* store.markResolved(inp["proposalId"] as ProposalId, task.id);
          }
        }

        return yield* store.getPendingApproval();
      }),
    );

    expect(result).toHaveLength(0);
  });
});
