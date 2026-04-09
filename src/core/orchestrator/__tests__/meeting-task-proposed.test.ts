import { describe, test, expect, beforeEach } from "bun:test";
import { Effect } from "effect";

import { decideOrchestrationCommand } from "../decider";
import { createInMemoryEventStore } from "../event-store";
import { createMeetingTaskProposalStore } from "@/core/memory/meeting-task-proposal-store";
import type {
  OrchestrationEvent,
  MeetingProposedTask,
  MeetingTaskProposedPayload,
} from "@/shared/types/orchestration";
import type { EventId, MeetingId, ProposalId } from "@/shared/types/base-schemas";
import {
  resetCounters,
  makeEmptyReadModel,
  makeMeeting,
  makeReadModelWithTasks,
  makeMeetingId,
  makeCommandId,
  makeIsoDate,
  makeEventId,
} from "@/test-utils/factories";

type EventWithoutSequence = Omit<OrchestrationEvent, "sequence">;
type DeciderResult = EventWithoutSequence | ReadonlyArray<EventWithoutSequence>;

function toArray(result: DeciderResult): EventWithoutSequence[] {
  return (Array.isArray(result) ? result : [result]) as EventWithoutSequence[];
}

function makeProposedTask(overrides: Partial<MeetingProposedTask> = {}): MeetingProposedTask {
  return {
    taskType: "implementation",
    title: "Implement feature X" as MeetingProposedTask["title"],
    description: "Build out the feature",
    deps: [],
    input: {},
    ...overrides,
  };
}

function makeMeetingCompleteCommand(
  meetingId: MeetingId,
  proposedTasks: MeetingProposedTask[] = [],
) {
  return {
    type: "meeting.complete" as const,
    schemaVersion: 1 as const,
    commandId: makeCommandId(),
    meetingId,
    summary: "Meeting complete",
    proposedTasks,
    createdAt: makeIsoDate(),
  };
}

function makeMeetingProposeTaskCommand(
  meetingId: MeetingId,
  overrides: {
    proposalId?: ProposalId;
    agendaItemIndex?: number;
    proposedTask?: MeetingProposedTask;
    originatingAgentRole?: "pm" | "developer" | "reviewer" | "tester";
    requiresApproval?: boolean;
  } = {},
) {
  return {
    type: "meeting.propose-task" as const,
    schemaVersion: 1 as const,
    commandId: makeCommandId(),
    meetingId,
    proposalId: (overrides.proposalId ?? crypto.randomUUID()) as ProposalId,
    agendaItemIndex: overrides.agendaItemIndex ?? 0,
    proposedTask: overrides.proposedTask ?? makeProposedTask(),
    originatingAgentRole: overrides.originatingAgentRole ?? ("pm" as const),
    requiresApproval: overrides.requiresApproval ?? true,
    createdAt: makeIsoDate(),
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
    payload: {
      proposalId,
      meetingId,
      agendaItemIndex: 0,
      proposedTask: makeProposedTask(),
      originatingAgentRole: "pm" as const,
      requiresApproval: true,
      proposedAt: now,
    } satisfies MeetingTaskProposedPayload,
  };
}

beforeEach(() => {
  resetCounters();
});

