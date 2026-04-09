import { Effect } from "effect";

import type {
  MeetingProposedTask,
  OrchestrationReadModel,
} from "@/shared/types/orchestration";
import type {
  CommandId,
  MeetingId,
  ProposalId,
  TaskId,
} from "@/shared/types/base-schemas";

import type { OrchestrationEngineShape } from "../orchestrator/engine";

interface MaterializableMeetingProposal {
  readonly proposalId: ProposalId;
  readonly proposedTask: MeetingProposedTask;
}

function getTaskInput(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function getTaskProposalId(task: OrchestrationReadModel["tasks"][number]): ProposalId | null {
  const input = getTaskInput(task.input);
  return typeof input?.proposalId === "string"
    ? (input.proposalId as ProposalId)
    : null;
}

function getTaskProposedByMeeting(
  task: OrchestrationReadModel["tasks"][number],
): MeetingId | null {
  const input = getTaskInput(task.input);
  return typeof input?.proposedByMeeting === "string"
    ? (input.proposedByMeeting as MeetingId)
    : null;
}

export const LEGACY_DUPLICATE_REJECTION_REASON =
  "Rejected legacy duplicate created before proposal-backed task reconciliation.";

export function materializeProposalTasksForMeeting(deps: {
  readonly engine: OrchestrationEngineShape;
  readonly meetingId: MeetingId;
  readonly proposals: ReadonlyArray<MaterializableMeetingProposal>;
  readonly occurredAt: string;
  readonly logPrefix: string;
}): Effect.Effect<void> {
  const { engine, meetingId, proposals, occurredAt, logPrefix } = deps;

  return Effect.gen(function* () {
    if (proposals.length === 0) return;

    const indexToTaskId = new Map<number, TaskId>();
    const readModelForIndex = yield* engine.getReadModel();

    for (let i = 0; i < proposals.length; i++) {
      const proposal = proposals[i]!;
      const existingTask = readModelForIndex.tasks.find(
        (task) => getTaskProposalId(task) === proposal.proposalId,
      );
      indexToTaskId.set(
        i,
        existingTask ? existingTask.id : (crypto.randomUUID() as TaskId),
      );
    }

    for (let i = 0; i < proposals.length; i++) {
      const proposal = proposals[i]!;
      const taskId = indexToTaskId.get(i)!;

      const currentModel = yield* engine.getReadModel();
      if (currentModel.tasks.some((task) => task.id === taskId)) continue;

      const resolvedDeps: TaskId[] = [];
      for (const dep of proposal.proposedTask.deps) {
        if (typeof dep === "number") {
          const depTaskId = indexToTaskId.get(dep);
          if (
            depTaskId !== undefined &&
            currentModel.tasks.some((task) => task.id === depTaskId)
          ) {
            resolvedDeps.push(depTaskId);
          }
          continue;
        }

        if (currentModel.tasks.some((task) => task.id === dep)) {
          resolvedDeps.push(dep as TaskId);
        }
      }

      const proposalInput = getTaskInput(proposal.proposedTask.input) ?? {};

      yield* engine.dispatch({
        type: "task.create",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId,
        taskType: proposal.proposedTask.taskType,
        title: proposal.proposedTask.title,
        description: proposal.proposedTask.description,
        deps: resolvedDeps,
        input: {
          ...proposalInput,
          proposalId: proposal.proposalId,
          proposedByMeeting: meetingId,
        },
        initialStatus: "proposed" as const,
        createdAt: occurredAt,
      }).pipe(
        Effect.catch((cause: unknown) =>
          Effect.logWarning(
            `${logPrefix} Could not create proposed task for proposal '${proposal.proposalId}' in meeting '${meetingId}': ${String(cause)}`,
          ),
        ),
      );
    }
  });
}

export function rejectLegacyDuplicateProposedTasks(deps: {
  readonly engine: OrchestrationEngineShape;
  readonly occurredAt: string;
  readonly logPrefix: string;
}): Effect.Effect<void> {
  const { engine, occurredAt, logPrefix } = deps;

  return Effect.gen(function* () {
    const readModel = yield* engine.getReadModel();
    const meetingsWithProposalBackedTasks = new Set<MeetingId>();

    for (const task of readModel.tasks) {
      const proposalId = getTaskProposalId(task);
      const meetingId = getTaskProposedByMeeting(task);
      if (proposalId !== null && meetingId !== null) {
        meetingsWithProposalBackedTasks.add(meetingId);
      }
    }

    for (const task of readModel.tasks) {
      if (task.status !== "proposed") continue;

      const proposalId = getTaskProposalId(task);
      const meetingId = getTaskProposedByMeeting(task);
      if (proposalId !== null || meetingId === null) continue;
      if (!meetingsWithProposalBackedTasks.has(meetingId)) continue;

      yield* engine.dispatch({
        type: "task.update-status",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId: task.id,
        status: "rejected",
        reason: LEGACY_DUPLICATE_REJECTION_REASON,
        createdAt: occurredAt,
      }).pipe(
        Effect.catch((cause: unknown) =>
          Effect.logWarning(
            `${logPrefix} Could not reject legacy duplicate task '${task.id}' for meeting '${meetingId}': ${String(cause)}`,
          ),
        ),
      );
    }
  });
}
