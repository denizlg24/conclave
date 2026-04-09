import { Effect, Ref } from "effect";

import type { MeetingTaskProposedPayload } from "@/shared/types/orchestration";
import type { MeetingId, ProposalId } from "@/shared/types/base-schemas";
import type { EventStoreShape } from "../orchestrator/event-store";
import type { EventStoreError } from "../orchestrator/errors";

export interface MeetingTaskProposal extends MeetingTaskProposedPayload {
  readonly resolvedTaskId: string | null;
}

export interface MeetingTaskProposalStoreShape {
  /**
   * Returns all proposals for a given meeting, in emission order.
   */
  readonly getByMeeting: (
    meetingId: MeetingId,
  ) => Effect.Effect<ReadonlyArray<MeetingTaskProposal>>;

  /**
   * Returns proposals that require human approval and have not yet been
   * resolved to a task (i.e. the approval gate is still open).
   */
  readonly getPendingApproval: () => Effect.Effect<
    ReadonlyArray<MeetingTaskProposal>
  >;

  /**
   * Returns a single proposal by its proposalId, or null if not found.
   */
  readonly getById: (
    proposalId: ProposalId,
  ) => Effect.Effect<MeetingTaskProposal | null>;

  /**
   * Marks a proposal as resolved (task has been approved or rejected).
   * Pass the DAG task ID when approved, null when declined with no task created.
   * Idempotent: calling again with the same proposalId is a no-op.
   */
  readonly markResolved: (
    proposalId: ProposalId,
    taskId: string | null,
  ) => Effect.Effect<void>;

  /**
   * Ingest a single live meeting.task-proposed event payload into the store.
   * Called by the orchestrator reactor for events arriving after startup.
   * Idempotent: inserting the same proposalId twice is a no-op.
   */
  readonly ingest: (
    payload: MeetingTaskProposedPayload,
  ) => Effect.Effect<void>;

  /**
   * Rebuild the in-memory index by replaying all meeting.task-proposed events
   * from the event store. Safe to call multiple times — fully idempotent.
   */
  readonly rebuild: () => Effect.Effect<void, EventStoreError>;
}

/**
 * In-memory proposal store backed by the event store.
 *
 * Proposals are keyed by proposalId, making all writes idempotent —
 * replaying the same event twice results in the same final state.
 * Call `rebuild()` on startup (after the event store is loaded) to
 * hydrate from persisted events.
 */
export function createMeetingTaskProposalStore(deps: {
  readonly eventStore: EventStoreShape;
}): Effect.Effect<MeetingTaskProposalStoreShape> {
  return Effect.gen(function* () {
    const { eventStore } = deps;

    // proposalId → proposal (idempotent: inserting the same id twice is a no-op)
    const proposalsRef = yield* Ref.make<Map<ProposalId, MeetingTaskProposal>>(
      new Map(),
    );

    const upsertProposal = (payload: MeetingTaskProposedPayload): Effect.Effect<void> =>
      Ref.update(proposalsRef, (map) => {
        if (map.has(payload.proposalId)) {
          return map;
        }
        const next = new Map(map);
        next.set(payload.proposalId, { ...payload, resolvedTaskId: null });
        return next;
      });

    const getByMeeting: MeetingTaskProposalStoreShape["getByMeeting"] = (meetingId) =>
      Ref.get(proposalsRef).pipe(
        Effect.map((map) =>
          [...map.values()].filter((p) => p.meetingId === meetingId),
        ),
      );

    const getPendingApproval: MeetingTaskProposalStoreShape["getPendingApproval"] = () =>
      Ref.get(proposalsRef).pipe(
        Effect.map((map) =>
          [...map.values()].filter(
            (p) => p.requiresApproval && p.resolvedTaskId === null,
          ),
        ),
      );

    const getById: MeetingTaskProposalStoreShape["getById"] = (proposalId) =>
      Ref.get(proposalsRef).pipe(
        Effect.map((map) => map.get(proposalId) ?? null),
      );

    const markResolved: MeetingTaskProposalStoreShape["markResolved"] = (
      proposalId,
      taskId,
    ) =>
      Ref.update(proposalsRef, (map) => {
        const existing = map.get(proposalId);
        if (!existing || existing.resolvedTaskId !== null) {
          return map;
        }
        const next = new Map(map);
        next.set(proposalId, { ...existing, resolvedTaskId: taskId });
        return next;
      });

    const rebuild: MeetingTaskProposalStoreShape["rebuild"] = () =>
      Effect.gen(function* () {
        const allEvents = yield* eventStore.readAll();
        for (const event of allEvents) {
          if (event.type === "meeting.task-proposed") {
            yield* upsertProposal(event.payload);
          }
        }
      });

    const ingest: MeetingTaskProposalStoreShape["ingest"] = (payload) =>
      upsertProposal(payload);

    return {
      getByMeeting,
      getPendingApproval,
      getById,
      markResolved,
      ingest,
      rebuild,
    } satisfies MeetingTaskProposalStoreShape;
  });
}
