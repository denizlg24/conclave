import { beforeEach, describe, expect, test } from "bun:test";
import { Duration, Effect, Stream } from "effect";

import { createEventBus } from "../event-bus";
import { createOrchestratorReactor } from "../orchestrator-reactor";
import { createReceiptStore } from "../receipt-store";
import type { AgentServiceShape } from "../../agents/service";
import type { OrchestrationEngineShape } from "../../orchestrator/engine";
import type { MeetingTaskProposalStoreShape } from "../../memory/meeting-task-proposal-store";
import type { AgentSession } from "../../agents/adapter";
import type { AgentRuntimeEvent } from "@/shared/types/agent-runtime";
import type {
  MeetingProposedTask,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@/shared/types/orchestration";
import type {
  CommandId,
  EventId,
  MeetingId,
  ProposalId,
} from "@/shared/types/base-schemas";
import {
  makeAgentId,
  makeCommandId,
  makeEmptyReadModel,
  makeEventId,
  makeIsoDate,
  makeMeetingId,
  makeTaskId,
  makeTokenUsage,
  makeAgentRoleConfig,
  resetCounters,
} from "@/test-utils/factories";

function makeAgentSession(): AgentSession {
  return {
    agentId: makeAgentId("developer-1"),
    adapterType: "openai-codex",
    role: "developer",
    sessionId: "session-1",
    model: "gpt-5-codex",
    config: makeAgentRoleConfig({
      role: "developer",
      workingDirectory: "E:\\PersonalProjects\\ai_orchestration_rpg",
      model: "gpt-5-codex",
    }),
    cumulativeUsage: makeTokenUsage(),
    cumulativeCostUsd: 0,
    turnCount: 0,
    startedAt: makeIsoDate(),
  };
}

function makeAgentService(): AgentServiceShape {
  const session = makeAgentSession();
  return {
    startAgent: () => Effect.succeed(session),
    sendMessage: () => Effect.succeed(""),
    interruptAgent: () => Effect.void,
    stopAgent: () => Effect.void,
    stopAll: () => Effect.void,
    getAgent: () => Effect.succeed(session),
    listAgents: () => Effect.succeed([session]),
    streamEvents: Stream.empty as Stream.Stream<AgentRuntimeEvent>,
    markBusy: () => undefined,
    markAvailable: () => undefined,
    findOrSpawnAgent: () => Effect.succeed(null),
    getTeamComposition: () => ({
      pm: { max: 1, active: 0 },
      developer: { max: 1, active: 0 },
      reviewer: { max: 1, active: 0 },
      tester: { max: 1, active: 0 },
    }),
    poolConfig: {
      maxPerRole: {
        pm: 1,
        developer: 1,
        reviewer: 1,
        tester: 1,
      },
    },
    onRosterChange: () => undefined,
  };
}

function makeMockEngine(readModel: OrchestrationReadModel = makeEmptyReadModel()): {
  engine: OrchestrationEngineShape;
  dispatchedCommands: OrchestrationCommand[];
} {
  const dispatchedCommands: OrchestrationCommand[] = [];
  const engine: OrchestrationEngineShape = {
    getReadModel: () => Effect.succeed(readModel),
    dispatch: (command) => {
      dispatchedCommands.push(command);
      return Effect.succeed({ sequence: dispatchedCommands.length, events: [] });
    },
    readEvents: () => Stream.empty as never,
    replay: () => Effect.succeed(readModel),
  };
  return { engine, dispatchedCommands };
}

function makeProposalStore(): MeetingTaskProposalStoreShape {
  const proposals: Array<
    Extract<OrchestrationEvent, { type: "meeting.task-proposed" }>["payload"] & {
      resolvedTaskId: string | null;
    }
  > = [];

  return {
    getByMeeting: (meetingId) =>
      Effect.succeed(proposals.filter((proposal) => proposal.meetingId === meetingId)),
    getPendingApproval: () =>
      Effect.succeed(proposals.filter((proposal) => proposal.requiresApproval && proposal.resolvedTaskId === null)),
    getById: (proposalId) =>
      Effect.succeed(proposals.find((proposal) => proposal.proposalId === proposalId) ?? null),
    markResolved: (proposalId, taskId) =>
      Effect.sync(() => {
        const proposal = proposals.find((candidate) => candidate.proposalId === proposalId);
        if (!proposal || proposal.resolvedTaskId !== null) return;
        proposal.resolvedTaskId = taskId;
      }),
    ingest: (payload) =>
      Effect.sync(() => {
        if (proposals.some((proposal) => proposal.proposalId === payload.proposalId)) {
          return;
        }
        proposals.push({ ...payload, resolvedTaskId: null });
      }),
    rebuild: () => Effect.void,
  };
}

function makeMeetingTaskProposedEvent(
  meetingId: MeetingId,
  proposalId: ProposalId,
  proposedTask: MeetingProposedTask,
  occurredAt: string,
): Extract<OrchestrationEvent, { type: "meeting.task-proposed" }> {
  return {
    schemaVersion: 1 as const,
    sequence: 1,
    eventId: makeEventId(),
    aggregateKind: "meeting",
    aggregateId: meetingId,
    occurredAt,
    commandId: makeCommandId(),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "meeting.task-proposed",
    payload: {
      proposalId,
      meetingId,
      agendaItemIndex: 0,
      proposedTask,
      originatingAgentRole: "pm",
      requiresApproval: true,
      proposedAt: occurredAt,
    },
  };
}

function makeMeetingCompletedEvent(
  meetingId: MeetingId,
  proposedTasks: MeetingProposedTask[],
  occurredAt: string,
): Extract<OrchestrationEvent, { type: "meeting.completed" }> {
  return {
    schemaVersion: 1 as const,
    sequence: 2,
    eventId: makeEventId() as EventId,
    aggregateKind: "meeting",
    aggregateId: meetingId,
    occurredAt,
    commandId: makeCommandId() as CommandId,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "meeting.completed",
    payload: {
      meetingId,
      summary: "Meeting complete",
      proposedTaskIds: [],
      proposedTasks,
      completedAt: occurredAt,
    },
  };
}

beforeEach(() => {
  resetCounters();
});

describe("orchestrator-reactor", () => {
  test("creates proposed tasks with proposalId, proposedByMeeting, and preserved input", async () => {
    const meetingId = makeMeetingId("reactor-mtg");
    const proposalId = "proposal-1" as ProposalId;
    const occurredAt = makeIsoDate();
    const proposedTask: MeetingProposedTask = {
      taskType: "implementation",
      title: "Implement approval gate" as MeetingProposedTask["title"],
      description: "Wire the gate through the reactor",
      deps: [],
      input: {
        parentPlanningTaskId: makeTaskId("parent-task"),
        schemaVersion: 1,
      },
    };
    const { engine, dispatchedCommands } = makeMockEngine();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* createEventBus();
          const receiptStore = yield* createReceiptStore();
          yield* createOrchestratorReactor({
            engine,
            bus,
            receiptStore,
            agentService: makeAgentService(),
            workingDirectory: "E:\\PersonalProjects\\ai_orchestration_rpg",
            proposalStore: makeProposalStore(),
          });

          yield* Effect.sleep(Duration.millis(20));
          yield* bus.publish(
            makeMeetingTaskProposedEvent(meetingId, proposalId, proposedTask, occurredAt),
          );
          yield* bus.publish(
            makeMeetingCompletedEvent(meetingId, [proposedTask], occurredAt),
          );
          yield* Effect.sleep(Duration.millis(80));
        }),
      ),
    );

    const createCommands = dispatchedCommands.filter(
      (command): command is Extract<OrchestrationCommand, { type: "task.create" }> =>
        command.type === "task.create",
    );

    expect(createCommands).toHaveLength(1);
    const input = createCommands[0]?.input as Record<string, unknown> | undefined;
    expect(input?.proposalId).toBe(proposalId);
    expect(input?.proposedByMeeting).toBe(meetingId);
    expect(input?.parentPlanningTaskId).toBe("parent-task");
    expect(input?.schemaVersion).toBe(1);
    expect(createCommands[0]?.initialStatus).toBe("proposed");
  });
});
