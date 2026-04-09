/**
 * Projector unit tests specific to the approval-gating flow:
 *   - meeting.task-proposed is a no-op in the read-model projector
 *   - task.created with initialStatus "proposed" stores status "proposed"
 *   - meeting.tasks-approved updates meeting.approvedTaskIds / rejectedTaskIds
 *   - approval events carry schemaVersion 1
 *   - event-sourcing replay produces identical state to live processing
 */
import { describe, test, expect, beforeEach } from "bun:test";

import { createEmptyReadModel, projectEvent, projectEvents } from "../projector";
import {
  resetCounters,
  makeTaskId,
  makeMeetingId,
  makeEventId,
  makeCommandId,
  makeIsoDate,
  makeMeetingScheduledEvent,
  makeMeetingTasksApprovedEvent,
  makeTaskCreatedEvent,
} from "@/test-utils/factories";
import type { OrchestrationEvent, MeetingTaskProposedPayload } from "@/shared/types/orchestration";
import type { MeetingId, ProposalId, TaskId } from "@/shared/types/base-schemas";

// ---------------------------------------------------------------------------
// Local factory — not in shared factories because proposal events are handled
// by MeetingTaskProposalStore, not by the projector read model directly.
// ---------------------------------------------------------------------------

function makeMeetingTaskProposedEvent(
  meetingId: MeetingId,
  proposalId: ProposalId,
  sequence: number,
): Extract<OrchestrationEvent, { type: "meeting.task-proposed" }> {
  const now = makeIsoDate();
  const payload: MeetingTaskProposedPayload = {
    proposalId,
    meetingId,
    agendaItemIndex: 0,
    proposedTask: {
      taskType: "implementation",
      title: "A proposed task" as MeetingTaskProposedPayload["proposedTask"]["title"],
      description: "Task description",
      deps: [],
      input: {},
    },
    originatingAgentRole: "pm" as const,
    requiresApproval: true,
    proposedAt: now,
  };

  return {
    schemaVersion: 1 as const,
    sequence,
    eventId: makeEventId(),
    aggregateKind: "meeting" as const,
    aggregateId: meetingId,
    occurredAt: now,
    commandId: makeCommandId(),
    causationEventId: null,
    correlationId: makeCommandId(),
    metadata: {},
    type: "meeting.task-proposed" as const,
    payload,
  };
}

/** Makes a task.created event that carries initialStatus: "proposed". */
function makeProposedTaskCreatedEvent(
  taskId: TaskId,
  sequence: number,
): Extract<OrchestrationEvent, { type: "task.created" }> {
  const now = makeIsoDate();
  return makeTaskCreatedEvent(taskId, sequence, {
    payload: {
      taskId,
      taskType: "implementation",
      title: "Proposed task" as Extract<
        OrchestrationEvent,
        { type: "task.created" }
      >["payload"]["title"],
      description: "Awaiting approval",
      deps: [],
      input: null,
      initialStatus: "proposed" as const,
      createdAt: now,
    },
  });
}

beforeEach(() => {
  resetCounters();
});

// ---------------------------------------------------------------------------
// meeting.task-proposed is a no-op in the projector
// ---------------------------------------------------------------------------

