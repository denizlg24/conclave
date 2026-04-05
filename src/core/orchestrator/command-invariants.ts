import { Effect } from "effect";

import type {
  OrchestrationCommand,
  OrchestrationReadModel,
  OrchestrationTask,
  OrchestrationMeeting,
  TaskStatus,
  MeetingStatus,
} from "@/shared/types/orchestration";
import type { TaskId, MeetingId } from "@/shared/types/base-schemas";

import { CommandInvariantError } from "./errors";

function invariantError(
  commandType: string,
  detail: string,
): CommandInvariantError {
  return new CommandInvariantError({ commandType, detail });
}

function findTaskById(
  readModel: OrchestrationReadModel,
  taskId: TaskId,
): OrchestrationTask | undefined {
  return readModel.tasks.find((t) => t.id === taskId);
}

function findMeetingById(
  readModel: OrchestrationReadModel,
  meetingId: MeetingId,
): OrchestrationMeeting | undefined {
  return readModel.meetings.find((m) => m.id === meetingId);
}

export function requireTask(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly taskId: TaskId;
}): Effect.Effect<OrchestrationTask, CommandInvariantError> {
  const task = findTaskById(input.readModel, input.taskId);
  if (task) {
    return Effect.succeed(task);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Task '${input.taskId}' does not exist.`,
    ),
  );
}

export function requireTaskAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly taskId: TaskId;
}): Effect.Effect<void, CommandInvariantError> {
  if (!findTaskById(input.readModel, input.taskId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Task '${input.taskId}' already exists.`,
    ),
  );
}

export function requireTaskStatus(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly taskId: TaskId;
  readonly allowed: ReadonlyArray<TaskStatus>;
}): Effect.Effect<OrchestrationTask, CommandInvariantError> {
  const task = findTaskById(input.readModel, input.taskId);
  if (!task) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Task '${input.taskId}' does not exist.`,
      ),
    );
  }
  if (!input.allowed.includes(task.status)) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Task '${input.taskId}' is in status '${task.status}', expected one of: ${input.allowed.join(", ")}.`,
      ),
    );
  }
  return Effect.succeed(task);
}

export function requireMeeting(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly meetingId: MeetingId;
}): Effect.Effect<OrchestrationMeeting, CommandInvariantError> {
  const meeting = findMeetingById(input.readModel, input.meetingId);
  if (meeting) {
    return Effect.succeed(meeting);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Meeting '${input.meetingId}' does not exist.`,
    ),
  );
}

export function requireMeetingAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly meetingId: MeetingId;
}): Effect.Effect<void, CommandInvariantError> {
  if (!findMeetingById(input.readModel, input.meetingId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Meeting '${input.meetingId}' already exists.`,
    ),
  );
}

export function requireMeetingStatus(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly meetingId: MeetingId;
  readonly allowed: ReadonlyArray<MeetingStatus>;
}): Effect.Effect<OrchestrationMeeting, CommandInvariantError> {
  const meeting = findMeetingById(input.readModel, input.meetingId);
  if (!meeting) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Meeting '${input.meetingId}' does not exist.`,
      ),
    );
  }
  if (!input.allowed.includes(meeting.status)) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Meeting '${input.meetingId}' is in status '${meeting.status}', expected one of: ${input.allowed.join(", ")}.`,
      ),
    );
  }
  return Effect.succeed(meeting);
}

export function requireNoCyclicDependency(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly taskId: TaskId;
  readonly dependsOn: TaskId;
}): Effect.Effect<void, CommandInvariantError> {
  if (input.taskId === input.dependsOn) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Task '${input.taskId}' cannot depend on itself.`,
      ),
    );
  }

  // BFS to detect cycles: walk from dependsOn's deps to see if we reach taskId
  const visited = new Set<TaskId>();
  const queue: TaskId[] = [input.dependsOn];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === input.taskId) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Adding dependency '${input.taskId}' → '${input.dependsOn}' would create a cycle.`,
        ),
      );
    }
    if (visited.has(current)) continue;
    visited.add(current);

    const task = findTaskById(input.readModel, current);
    if (task) {
      for (const dep of task.deps) {
        queue.push(dep);
      }
    }
  }

  return Effect.void;
}
