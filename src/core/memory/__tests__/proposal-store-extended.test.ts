/**
 * Extended unit tests for MeetingTaskProposalStore covering methods not exercised
 * by approval-workflow.test.ts: getById, getByMeeting, requiresApproval:false
 * filtering, markResolved idempotency, and multi-meeting isolation.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { Effect } from "effect";

import { createMeetingTaskProposalStore } from "@/core/memory/meeting-task-proposal-store";
import { createInMemoryEventStore } from "@/core/orchestrator/event-store";
import { resetCounters, makeMeetingId, makeIsoDate } from "@/test-utils/factories";
import type { MeetingTaskProposedPayload } from "@/shared/types/orchestration";
import type { MeetingId, ProposalId } from "@/shared/types/base-schemas";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeProposalPayload(
  meetingId: MeetingId,
  proposalId: ProposalId,
  overrides: Partial<MeetingTaskProposedPayload> = {},
): MeetingTaskProposedPayload {
  return {
    proposalId,
    meetingId,
    agendaItemIndex: 0,
    proposedTask: {
      taskType: "implementation",
      title: "Test proposal" as MeetingTaskProposedPayload["proposedTask"]["title"],
      description: "A test proposal",
      deps: [],
      input: {},
    },
    originatingAgentRole: "pm" as const,
    requiresApproval: true,
    proposedAt: makeIsoDate(),
    ...overrides,
  };
}

beforeEach(() => {
  resetCounters();
});

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

describe("MeetingTaskProposalStore.getById", () => {
  test("returns the proposal matching the given proposalId", async () => {
    const proposalId = crypto.randomUUID() as ProposalId;
    const meetingId = makeMeetingId("getbyid");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(makeProposalPayload(meetingId, proposalId));
        return yield* store.getById(proposalId);
      }),
    );

    expect(result).not.toBeNull();
    expect(result?.proposalId).toBe(proposalId);
    expect(result?.meetingId).toBe(meetingId);
  });

  test("returns null when no proposal with that id has been ingested", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        return yield* store.getById(crypto.randomUUID() as ProposalId);
      }),
    );

    expect(result).toBeNull();
  });

  test("resolvedTaskId is null before markResolved is called", async () => {
    const proposalId = crypto.randomUUID() as ProposalId;
    const meetingId = makeMeetingId("pre-resolved");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(makeProposalPayload(meetingId, proposalId));
        return yield* store.getById(proposalId);
      }),
    );

    expect(result?.resolvedTaskId).toBeNull();
  });

  test("resolvedTaskId reflects the taskId passed to markResolved", async () => {
    const proposalId = crypto.randomUUID() as ProposalId;
    const taskId = crypto.randomUUID();
    const meetingId = makeMeetingId("post-resolved");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(makeProposalPayload(meetingId, proposalId));
        yield* store.markResolved(proposalId, taskId);
        return yield* store.getById(proposalId);
      }),
    );

    expect(result?.resolvedTaskId).toBe(taskId);
  });
});

// ---------------------------------------------------------------------------
// getByMeeting
// ---------------------------------------------------------------------------

describe("MeetingTaskProposalStore.getByMeeting", () => {
  test("returns only proposals belonging to the specified meeting", async () => {
    const meetingA = makeMeetingId("meeting-a");
    const meetingB = makeMeetingId("meeting-b");
    const propA1 = crypto.randomUUID() as ProposalId;
    const propA2 = crypto.randomUUID() as ProposalId;
    const propB1 = crypto.randomUUID() as ProposalId;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(makeProposalPayload(meetingA, propA1));
        yield* store.ingest(makeProposalPayload(meetingA, propA2));
        yield* store.ingest(makeProposalPayload(meetingB, propB1));
        return {
          a: yield* store.getByMeeting(meetingA),
          b: yield* store.getByMeeting(meetingB),
        };
      }),
    );

    expect(result.a).toHaveLength(2);
    expect(result.a.every((p) => p.meetingId === meetingA)).toBe(true);
    expect(result.b).toHaveLength(1);
    expect(result.b[0]?.proposalId).toBe(propB1);
  });

  test("returns empty array for a meeting with no proposals", async () => {
    const otherMeeting = makeMeetingId("other");
    const emptyMeeting = makeMeetingId("empty");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(
          makeProposalPayload(otherMeeting, crypto.randomUUID() as ProposalId),
        );
        return yield* store.getByMeeting(emptyMeeting);
      }),
    );

    expect(result).toHaveLength(0);
  });

  test("includes resolved proposals alongside pending ones", async () => {
    const meetingId = makeMeetingId("mixed-resolved");
    const propPending = crypto.randomUUID() as ProposalId;
    const propResolved = crypto.randomUUID() as ProposalId;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(makeProposalPayload(meetingId, propPending));
        yield* store.ingest(makeProposalPayload(meetingId, propResolved));
        yield* store.markResolved(propResolved, crypto.randomUUID());
        return yield* store.getByMeeting(meetingId);
      }),
    );

    // getByMeeting returns all proposals for the meeting regardless of resolution status
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// requiresApproval: false filtering
// ---------------------------------------------------------------------------

describe("requiresApproval:false proposals", () => {
  test("are excluded from getPendingApproval", async () => {
    const meetingId = makeMeetingId("no-approval");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(
          makeProposalPayload(meetingId, crypto.randomUUID() as ProposalId, {
            requiresApproval: false,
          }),
        );
        return yield* store.getPendingApproval();
      }),
    );

    expect(result).toHaveLength(0);
  });

  test("are still accessible via getById", async () => {
    const meetingId = makeMeetingId("no-approval-getbyid");
    const proposalId = crypto.randomUUID() as ProposalId;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(
          makeProposalPayload(meetingId, proposalId, { requiresApproval: false }),
        );
        return yield* store.getById(proposalId);
      }),
    );

    expect(result).not.toBeNull();
    expect(result?.requiresApproval).toBe(false);
  });

  test("are still accessible via getByMeeting", async () => {
    const meetingId = makeMeetingId("no-approval-getbymeeting");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(
          makeProposalPayload(meetingId, crypto.randomUUID() as ProposalId, {
            requiresApproval: false,
          }),
        );
        return yield* store.getByMeeting(meetingId);
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.requiresApproval).toBe(false);
  });

  test("only requiresApproval:true proposals appear in getPendingApproval when mixed", async () => {
    const meetingId = makeMeetingId("mixed-approval");
    const propNeedsApproval = crypto.randomUUID() as ProposalId;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(
          makeProposalPayload(meetingId, propNeedsApproval, { requiresApproval: true }),
        );
        yield* store.ingest(
          makeProposalPayload(meetingId, crypto.randomUUID() as ProposalId, {
            requiresApproval: false,
          }),
        );
        return yield* store.getPendingApproval();
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.proposalId).toBe(propNeedsApproval);
  });
});

// ---------------------------------------------------------------------------
// markResolved idempotency
// ---------------------------------------------------------------------------

describe("MeetingTaskProposalStore.markResolved idempotency", () => {
  test("second call with a different taskId does not overwrite the first (first-write wins)", async () => {
    const meetingId = makeMeetingId("idem-resolve");
    const proposalId = crypto.randomUUID() as ProposalId;
    const firstTaskId = "task-first";
    const secondTaskId = "task-second";

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(makeProposalPayload(meetingId, proposalId));
        yield* store.markResolved(proposalId, firstTaskId);
        yield* store.markResolved(proposalId, secondTaskId); // ignored — already resolved
        return yield* store.getById(proposalId);
      }),
    );

    expect(result?.resolvedTaskId).toBe(firstTaskId);
  });

  test("calling markResolved on an unknown proposalId is a safe no-op (does not throw)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.markResolved(crypto.randomUUID() as ProposalId, "task-id");
      }),
    );
    // passes if no exception is thrown
  });

  test("resolved proposal is removed from getPendingApproval", async () => {
    const meetingId = makeMeetingId("resolve-clears-pending");
    const proposalId = crypto.randomUUID() as ProposalId;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(makeProposalPayload(meetingId, proposalId));

        const before = yield* store.getPendingApproval();
        yield* store.markResolved(proposalId, "resolved-task-id");
        const after = yield* store.getPendingApproval();

        return { before: before.length, after: after.length };
      }),
    );

    expect(result.before).toBe(1);
    expect(result.after).toBe(0);
  });

  test("markResolved with a non-null taskId works after a no-op null resolve attempt", async () => {
    const meetingId = makeMeetingId("null-then-real");
    const proposalId = crypto.randomUUID() as ProposalId;
    const realTaskId = "real-task-id";

    // markResolved(id, null) does not truly resolve the proposal because
    // resolvedTaskId stays null — so a subsequent call with a real taskId still works.
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const eventStore = yield* createInMemoryEventStore();
        const store = yield* createMeetingTaskProposalStore({ eventStore });
        yield* store.ingest(makeProposalPayload(meetingId, proposalId));
        yield* store.markResolved(proposalId, null);   // sets resolvedTaskId: null (no change)
        yield* store.markResolved(proposalId, realTaskId); // now truly resolved
        return yield* store.getById(proposalId);
      }),
    );

    expect(result?.resolvedTaskId).toBe(realTaskId);
  });
});