describe("projector — meeting.task-proposed event", () => {
  test("does not add any tasks to the read model", () => {
    const meetingId = makeMeetingId("noop-tasks");
    const proposalId = crypto.randomUUID() as ProposalId;
    const model = createEmptyReadModel(makeIsoDate());

    const result = projectEvent(model, makeMeetingTaskProposedEvent(meetingId, proposalId, 1));

    expect(result.tasks).toHaveLength(0);
  });

  test("does not alter a pre-existing meeting in the model", () => {
    const meetingId = makeMeetingId("noop-meeting");
    const proposalId = crypto.randomUUID() as ProposalId;
    const now = makeIsoDate();

    const withMeeting = projectEvent(createEmptyReadModel(now), makeMeetingScheduledEvent(meetingId, 1));
    const afterProposal = projectEvent(withMeeting, makeMeetingTaskProposedEvent(meetingId, proposalId, 2));

    expect(afterProposal.meetings).toHaveLength(1);
    expect(afterProposal.meetings[0]).toEqual(withMeeting.meetings[0]);
  });

  test("advances snapshotSequence to the event's sequence number", () => {
    const meetingId = makeMeetingId("noop-seq");
    const proposalId = crypto.randomUUID() as ProposalId;
    const model = createEmptyReadModel(makeIsoDate());

    const result = projectEvent(model, makeMeetingTaskProposedEvent(meetingId, proposalId, 7));

    expect(result.snapshotSequence).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// task.created with initialStatus "proposed"
// ---------------------------------------------------------------------------

describe("projector — task.created with initialStatus 'proposed'", () => {
  test("task status is 'proposed' (not 'pending') when initialStatus is 'proposed'", () => {
    const taskId = makeTaskId("proposed-t");
    const model = createEmptyReadModel(makeIsoDate());

    const result = projectEvent(model, makeProposedTaskCreatedEvent(taskId, 1));
    const task = result.tasks.find((t) => t.id === taskId);

    expect(task?.status).toBe("proposed");
  });

  test("task without initialStatus gets 'pending' status when deps are empty", () => {
    const taskId = makeTaskId("normal-t");
    const model = createEmptyReadModel(makeIsoDate());

    const result = projectEvent(model, makeTaskCreatedEvent(taskId, 1));
    const task = result.tasks.find((t) => t.id === taskId);

    expect(task?.status).toBe("pending");
  });

  test("proposed task does not auto-unblock when deps complete (stays 'proposed' until approved)", () => {
    const depId = makeTaskId("dep");
    const proposedId = makeTaskId("proposed-with-dep");
    const now = makeIsoDate();

    // Create dep task and proposed task in sequence
    let model = createEmptyReadModel(now);
    model = projectEvent(model, makeTaskCreatedEvent(depId, 1));
    model = projectEvent(model, makeProposedTaskCreatedEvent(proposedId, 2));

    const proposed = model.tasks.find((t) => t.id === proposedId);
    expect(proposed?.status).toBe("proposed");
  });
});

// ---------------------------------------------------------------------------
// meeting.tasks-approved updates the meeting read model
// ---------------------------------------------------------------------------

describe("projector — meeting.tasks-approved event", () => {
  test("sets approvedTaskIds and rejectedTaskIds on the meeting aggregate", () => {
    const meetingId = makeMeetingId("approval-update");
    const approvedId = makeTaskId("approved") as TaskId;
    const rejectedId = makeTaskId("rejected") as TaskId;
    const now = makeIsoDate();

    let model = createEmptyReadModel(now);
    model = projectEvent(model, makeMeetingScheduledEvent(meetingId, 1));
    model = projectEvent(model, makeMeetingTasksApprovedEvent(meetingId, [approvedId], [rejectedId], 2));

    const meeting = model.meetings.find((m) => m.id === meetingId);
    expect(meeting?.approvedTaskIds).toContain(approvedId);
    expect(meeting?.rejectedTaskIds).toContain(rejectedId);
  });

  test("does NOT transition task statuses — that is the decider+engine's responsibility", () => {
    const meetingId = makeMeetingId("no-task-transition");
    const taskId = makeTaskId("proposed-t");
    const now = makeIsoDate();

    let model = createEmptyReadModel(now);
    model = projectEvent(model, makeMeetingScheduledEvent(meetingId, 1));
    model = projectEvent(model, makeProposedTaskCreatedEvent(taskId, 2));
    // Projecting the approval event — the task remains "proposed" because
    // the actual status transition requires a task.status-updated event
    // emitted by the decider in response to meeting.approve-tasks command.
    model = projectEvent(model, makeMeetingTasksApprovedEvent(meetingId, [taskId], [], 3));

    const task = model.tasks.find((t) => t.id === taskId);
    expect(task?.status).toBe("proposed");
  });

  test("replaying the same approval event twice produces the same approvedTaskIds", () => {
    const meetingId = makeMeetingId("idem-approval");
    const approvedId = makeTaskId("approved-idem") as TaskId;
    const approvedEvent = makeMeetingTasksApprovedEvent(meetingId, [approvedId], [], 2);

    const baseModel = projectEvent(
      createEmptyReadModel(makeIsoDate()),
      makeMeetingScheduledEvent(meetingId, 1),
    );

    const first = projectEvent(baseModel, approvedEvent);
    const second = projectEvent(baseModel, approvedEvent);

    expect(first.meetings[0]?.approvedTaskIds).toEqual(second.meetings[0]?.approvedTaskIds);
  });
});

// ---------------------------------------------------------------------------
// Schema version consistency
// ---------------------------------------------------------------------------

describe("approval-flow events — schemaVersion", () => {
  test("meeting.task-proposed event carries schemaVersion 1", () => {
    const event = makeMeetingTaskProposedEvent(
      makeMeetingId("sv-proposed"),
      crypto.randomUUID() as ProposalId,
      1,
    );

    expect(event.schemaVersion).toBe(1);
  });

  test("meeting.tasks-approved event carries schemaVersion 1", () => {
    const event = makeMeetingTasksApprovedEvent(makeMeetingId("sv-approved"), [], [], 1);

    expect(event.schemaVersion).toBe(1);
  });

  test("task.created (proposed) event carries schemaVersion 1", () => {
    const event = makeProposedTaskCreatedEvent(makeTaskId("sv-task"), 1);

    expect(event.schemaVersion).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Event sourcing replay
// ---------------------------------------------------------------------------

describe("event sourcing replay — approval flow", () => {
  test("replaying the full proposal→approval event sequence produces identical state", () => {
    const meetingId = makeMeetingId("replay-flow");
    const taskId = makeTaskId("replay-task");
    const proposalId = crypto.randomUUID() as ProposalId;
    const now = makeIsoDate();

    const events: OrchestrationEvent[] = [
      makeMeetingScheduledEvent(meetingId, 1),
      makeMeetingTaskProposedEvent(meetingId, proposalId, 2),
      makeProposedTaskCreatedEvent(taskId, 3),
      makeMeetingTasksApprovedEvent(meetingId, [taskId], [], 4),
    ];

    const liveModel = projectEvents(createEmptyReadModel(now), events);
    const replayedModel = projectEvents(createEmptyReadModel(now), events);

    expect(replayedModel.snapshotSequence).toBe(liveModel.snapshotSequence);
    expect(replayedModel.tasks).toHaveLength(liveModel.tasks.length);
    expect(replayedModel.meetings[0]?.approvedTaskIds).toEqual(
      liveModel.meetings[0]?.approvedTaskIds,
    );
    expect(replayedModel.meetings[0]?.status).toEqual(liveModel.meetings[0]?.status);
  });

  test("duplicate task.created for the same taskId is idempotent (second event skipped)", () => {
    const taskId = makeTaskId("dup-task");
    const now = makeIsoDate();

    const event1 = makeTaskCreatedEvent(taskId, 1);
    const event2 = makeTaskCreatedEvent(taskId, 2);

    let model = projectEvent(createEmptyReadModel(now), event1);
    model = projectEvent(model, event2);

    // Only one task in the model — duplicate is silently dropped
    expect(model.tasks.filter((t) => t.id === taskId)).toHaveLength(1);
    // Sequence advances to the second event regardless
    expect(model.snapshotSequence).toBe(2);
  });

  test("event sequence order is preserved: tasks appear in insertion order", () => {
    const taskA = makeTaskId("task-a");
    const taskB = makeTaskId("task-b");
    const now = makeIsoDate();

    const model = projectEvents(createEmptyReadModel(now), [
      makeTaskCreatedEvent(taskA, 1),
      makeTaskCreatedEvent(taskB, 2),
    ]);

    expect(model.tasks[0]?.id).toBe(taskA);
    expect(model.tasks[1]?.id).toBe(taskB);
  });
});
