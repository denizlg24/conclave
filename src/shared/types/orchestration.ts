import { Schema } from "effect";

import {
  AgentId,
  CommandId,
  EventId,
  IsoDateTime,
  MeetingId,
  NonNegativeInt,
  TaskId,
  TrimmedNonEmptyString,
} from "./base-schemas";

// ---------------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------------

export const TaskStatus = Schema.Literals([
  "pending",
  "assigned",
  "in_progress",
  "review",
  "done",
  "failed",
  "blocked",
  "proposed",
  "rejected",
]);
export type TaskStatus = typeof TaskStatus.Type;

export const TaskType = Schema.Literals([
  "decomposition",
  "implementation",
  "review",
  "testing",
  "planning",
]);
export type TaskType = typeof TaskType.Type;

export const AgentRole = Schema.Literals(["pm", "developer", "reviewer"]);
export type AgentRole = typeof AgentRole.Type;

export const MeetingType = Schema.Literals([
  "planning",
  "review",
  "retrospective",
  "escalation",
]);
export type MeetingType = typeof MeetingType.Type;

export const MeetingStatus = Schema.Literals([
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);
export type MeetingStatus = typeof MeetingStatus.Type;

// ---------------------------------------------------------------------------
// Aggregate kinds
// ---------------------------------------------------------------------------

export const AggregateKind = Schema.Literals(["task", "meeting"]);
export type AggregateKind = typeof AggregateKind.Type;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const TaskCreateCommand = Schema.Struct({
  type: Schema.Literal("task.create"),
  commandId: CommandId,
  taskId: TaskId,
  taskType: TaskType,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  deps: Schema.Array(TaskId),
  input: Schema.Unknown,
  initialStatus: Schema.optional(Schema.Literal("proposed")),
  createdAt: IsoDateTime,
});

const TaskAssignCommand = Schema.Struct({
  type: Schema.Literal("task.assign"),
  commandId: CommandId,
  taskId: TaskId,
  agentId: AgentId,
  agentRole: AgentRole,
  createdAt: IsoDateTime,
});

const TaskUpdateStatusCommand = Schema.Struct({
  type: Schema.Literal("task.update-status"),
  commandId: CommandId,
  taskId: TaskId,
  status: TaskStatus,
  reason: Schema.optional(Schema.String),
  output: Schema.optional(Schema.Unknown),
  createdAt: IsoDateTime,
});

const TaskAddDependencyCommand = Schema.Struct({
  type: Schema.Literal("task.add-dependency"),
  commandId: CommandId,
  taskId: TaskId,
  dependsOn: TaskId,
  createdAt: IsoDateTime,
});

const TaskRemoveDependencyCommand = Schema.Struct({
  type: Schema.Literal("task.remove-dependency"),
  commandId: CommandId,
  taskId: TaskId,
  dependsOn: TaskId,
  createdAt: IsoDateTime,
});

const MeetingScheduleCommand = Schema.Struct({
  type: Schema.Literal("meeting.schedule"),
  commandId: CommandId,
  meetingId: MeetingId,
  meetingType: MeetingType,
  agenda: Schema.Array(TrimmedNonEmptyString),
  participants: Schema.Array(AgentRole),
  createdAt: IsoDateTime,
});

const MeetingApproveTasksCommand = Schema.Struct({
  type: Schema.Literal("meeting.approve-tasks"),
  commandId: CommandId,
  meetingId: MeetingId,
  approvedTaskIds: Schema.Array(TaskId),
  rejectedTaskIds: Schema.Array(TaskId),
  createdAt: IsoDateTime,
});

const MeetingStartCommand = Schema.Struct({
  type: Schema.Literal("meeting.start"),
  commandId: CommandId,
  meetingId: MeetingId,
  createdAt: IsoDateTime,
});

const MeetingContributeCommand = Schema.Struct({
  type: Schema.Literal("meeting.contribute"),
  commandId: CommandId,
  meetingId: MeetingId,
  agentRole: AgentRole,
  agendaItemIndex: NonNegativeInt,
  content: Schema.String,
  references: Schema.Array(Schema.String),
  createdAt: IsoDateTime,
});

const MeetingCompleteCommand = Schema.Struct({
  type: Schema.Literal("meeting.complete"),
  commandId: CommandId,
  meetingId: MeetingId,
  summary: Schema.String,
  proposedTasks: Schema.Array(
    Schema.Struct({
      taskType: TaskType,
      title: TrimmedNonEmptyString,
      description: Schema.String,
      deps: Schema.Array(TaskId),
      input: Schema.Unknown,
    }),
  ),
  createdAt: IsoDateTime,
});

export const OrchestrationCommand = Schema.Union([
  TaskCreateCommand,
  TaskAssignCommand,
  TaskUpdateStatusCommand,
  TaskAddDependencyCommand,
  TaskRemoveDependencyCommand,
  MeetingScheduleCommand,
  MeetingApproveTasksCommand,
  MeetingStartCommand,
  MeetingContributeCommand,
  MeetingCompleteCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

// ---------------------------------------------------------------------------
// Event metadata & envelope
// ---------------------------------------------------------------------------

export const OrchestrationEventMetadata = Schema.Struct({
  agentId: Schema.optional(AgentId),
  agentRole: Schema.optional(AgentRole),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: AggregateKind,
  aggregateId: Schema.Union([TaskId, MeetingId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

// ---------------------------------------------------------------------------
// Event payload schemas
// ---------------------------------------------------------------------------

export const TaskCreatedPayload = Schema.Struct({
  taskId: TaskId,
  taskType: TaskType,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  deps: Schema.Array(TaskId),
  input: Schema.Unknown,
  initialStatus: Schema.optional(Schema.Literal("proposed")),
  createdAt: IsoDateTime,
});

export const TaskAssignedPayload = Schema.Struct({
  taskId: TaskId,
  agentId: AgentId,
  agentRole: AgentRole,
  assignedAt: IsoDateTime,
});

export const TaskStatusUpdatedPayload = Schema.Struct({
  taskId: TaskId,
  previousStatus: TaskStatus,
  status: TaskStatus,
  reason: Schema.NullOr(Schema.String),
  output: Schema.optional(Schema.Unknown),
  updatedAt: IsoDateTime,
});

export const TaskDependencyAddedPayload = Schema.Struct({
  taskId: TaskId,
  dependsOn: TaskId,
  addedAt: IsoDateTime,
});

export const TaskDependencyRemovedPayload = Schema.Struct({
  taskId: TaskId,
  dependsOn: TaskId,
  removedAt: IsoDateTime,
});

export const MeetingScheduledPayload = Schema.Struct({
  meetingId: MeetingId,
  meetingType: MeetingType,
  agenda: Schema.Array(TrimmedNonEmptyString),
  participants: Schema.Array(AgentRole),
  scheduledAt: IsoDateTime,
});

export const MeetingTasksApprovedPayload = Schema.Struct({
  meetingId: MeetingId,
  approvedTaskIds: Schema.Array(TaskId),
  rejectedTaskIds: Schema.Array(TaskId),
  approvedAt: IsoDateTime,
});

export const MeetingStartedPayload = Schema.Struct({
  meetingId: MeetingId,
  startedAt: IsoDateTime,
});

export const MeetingContributionAddedPayload = Schema.Struct({
  meetingId: MeetingId,
  agentRole: AgentRole,
  agendaItemIndex: NonNegativeInt,
  content: Schema.String,
  references: Schema.Array(Schema.String),
  addedAt: IsoDateTime,
});

export const MeetingCompletedPayload = Schema.Struct({
  meetingId: MeetingId,
  summary: Schema.String,
  proposedTaskIds: Schema.Array(TaskId),
  proposedTasks: Schema.Array(
    Schema.Struct({
      taskType: TaskType,
      title: TrimmedNonEmptyString,
      description: Schema.String,
      deps: Schema.Array(TaskId),
      input: Schema.Unknown,
    }),
  ),
  completedAt: IsoDateTime,
});

// ---------------------------------------------------------------------------
// Event types (discriminated union)
// ---------------------------------------------------------------------------

export const OrchestrationEventType = Schema.Literals([
  "task.created",
  "task.assigned",
  "task.status-updated",
  "task.dependency-added",
  "task.dependency-removed",
  "meeting.scheduled",
  "meeting.tasks-approved",
  "meeting.started",
  "meeting.contribution-added",
  "meeting.completed",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.created"),
    payload: TaskCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.assigned"),
    payload: TaskAssignedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.status-updated"),
    payload: TaskStatusUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.dependency-added"),
    payload: TaskDependencyAddedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.dependency-removed"),
    payload: TaskDependencyRemovedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("meeting.scheduled"),
    payload: MeetingScheduledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("meeting.tasks-approved"),
    payload: MeetingTasksApprovedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("meeting.started"),
    payload: MeetingStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("meeting.contribution-added"),
    payload: MeetingContributionAddedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("meeting.completed"),
    payload: MeetingCompletedPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

// ---------------------------------------------------------------------------
// Read model shapes
// ---------------------------------------------------------------------------

export const OrchestrationTask = Schema.Struct({
  id: TaskId,
  taskType: TaskType,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  owner: Schema.NullOr(AgentId),
  ownerRole: Schema.NullOr(AgentRole),
  status: TaskStatus,
  deps: Schema.Array(TaskId),
  input: Schema.Unknown,
  output: Schema.Unknown,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationTask = typeof OrchestrationTask.Type;

export const MeetingContribution = Schema.Struct({
  agentRole: AgentRole,
  agendaItemIndex: NonNegativeInt,
  content: Schema.String,
  references: Schema.Array(Schema.String),
});
export type MeetingContribution = typeof MeetingContribution.Type;

export const OrchestrationMeeting = Schema.Struct({
  id: MeetingId,
  meetingType: MeetingType,
  agenda: Schema.Array(TrimmedNonEmptyString),
  participants: Schema.Array(AgentRole),
  status: MeetingStatus,
  contributions: Schema.Array(MeetingContribution),
  summary: Schema.NullOr(Schema.String),
  proposedTaskIds: Schema.Array(TaskId),
  approvedTaskIds: Schema.Array(TaskId),
  rejectedTaskIds: Schema.Array(TaskId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationMeeting = typeof OrchestrationMeeting.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  tasks: Schema.Array(OrchestrationTask),
  meetings: Schema.Array(OrchestrationMeeting),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;
