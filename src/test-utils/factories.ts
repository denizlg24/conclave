import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationTask,
  OrchestrationMeeting,
  TaskStatus,
  TaskType,
  AgentRole,
  MeetingType,
} from "@/shared/types/orchestration";
import type {
  TaskId,
  AgentId,
  MeetingId,
  CommandId,
  EventId,
} from "@/shared/types/base-schemas";

let commandCounter = 0;
let taskCounter = 0;
let eventCounter = 0;
let meetingCounter = 0;
let agentCounter = 0;

export function resetCounters(): void {
  commandCounter = 0;
  taskCounter = 0;
  eventCounter = 0;
  meetingCounter = 0;
  agentCounter = 0;
}

export function makeCommandId(): CommandId {
  return `cmd-${++commandCounter}` as CommandId;
}

export function makeTaskId(suffix?: string): TaskId {
  return (suffix ?? `task-${++taskCounter}`) as TaskId;
}

export function makeEventId(): EventId {
  return `evt-${++eventCounter}` as EventId;
}

export function makeMeetingId(suffix?: string): MeetingId {
  return (suffix ?? `mtg-${++meetingCounter}`) as MeetingId;
}

export function makeAgentId(suffix?: string): AgentId {
  return (suffix ?? `agent-${++agentCounter}`) as AgentId;
}