describe("meeting.task-proposed — decider", () => {
  describe("meeting.complete emits per-proposal events", () => {
    test("emits N meeting.task-proposed events followed by one meeting.completed", async () => {
      const meetingId = makeMeetingId("complete-mtg");
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const readModel = makeReadModelWithTasks([], [meeting]);

      const command = makeMeetingCompleteCommand(meetingId, [
        makeProposedTask({ title: "Task A" as MeetingProposedTask["title"] }),
        makeProposedTask({ title: "Task B" as MeetingProposedTask["title"] }),
      ]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      expect(events).toHaveLength(3);

      const proposalEvents = events.filter((e) => e.type === "meeting.task-proposed");
      const completedEvents = events.filter((e) => e.type === "meeting.completed");

      expect(proposalEvents).toHaveLength(2);
      expect(completedEvents).toHaveLength(1);
    });

    test("meeting.task-proposed events appear before meeting.completed in the batch", async () => {
      const meetingId = makeMeetingId("order-mtg");
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const readModel = makeReadModelWithTasks([], [meeting]);

      const command = makeMeetingCompleteCommand(meetingId, [makeProposedTask()]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      expect(events[0]?.type).toBe("meeting.task-proposed");
      expect(events[events.length - 1]?.type).toBe("meeting.completed");
    });

    test("each meeting.task-proposed payload carries correct fields", async () => {
      const meetingId = makeMeetingId("payload-mtg");
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const readModel = makeReadModelWithTasks([], [meeting]);
      const task = makeProposedTask({ title: "Do the thing" as MeetingProposedTask["title"] });

      const command = makeMeetingCompleteCommand(meetingId, [task]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      const proposalEvent = events.find((e) => e.type === "meeting.task-proposed");

      expect(proposalEvent).toBeDefined();
      if (proposalEvent?.type === "meeting.task-proposed") {
        const p = proposalEvent.payload as MeetingTaskProposedPayload;
        expect(p.meetingId).toBe(meetingId);
        expect(p.requiresApproval).toBe(true);
        expect(p.originatingAgentRole).toBe("pm");
        expect(p.proposedTask.title).toBe("Do the thing");
        expect(typeof p.proposalId).toBe("string");
        expect(p.proposalId.length).toBeGreaterThan(0);
      }
    });

    test("emits zero meeting.task-proposed events when proposedTasks is empty", async () => {
      const meetingId = makeMeetingId("empty-mtg");
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const readModel = makeReadModelWithTasks([], [meeting]);

      const command = makeMeetingCompleteCommand(meetingId, []);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("meeting.completed");
    });

    test("each proposal in a batch receives a unique proposalId", async () => {
      const meetingId = makeMeetingId("unique-ids-mtg");
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const readModel = makeReadModelWithTasks([], [meeting]);

      const command = makeMeetingCompleteCommand(meetingId, [
        makeProposedTask({ title: "Alpha" as MeetingProposedTask["title"] }),
        makeProposedTask({ title: "Beta" as MeetingProposedTask["title"] }),
        makeProposedTask({ title: "Gamma" as MeetingProposedTask["title"] }),
      ]);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      const proposalIds = events
        .filter((e) => e.type === "meeting.task-proposed")
        .map((e) => (e.payload as MeetingTaskProposedPayload).proposalId);

      const uniqueIds = new Set(proposalIds);
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe("meeting.propose-task standalone command", () => {
    test("emits meeting.task-proposed for an in-progress meeting", async () => {
      const meetingId = makeMeetingId("standalone-mtg");
      const meeting = makeMeeting({ id: meetingId, status: "in_progress" });
      const readModel = makeReadModelWithTasks([], [meeting]);

      const proposalId = crypto.randomUUID() as ProposalId;
      const command = makeMeetingProposeTaskCommand(meetingId, {
        proposalId,
        agendaItemIndex: 2,
        originatingAgentRole: "developer",
        requiresApproval: false,
      });

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("meeting.task-proposed");

      if (events[0]?.type === "meeting.task-proposed") {
        const p = events[0].payload as MeetingTaskProposedPayload;
        expect(p.proposalId).toBe(proposalId);
        expect(p.meetingId).toBe(meetingId);
        expect(p.agendaItemIndex).toBe(2);
        expect(p.originatingAgentRole).toBe("developer");
        expect(p.requiresApproval).toBe(false);
      }
    });

    test("emits meeting.task-proposed for a scheduled meeting (not just in_progress)", async () => {
      const meetingId = makeMeetingId("scheduled-mtg");
      const meeting = makeMeeting({ id: meetingId, status: "scheduled" });
      const readModel = makeReadModelWithTasks([], [meeting]);

      const command = makeMeetingProposeTaskCommand(meetingId);

      const result = await Effect.runPromise(
        decideOrchestrationCommand({ command, readModel }),
      );

      const events = toArray(result);
      expect(events[0]?.type).toBe("meeting.task-proposed");
    });

    test("fails when the meeting does not exist", async () => {
      const meetingId = makeMeetingId("ghost-mtg");
      const readModel = makeEmptyReadModel();

      const command = makeMeetingProposeTaskCommand(meetingId);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(exit._tag).toBe("Failure");
    });

    test("fails when the meeting is already completed", async () => {
      const meetingId = makeMeetingId("completed-mtg");
      const meeting = makeMeeting({ id: meetingId, status: "completed" });
      const readModel = makeReadModelWithTasks([], [meeting]);

      const command = makeMeetingProposeTaskCommand(meetingId);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(exit._tag).toBe("Failure");
    });

    test("fails when the meeting is cancelled", async () => {
      const meetingId = makeMeetingId("cancelled-mtg");
      const meeting = makeMeeting({ id: meetingId, status: "cancelled" });
      const readModel = makeReadModelWithTasks([], [meeting]);

      const command = makeMeetingProposeTaskCommand(meetingId);

      const exit = await Effect.runPromiseExit(
        decideOrchestrationCommand({ command, readModel }),
      );

      expect(exit._tag).toBe("Failure");
    });
  });
});

describe("MeetingTaskProposalStore", () => {
  test("rebuild() indexes all meeting.task-proposed events idempotently", async () => {
    const store = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const proposalStore = yield* createMeetingTaskProposalStore({ eventStore });

        const meetingId = makeMeetingId("rebuild-mtg") as MeetingId;
        const proposalId = crypto.randomUUID() as ProposalId;
        const now = makeIsoDate();

        yield* eventStore.append(makeProposalEventBody(meetingId, proposalId, now));

        // rebuild twice to verify idempotency
        yield* proposalStore.rebuild();
        yield* proposalStore.rebuild();

        return proposalStore;
      }),
    );

    const pending = await Effect.runPromise(store.getPendingApproval());
    expect(pending).toHaveLength(1);
  });

  test("getByMeeting returns only proposals for the given meeting", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const proposalStore = yield* createMeetingTaskProposalStore({ eventStore });

        const meetingA = makeMeetingId("mtg-A") as MeetingId;
        const meetingB = makeMeetingId("mtg-B") as MeetingId;
        const now = makeIsoDate();

        yield* eventStore.append(
          makeProposalEventBody(meetingA, crypto.randomUUID() as ProposalId, now),
        );
        yield* eventStore.append(
          makeProposalEventBody(meetingA, crypto.randomUUID() as ProposalId, now),
        );
        yield* eventStore.append(
          makeProposalEventBody(meetingB, crypto.randomUUID() as ProposalId, now),
        );

        yield* proposalStore.rebuild();

        return {
          forA: yield* proposalStore.getByMeeting(meetingA),
          forB: yield* proposalStore.getByMeeting(meetingB),
        };
      }),
    );

    expect(result.forA).toHaveLength(2);
    expect(result.forB).toHaveLength(1);
  });

  test("markResolved removes proposal from getPendingApproval and is idempotent", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const proposalStore = yield* createMeetingTaskProposalStore({ eventStore });

        const meetingId = makeMeetingId("resolve-mtg") as MeetingId;
        const proposalId = crypto.randomUUID() as ProposalId;
        const now = makeIsoDate();

        yield* eventStore.append(makeProposalEventBody(meetingId, proposalId, now));
        yield* proposalStore.rebuild();

        const beforeResolve = yield* proposalStore.getPendingApproval();

        yield* proposalStore.markResolved(proposalId, "task-abc-123");
        // second call with different taskId must be a no-op (idempotent)
        yield* proposalStore.markResolved(proposalId, "task-different");

        const afterResolve = yield* proposalStore.getPendingApproval();
        const byId = yield* proposalStore.getById(proposalId);

        return { beforeResolve, afterResolve, byId };
      }),
    );

    expect(result.beforeResolve).toHaveLength(1);
    expect(result.afterResolve).toHaveLength(0);
    // first call wins — second call is a no-op
    expect(result.byId?.resolvedTaskId).toBe("task-abc-123");
  });

  test("getById returns null for unknown proposalId", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const proposalStore = yield* createMeetingTaskProposalStore({ eventStore });
        return yield* proposalStore.getById("nonexistent" as ProposalId);
      }),
    );

    expect(result).toBeNull();
  });
});