export function makeIsoDate(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function makeCreateTaskCommand(
  overrides: Partial<Extract<OrchestrationCommand, { type: "task.create" }>> = {},
): Extract<OrchestrationCommand, { type: "task.create" }> {
  return {
    type: "task.create",
    schemaVersion: 1 as const,
    commandId: makeCommandId(),
    taskId: makeTaskId(),
    taskType: "implementation" as TaskType,
    title: "Test Task" as string & { readonly TrimmedNonEmptyString: unique symbol },
    description: "Test description",
    deps: [],
    input: null,
    createdAt: makeIsoDate(),
    ...overrides,
  };
}

export function makeAssignTaskCommand(
  taskId: TaskId,
  overrides: Partial<Extract<OrchestrationCommand, { type: "task.assign" }>> = {},
): Extract<OrchestrationCommand, { type: "task.assign" }> {
  return {
    type: "task.assign",
    schemaVersion: 1 as const,
    commandId: makeCommandId(),
    taskId,
    agentId: makeAgentId(),
    agentRole: "developer" as AgentRole,
    createdAt: makeIsoDate(),
    ...overrides,
  };
}

export function makeUpdateStatusCommand(
  taskId: TaskId,
  status: TaskStatus,
  overrides: Partial<Extract<OrchestrationCommand, { type: "task.update-status" }>> = {},
): Extract<OrchestrationCommand, { type: "task.update-status" }> {
  return {
    type: "task.update-status",
    schemaVersion: 1 as const,
    commandId: makeCommandId(),
    taskId,
    status,
    createdAt: makeIsoDate(),
    ...overrides,
  };
}

export function makeAddDependencyCommand(
  taskId: TaskId,
  dependsOn: TaskId,
  overrides: Partial<Extract<OrchestrationCommand, { type: "task.add-dependency" }>> = {},
): Extract<OrchestrationCommand, { type: "task.add-dependency" }> {
  return {
    type: "task.add-dependency",
    schemaVersion: 1 as const,
    commandId: makeCommandId(),
    taskId,
    dependsOn,
    createdAt: makeIsoDate(),
    ...overrides,
  };
}

export function makeRemoveDependencyCommand(
  taskId: TaskId,
  dependsOn: TaskId,
  overrides: Partial<Extract<OrchestrationCommand, { type: "task.remove-dependency" }>> = {},
): Extract<OrchestrationCommand, { type: "task.remove-dependency" }> {
  return {
    type: "task.remove-dependency",
    schemaVersion: 1 as const,
    commandId: makeCommandId(),
    taskId,
    dependsOn,
    createdAt: makeIsoDate(),
    ...overrides,
  };
}

export function makeScheduleMeetingCommand(
  overrides: Partial<Extract<OrchestrationCommand, { type: "meeting.schedule" }>> = {},
): Extract<OrchestrationCommand, { type: "meeting.schedule" }> {
  return {
    type: "meeting.schedule",
    schemaVersion: 1 as const,
    commandId: makeCommandId(),
    meetingId: makeMeetingId(),
    meetingType: "planning" as MeetingType,
    agenda: ["Item 1" as string & { readonly TrimmedNonEmptyString: unique symbol }],
    participants: ["pm" as AgentRole, "developer" as AgentRole],
    createdAt: makeIsoDate(),
    ...overrides,
  };
}

export function makeApproveTasksCommand(
  meetingId: MeetingId,
  approvedTaskIds: TaskId[],
  rejectedTaskIds: TaskId[] = [],
  overrides: Partial<Extract<OrchestrationCommand, { type: "meeting.approve-tasks" }>> = {},
): Extract<OrchestrationCommand, { type: "meeting.approve-tasks" }> {
  return {
    type: "meeting.approve-tasks",
    schemaVersion: 1 as const,
    commandId: makeCommandId(),
    meetingId,
    approvedTaskIds,
    rejectedTaskIds,
    createdAt: makeIsoDate(),
    ...overrides,
  };
}

export function makeTask(
  overrides: Partial<OrchestrationTask> = {},
): OrchestrationTask {
  const now = makeIsoDate();
  return {
    id: makeTaskId(),
    taskType: "implementation" as TaskType,
    title: "Test Task" as string & { readonly TrimmedNonEmptyString: unique symbol },
    description: "Test description",
    owner: null,
    ownerRole: null,
    status: "pending" as TaskStatus,
    deps: [],
    input: null,
    output: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeMeeting(
  overrides: Partial<OrchestrationMeeting> = {},
): OrchestrationMeeting {
  const now = makeIsoDate();
  return {
    id: makeMeetingId(),
    meetingType: "planning" as MeetingType,
    agenda: ["Item 1" as string & { readonly TrimmedNonEmptyString: unique symbol }],
    participants: ["pm" as AgentRole],
    status: "scheduled",
    contributions: [],
    summary: null,
    proposedTaskIds: [],
    approvedTaskIds: [],
    rejectedTaskIds: [],
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeEmptyReadModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    tasks: [],
    meetings: [],
    updatedAt: makeIsoDate(),
  };
}

export function makeReadModelWithTasks(
  tasks: OrchestrationTask[],
  meetings: OrchestrationMeeting[] = [],
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    tasks,
    meetings,
    updatedAt: makeIsoDate(),
  };
}

export function makeTaskCreatedEvent(
  taskId: TaskId,
  sequence: number,
  overrides: Partial<Extract<OrchestrationEvent, { type: "task.created" }>> = {},
): Extract<OrchestrationEvent, { type: "task.created" }> {
  const now = makeIsoDate();
  return {
    sequence,
    eventId: makeEventId(),
    aggregateKind: "task",
    aggregateId: taskId,
    occurredAt: now,
    commandId: makeCommandId(),
    causationEventId: null,
    correlationId: makeCommandId(),
    metadata: {},
    type: "task.created",
    payload: {
      taskId,
      taskType: "implementation" as TaskType,
      title: "Test Task" as string & { readonly TrimmedNonEmptyString: unique symbol },
      description: "Test description",
      deps: [],
      input: null,
      createdAt: now,
    },
    ...overrides,
    schemaVersion: 1 as const,
  };
}

export function makeTaskAssignedEvent(
  taskId: TaskId,
  agentId: AgentId,
  sequence: number,
  overrides: Partial<Extract<OrchestrationEvent, { type: "task.assigned" }>> = {},
): Extract<OrchestrationEvent, { type: "task.assigned" }> {
  const now = makeIsoDate();
  return {
    sequence,
    eventId: makeEventId(),
    aggregateKind: "task",
    aggregateId: taskId,
    occurredAt: now,
    commandId: makeCommandId(),
    causationEventId: null,
    correlationId: makeCommandId(),
    metadata: {},
    type: "task.assigned",
    payload: {
      taskId,
      agentId,
      agentRole: "developer" as AgentRole,
      assignedAt: now,
    },
    ...overrides,
    schemaVersion: 1 as const,
  };
}

export function makeTaskStatusUpdatedEvent(
  taskId: TaskId,
  previousStatus: TaskStatus,
  status: TaskStatus,
  sequence: number,
  overrides: Partial<Extract<OrchestrationEvent, { type: "task.status-updated" }>> = {},
): Extract<OrchestrationEvent, { type: "task.status-updated" }> {
  const now = makeIsoDate();
  return {
    sequence,
    eventId: makeEventId(),
    aggregateKind: "task",
    aggregateId: taskId,
    occurredAt: now,
    commandId: makeCommandId(),
    causationEventId: null,
    correlationId: makeCommandId(),
    metadata: {},
    type: "task.status-updated",
    payload: {
      taskId,
      previousStatus,
      status,
      reason: null,
      updatedAt: now,
    },
    ...overrides,
    schemaVersion: 1 as const,
  };
}

export function makeTaskDependencyAddedEvent(
  taskId: TaskId,
  dependsOn: TaskId,
  sequence: number,
): Extract<OrchestrationEvent, { type: "task.dependency-added" }> {
  const now = makeIsoDate();
  return {
    schemaVersion: 1 as const,
    sequence,
    eventId: makeEventId(),
    aggregateKind: "task",
    aggregateId: taskId,
    occurredAt: now,
    commandId: makeCommandId(),
    causationEventId: null,
    correlationId: makeCommandId(),
    metadata: {},
    type: "task.dependency-added",
    payload: {
      taskId,
      dependsOn,
      addedAt: now,
    },
  };
}

export function makeTaskDependencyRemovedEvent(
  taskId: TaskId,
  dependsOn: TaskId,
  sequence: number,
): Extract<OrchestrationEvent, { type: "task.dependency-removed" }> {
  const now = makeIsoDate();
  return {
    schemaVersion: 1 as const,
    sequence,
    eventId: makeEventId(),
    aggregateKind: "task",
    aggregateId: taskId,
    occurredAt: now,
    commandId: makeCommandId(),
    causationEventId: null,
    correlationId: makeCommandId(),
    metadata: {},
    type: "task.dependency-removed",
    payload: {
      taskId,
      dependsOn,
      removedAt: now,
    },
  };
}

export function makeMeetingScheduledEvent(
  meetingId: MeetingId,
  sequence: number,
): Extract<OrchestrationEvent, { type: "meeting.scheduled" }> {
  const now = makeIsoDate();
  return {
    schemaVersion: 1 as const,
    sequence,
    eventId: makeEventId(),
    aggregateKind: "meeting",
    aggregateId: meetingId,
    occurredAt: now,
    commandId: makeCommandId(),
    causationEventId: null,
    correlationId: makeCommandId(),
    metadata: {},
    type: "meeting.scheduled",
    payload: {
      meetingId,
      meetingType: "planning" as MeetingType,
      agenda: ["Item 1" as string & { readonly TrimmedNonEmptyString: unique symbol }],
      participants: ["pm" as AgentRole, "developer" as AgentRole],
      scheduledAt: now,
    },
  };
}

export function makeMeetingTasksApprovedEvent(
  meetingId: MeetingId,
  approvedTaskIds: TaskId[],
  rejectedTaskIds: TaskId[],
  sequence: number,
): Extract<OrchestrationEvent, { type: "meeting.tasks-approved" }> {
  const now = makeIsoDate();
  return {
    schemaVersion: 1 as const,
    sequence,
    eventId: makeEventId(),
    aggregateKind: "meeting",
    aggregateId: meetingId,
    occurredAt: now,
    commandId: makeCommandId(),
    causationEventId: null,
    correlationId: makeCommandId(),
    metadata: {},
    type: "meeting.tasks-approved",
    payload: {
      meetingId,
      approvedTaskIds,
      rejectedTaskIds,
      approvedAt: now,
    },
  };
}

import type { AgentRoleConfig, TokenUsage } from "@/shared/types/agent-runtime";
import type { AgentSession } from "@/core/agents/adapter";

export function makeTokenUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    ...overrides,
  };
}

export function makeAgentRoleConfig(
  overrides: Partial<AgentRoleConfig> = {},
): AgentRoleConfig {
  return {
    role: "developer" as AgentRole,
    systemPrompt: "You are a developer agent.",
    allowedTools: ["Read", "Write", "Edit"],
    maxTokens: 16384,
    maxTurns: 10,
    model: "claude-sonnet-4-6" as string & { readonly TrimmedNonEmptyString: unique symbol },
    workingDirectory: "/tmp/test",
    ...overrides,
  };
}

export function makeAgentSession(
  overrides: Partial<AgentSession> = {},
): AgentSession {
  return {
    agentId: makeAgentId(),
    role: "developer" as AgentRole,
    claudeSessionId: `session-${Date.now()}`,
    model: "claude-sonnet-4-6",
    config: makeAgentRoleConfig(),
    cumulativeUsage: makeTokenUsage(),
    cumulativeCostUsd: 0.01,
    turnCount: 0,
    startedAt: makeIsoDate(),
    ...overrides,
  };
}
