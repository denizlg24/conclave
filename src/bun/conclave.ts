import { Effect, Exit, Schema, Scope, Stream } from "effect";
import { join } from "node:path";

import type { BusEvent } from "@/shared/types/bus-event";
import type { AgentRuntimeEvent } from "@/shared/types/agent-runtime";
import type {
  AgentRole,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
  TaskType,
} from "@/shared/types/orchestration";
import { OrchestrationCommand as OrchestrationCommandSchema } from "@/shared/types/orchestration";
import type { AgentId, CommandId, MeetingId, ProposalId, TaskId } from "@/shared/types/base-schemas";

import {
  createOrchestrationEngine,
  type OrchestrationEngineShape,
} from "@/core/orchestrator/engine";
import { createEventBus, type EventBusShape } from "@/core/communication/event-bus";
import { createReceiptStore } from "@/core/communication/receipt-store";
import { createOrchestratorReactor } from "@/core/communication/orchestrator-reactor";
import { createAgentReactor } from "@/core/communication/agent-reactor";
import { createMeetingReactor } from "@/core/communication/meeting-reactor";
import { createPlanningReactor } from "@/core/communication/planning-reactor";
import { createReviewMeetingReactor } from "@/core/communication/review-meeting-reactor";
import {
  materializeProposalTasksForMeeting,
  rejectLegacyDuplicateProposedTasks,
} from "@/core/communication/proposal-task-materializer";
import { createMeetingOrchestrator } from "@/core/meetings";
import { createAgentService } from "@/core/agents/service";
import { resolveAdapterBinaryPath as autoResolveAdapterBinaryPath } from "@/core/agents/binary-path";
import { createClaudeCodeAdapter } from "@/core/agents/claude-code-adapter";
import { createOpenAICodexAdapter } from "@/core/agents/openai-codex-adapter";
import { createAgentRuntimeEventStore } from "@/core/memory/agent-runtime-event-store";
import { createPersistentEventStore } from "@/core/memory/persistent-event-store";
import { createDecisionLogStore } from "@/core/memory/decision-log-store";
import { createSuspensionStore } from "@/core/memory/suspension-store";
import {
  createMeetingTaskProposalStore,
  type MeetingTaskProposalStoreShape,
} from "@/core/memory/meeting-task-proposal-store";
import { createResumeHandler } from "./resume-handler";
import {
  type AdapterBinaryResolution,
  DEFAULT_ADAPTER_TYPE,
  defaultModelForAdapter,
  type AdapterType,
} from "@/shared/types/adapter";

import type {
  SerializedAgentRoster,
  SerializedEvent,
  SerializedPendingProposal,
  SerializedReadModel,
} from "@/shared/rpc/rpc-schema";

function serializeReadModel(model: OrchestrationReadModel): SerializedReadModel {
  return {
    tasks: model.tasks.map((t) => ({
      id: t.id,
      taskType: t.taskType,
      title: t.title,
      description: t.description,
      status: t.status,
      owner: t.owner,
      ownerRole: t.ownerRole,
      deps: [...t.deps],
      input: t.input,
      output: t.output,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    meetings: model.meetings.map((m) => ({
      id: m.id,
      meetingType: m.meetingType,
      status: m.status,
      agenda: [...m.agenda],
      participants: [...m.participants],
      contributions: m.contributions.map((c) => ({
        agentRole: c.agentRole,
        agendaItemIndex: c.agendaItemIndex,
        content: c.content,
        references: [...c.references],
      })),
      summary: m.summary,
      proposedTaskIds: [...m.proposedTaskIds],
      approvedTaskIds: [...m.approvedTaskIds],
      rejectedTaskIds: [...m.rejectedTaskIds],
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    })),
    snapshotSequence: model.snapshotSequence,
    updatedAt: model.updatedAt,
  };
}

function serializeEvent(event: OrchestrationEvent): SerializedEvent {
  return {
    eventId: event.eventId,
    type: event.type,
    aggregateKind: event.aggregateKind,
    aggregateId: event.aggregateId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    commandId: event.commandId,
    payload: event.payload as Record<string, unknown>,
  };
}

export interface ConclaveShape {
  readonly engine: OrchestrationEngineShape;
  readonly bus: EventBusShape;

  readonly getSerializedState: () => Promise<SerializedReadModel>;
  readonly getSerializedEvents: (fromSequence: number) => Promise<SerializedEvent[]>;
  readonly getAgentRoster: () => Promise<SerializedAgentRoster>;

  readonly sendCommand: (params: {
    message: string;
  }) => Promise<{ taskId: string; meetingId: string }>;

  readonly createTask: (params: {
    taskType: string;
    title: string;
    description: string;
    deps: string[];
  }) => Promise<{ taskId: string }>;

  readonly updateTaskStatus: (params: {
    taskId: string;
    status: string;
    reason?: string;
  }) => Promise<{ success: boolean }>;

  readonly approveProposedTasks: (params: {
    meetingId: string;
    approvedTaskIds: string[];
    rejectedTaskIds: string[];
  }) => Promise<{ success: boolean }>;

  readonly getPendingProposals: () => Promise<SerializedPendingProposal[]>;

  readonly scheduleMeeting: (params: {
    meetingType: string;
    agenda: string[];
    participants: string[];
  }) => Promise<{ meetingId: string }>;

  readonly getSuspendedTasks: () => Promise<Array<{
    taskId: string;
    agentId: string;
    agentRole: string;
    suspendedAt: string;
    reason: string;
    taskTitle: string;
  }>>;

  readonly resumeSuspendedTask: (taskId: string) => Promise<{ success: boolean }>;

  readonly retryTask: (taskId: string) => Promise<{ success: boolean }>;

  readonly onEvent: (callback: (event: SerializedEvent, model: SerializedReadModel) => void) => void;

  readonly onAgentEvent: (callback: (event: AgentRuntimeEvent) => void) => void;

  readonly onAgentRoster: (callback: (roster: SerializedAgentRoster) => void) => void;

  readonly onQuotaExhausted: (callback: (info: {
    agentId: string;
    taskId: string;
    adapterType: string;
    rawMessage: string;
    occurredAt: string;
  }) => void) => void;

  readonly shutdown: () => Promise<void>;
}

function createAgentAdapter(
  adapterType: AdapterType,
  resolveAdapterBinaryPathForType?: (
    adapterType: AdapterType,
  ) => Promise<AdapterBinaryResolution>,
) {
  switch (adapterType) {
    case "claude-code":
      return createClaudeCodeAdapter({
        resolveBinaryPath: () =>
          resolveAdapterBinaryPathForType?.("claude-code") ??
          autoResolveAdapterBinaryPath({
            adapterType: "claude-code",
            manualPath: null,
          }),
      });
    case "openai-codex":
      return createOpenAICodexAdapter({
        resolveBinaryPath: () =>
          resolveAdapterBinaryPathForType?.("openai-codex") ??
          autoResolveAdapterBinaryPath({
            adapterType: "openai-codex",
            manualPath: null,
          }),
      });
  }
}

function decodeCommand(command: unknown): OrchestrationCommand {
  return Schema.decodeUnknownSync(OrchestrationCommandSchema)(command);
}

function decisionTypeForTask(taskType: TaskType):
  | "task_decomposition"
  | "task_assignment"
  | "task_execution"
  | "code_review"
  | "test_result" {
  switch (taskType) {
    case "planning":
    case "decomposition":
      return "task_decomposition";
    case "review":
      return "code_review";
    case "testing":
      return "test_result";
    case "implementation":
      return "task_execution";
  }
}

function getTaskInput(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

export async function bootstrapConclave(
  projectPath: string,
  adapterType: AdapterType = DEFAULT_ADAPTER_TYPE,
  model = defaultModelForAdapter(adapterType),
  resolveAdapterBinaryPathForType?: (
    adapterType: AdapterType,
  ) => Promise<AdapterBinaryResolution>,
): Promise<ConclaveShape> {
  const scope = Effect.runSync(Scope.make());
  const memoryPath = join(projectPath, ".conclave", "memory");

  const program = Effect.gen(function* () {
    const bus = yield* createEventBus();
    const agentRuntimeEventStore = yield* createAgentRuntimeEventStore({ storagePath: memoryPath });
    const eventStore = yield* createPersistentEventStore({ storagePath: memoryPath });
    const decisionLog = yield* createDecisionLogStore({ storagePath: memoryPath });
    const suspensionStore = yield* createSuspensionStore({ storagePath: memoryPath });
    const engine = yield* createOrchestrationEngine({ eventBus: bus, eventStore });
    const receiptStore = yield* createReceiptStore();

    // Hydrate proposal store from persisted events.
    const proposalStore: MeetingTaskProposalStoreShape = yield* createMeetingTaskProposalStore({ eventStore });
    yield* proposalStore.rebuild();

    // Re-link proposals to tasks that were already created in a previous session.
    // Tasks created by the reactor embed their proposalId in input.proposalId.
    // Any task no longer in "proposed" status means the human already decided —
    // mark its proposal resolved so it no longer appears in the approval queue.
    const bootReadModel = yield* engine.getReadModel();
    for (const task of bootReadModel.tasks) {
      const inp = getTaskInput(task.input);
      if (
        inp !== null &&
        typeof inp["proposalId"] === "string" &&
        task.status !== "proposed"
      ) {
        yield* proposalStore.markResolved(inp["proposalId"] as ProposalId, task.id);
      }
    }

    // Recover pending proposal-backed tasks after restart, then reject the
    // legacy meeting-reactor copies that never carried proposalId.
    const pendingProposals = yield* proposalStore.getPendingApproval();
    const pendingProposalsByMeeting = new Map<
      MeetingId,
      Array<(typeof pendingProposals)[number]>
    >();
    for (const proposal of pendingProposals) {
      const existing = pendingProposalsByMeeting.get(proposal.meetingId);
      if (existing) {
        existing.push(proposal);
      } else {
        pendingProposalsByMeeting.set(proposal.meetingId, [proposal]);
      }
    }

    for (const [meetingId, proposals] of pendingProposalsByMeeting) {
      yield* materializeProposalTasksForMeeting({
        engine,
        meetingId,
        proposals,
        occurredAt: proposals[0]?.proposedAt ?? new Date().toISOString(),
        logPrefix: "[bootstrap]",
      });
    }

    yield* rejectLegacyDuplicateProposedTasks({
      engine,
      occurredAt: new Date().toISOString(),
      logPrefix: "[bootstrap]",
    });

    const adapter = yield* createAgentAdapter(
      adapterType,
      resolveAdapterBinaryPathForType,
    );
    const agentService = createAgentService(adapter, undefined, model);

    yield* agentService.startAgent(
      "agent-pm" as AgentId,
      "pm",
      projectPath,
    );

    yield* createOrchestratorReactor({
      engine,
      bus,
      receiptStore,
      agentService,
      workingDirectory: projectPath,
      proposalStore,
    }).pipe(Effect.provideService(Scope.Scope, scope));

    yield* createAgentReactor({
      engine,
      bus,
      receiptStore,
      agentService,
      suspensionStore,
    }).pipe(Effect.provideService(Scope.Scope, scope));

    yield* createMeetingReactor({
      bus,
      receiptStore,
    }).pipe(Effect.provideService(Scope.Scope, scope));

    yield* createPlanningReactor({
      engine,
      bus,
      receiptStore,
    }).pipe(Effect.provideService(Scope.Scope, scope));

    const meetingOrchestrator = createMeetingOrchestrator({ engine, agentService });

    yield* createReviewMeetingReactor({
      engine,
      bus,
      receiptStore,
      meetingOrchestrator,
      projectPath,
      agentRuntimeEventStore,
    }).pipe(Effect.provideService(Scope.Scope, scope));

    const eventCallbacks: Array<
      (event: SerializedEvent, model: SerializedReadModel) => void
    > = [];
    const agentEventCallbacks: Array<
      (event: AgentRuntimeEvent) => void
    > = [];
    const rosterCallbacks: Array<
      (roster: SerializedAgentRoster) => void
    > = [];
    const quotaExhaustedCallbacks: Array<
      (info: { agentId: string; taskId: string; adapterType: string; rawMessage: string; occurredAt: string }) => void
    > = [];

    agentService.onRosterChange(() => {
      Effect.runPromise(agentService.listAgents()).then((sessions) => {
          const roster: SerializedAgentRoster = {
            agents: sessions.map((s) => ({
              agentId: s.agentId,
              role: s.role,
              sessionId: s.sessionId,
            })),
          };
        for (const cb of rosterCallbacks) cb(roster);
      });
    });

    const allEvents = (_e: BusEvent): _e is BusEvent => true;
    const busStream = bus.subscribeFiltered(allEvents);

    yield* busStream.pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (!event.type.startsWith("task.") && !event.type.startsWith("meeting.")) {
            return;
          }
          const orchEvent = event as OrchestrationEvent;
          const model = yield* engine.getReadModel();

          if (orchEvent.type === "task.assigned") {
            const task = model.tasks.find((candidate) => candidate.id === orchEvent.payload.taskId);
            if (task) {
              yield* decisionLog.log({
                type: "task_assignment",
                agentId: orchEvent.payload.agentId,
                agentRole: orchEvent.payload.agentRole,
                context: { taskId: task.id },
                rationale: task.description,
                outcome: `Assigned to ${orchEvent.payload.agentRole} (${orchEvent.payload.agentId}).`,
              });
            }
          }

          if (orchEvent.type === "task.status-updated") {
            const task = model.tasks.find((candidate) => candidate.id === orchEvent.payload.taskId);
            if (
              task?.owner &&
              task.ownerRole &&
              ["review", "done", "failed", "suspended"].includes(orchEvent.payload.status)
            ) {
              yield* decisionLog.log({
                type: decisionTypeForTask(task.taskType),
                agentId: task.owner,
                agentRole: task.ownerRole,
                context: { taskId: task.id },
                rationale:
                  typeof task.output === "string"
                    ? task.output
                    : task.description,
                outcome:
                  typeof orchEvent.payload.reason === "string" && orchEvent.payload.reason.length > 0
                    ? orchEvent.payload.reason
                    : `Task moved to ${orchEvent.payload.status}.`,
              });
            }
          }

          if (orchEvent.type === "meeting.completed") {
            const pmAgent = (yield* agentService.listAgents()).find(
              (agent) => agent.role === "pm",
            );
            if (pmAgent) {
              yield* decisionLog.log({
                type: "meeting_summary",
                agentId: pmAgent.agentId,
                agentRole: "pm" as AgentRole,
                context: { meetingId: orchEvent.payload.meetingId },
                rationale: orchEvent.payload.summary,
                outcome: orchEvent.payload.summary,
                artifacts: [...orchEvent.payload.proposedTaskIds],
              });
            }
          }

          const serializedEvent = serializeEvent(orchEvent);
          const serializedModel = serializeReadModel(model);
          for (const cb of eventCallbacks) {
            cb(serializedEvent, serializedModel);
          }
        }),
      ),
      Effect.forkScoped,
    ).pipe(Effect.provideService(Scope.Scope, scope));

    yield* agentService.streamEvents.pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          yield* agentRuntimeEventStore.append(event);
          yield* bus.publish(event);

          for (const cb of agentEventCallbacks) {
            cb(event);
          }
          
          // Special handling for quota exhaustion events
          if (event.type === "agent.quota.exhausted") {
            const quotaEvent = event as unknown as {
              agentId: string;
              taskId: string;
              adapterType: string;
              rawMessage: string;
              occurredAt: string;
            };
            for (const cb of quotaExhaustedCallbacks) {
              cb(quotaEvent);
            }
          }
        }),
      ),
      Effect.forkScoped,
    ).pipe(Effect.provideService(Scope.Scope, scope));

    return { engine, bus, agentService, decisionLog, suspensionStore, eventCallbacks, agentEventCallbacks, rosterCallbacks, quotaExhaustedCallbacks, agentRuntimeEventStore, proposalStore };
  });

  const { engine, bus, agentService, decisionLog, suspensionStore, eventCallbacks, agentEventCallbacks, rosterCallbacks, quotaExhaustedCallbacks, agentRuntimeEventStore, proposalStore } = await Effect.runPromise(program);

  const existingDecisions = await Effect.runPromise(decisionLog.getAll());
  const existingAgentEvents = await Effect.runPromise(agentRuntimeEventStore.readAll());
  console.log(`[conclave] Memory initialized: ${existingDecisions.length} decision log entries loaded, ${existingAgentEvents.length} agent runtime events loaded`);

  const getSerializedState = async (): Promise<SerializedReadModel> => {
    const model = await Effect.runPromise(engine.getReadModel());
    return serializeReadModel(model);
  };

  const getAgentRoster = async (): Promise<SerializedAgentRoster> => {
    const sessions = await Effect.runPromise(agentService.listAgents());
    return {
      agents: sessions.map((s) => ({
        agentId: s.agentId,
        role: s.role,
        sessionId: s.sessionId,
      })),
    };
  };

  const getSerializedEvents = async (
    fromSequence: number,
  ): Promise<SerializedEvent[]> => {
    const events = await Effect.runPromise(
      engine.readEvents(fromSequence).pipe(Stream.runCollect, Effect.map((chunk) => [...chunk])),
    );
    return events.map(serializeEvent);
  };

  const sendCommand = async (params: {
    message: string;
  }): Promise<{ taskId: string; meetingId: string }> => {
    const taskId = crypto.randomUUID();
    const meetingId = crypto.randomUUID();
    const message = params.message;

    await Effect.runPromise(
      engine.dispatch(decodeCommand({
        type: "meeting.schedule",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        meetingId: meetingId as MeetingId,
        meetingType: "planning",
        agenda: [message],
        participants: ["pm", "developer", "reviewer", "tester"],
        createdAt: new Date().toISOString(),
      })),
    );

    await Effect.runPromise(
      engine.dispatch(decodeCommand({
        type: "meeting.start",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        meetingId: meetingId as MeetingId,
        createdAt: new Date().toISOString(),
      })),
    );

    await Effect.runPromise(
      engine.dispatch(decodeCommand({
        type: "task.create",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId: taskId as TaskId,
        taskType: "planning" as const,
        title: message.length > 60 ? message.slice(0, 57) + "..." : message,
        description: message,
        deps: [] as TaskId[],
        input: { meetingId },
        createdAt: new Date().toISOString(),
      })),
    );

    return { taskId, meetingId };
  };

  const createTask = async (params: {
    taskType: string;
    title: string;
    description: string;
    deps: string[];
  }): Promise<{ taskId: string }> => {
    const taskId = crypto.randomUUID();
    await Effect.runPromise(
      engine.dispatch(decodeCommand({
        type: "task.create",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId: taskId as TaskId,
        taskType: params.taskType as "implementation",
        title: params.title,
        description: params.description,
        deps: params.deps as TaskId[],
        input: null,
        createdAt: new Date().toISOString(),
      })),
    );
    return { taskId };
  };

  const updateTaskStatus = async (params: {
    taskId: string;
    status: string;
    reason?: string;
  }): Promise<{ success: boolean }> => {
    await Effect.runPromise(
      engine.dispatch(decodeCommand({
        type: "task.update-status",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId: params.taskId as TaskId,
        status: params.status as "pending",
        reason: params.reason,
        createdAt: new Date().toISOString(),
      })),
    );
    return { success: true };
  };

  const approveProposedTasks = async (params: {
    meetingId: string;
    approvedTaskIds: string[];
    rejectedTaskIds: string[];
  }): Promise<{ success: boolean }> => {
    await Effect.runPromise(
      engine.dispatch(decodeCommand({
        type: "meeting.approve-tasks",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        meetingId: params.meetingId as MeetingId,
        approvedTaskIds: params.approvedTaskIds as TaskId[],
        rejectedTaskIds: params.rejectedTaskIds as TaskId[],
        createdAt: new Date().toISOString(),
      })),
    );

    // Mark proposals resolved so they leave the approval queue.
    // The task embeds its proposalId in input.proposalId — use that to find
    // the link without a separate index. Idempotent: markResolved is a no-op
    // if the proposal was already resolved.
    await Effect.runPromise(
      Effect.gen(function* () {
        const allDecidedTaskIds = [
          ...params.approvedTaskIds,
          ...params.rejectedTaskIds,
        ];
        const model = yield* engine.getReadModel();
        for (const taskId of allDecidedTaskIds) {
          const task = model.tasks.find((t) => t.id === taskId);
          if (!task) continue;
          const inp = task.input as Record<string, unknown> | null;
          if (
            inp !== null &&
            typeof inp === "object" &&
            typeof inp["proposalId"] === "string"
          ) {
            yield* proposalStore.markResolved(
              inp["proposalId"] as ProposalId,
              taskId,
            );
          }
        }
      }),
    );

    return { success: true };
  };

  const scheduleMeeting = async (params: {
    meetingType: string;
    agenda: string[];
    participants: string[];
  }): Promise<{ meetingId: string }> => {
    const meetingId = crypto.randomUUID();
    await Effect.runPromise(
      engine.dispatch(decodeCommand({
        type: "meeting.schedule",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        meetingId: meetingId as MeetingId,
        meetingType: params.meetingType as "planning",
        agenda: params.agenda,
        participants: params.participants as Array<"pm" | "developer" | "reviewer" | "tester">,
        createdAt: new Date().toISOString(),
      })),
    );
    return { meetingId };
  };

  const getSuspendedTasks = async (): Promise<Array<{
    taskId: string;
    agentId: string;
    agentRole: string;
    suspendedAt: string;
    reason: string;
    taskTitle: string;
  }>> => {
    const suspensions = await Effect.runPromise(suspensionStore.getAllPending());
    return suspensions.map((s) => ({
      taskId: s.taskId,
      agentId: s.agentId,
      agentRole: s.agentRole,
      suspendedAt: s.suspendedAt,
      reason: s.reason,
      taskTitle: s.executionContext.taskTitle,
    }));
  };

  const getPendingProposals = async (): Promise<SerializedPendingProposal[]> => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const pending = yield* proposalStore.getPendingApproval();
        const model = yield* engine.getReadModel();

        return pending.map((proposal): SerializedPendingProposal => {
          // Find the DAG task whose input carries this proposal's id.
          const task = model.tasks.find((t) => {
            const inp = t.input as Record<string, unknown> | null;
            return (
              inp !== null &&
              typeof inp === "object" &&
              inp["proposalId"] === proposal.proposalId
            );
          });

          return {
            proposalId: proposal.proposalId,
            meetingId: proposal.meetingId,
            taskId: task?.id ?? "",
            taskType: proposal.proposedTask.taskType,
            title: proposal.proposedTask.title,
            description: proposal.proposedTask.description,
            deps: task ? [...task.deps] : [],
            requiresApproval: proposal.requiresApproval,
            proposedAt: proposal.proposedAt,
            originatingAgentRole: proposal.originatingAgentRole,
          };
        });
      }),
    );
  };

  const { resumeSuspendedTask, retryTask } = createResumeHandler({
    engine,
    agentService,
    suspensionStore,
    bus,
    projectPath,
  });

  const onEvent = (
    callback: (event: SerializedEvent, model: SerializedReadModel) => void,
  ) => {
    eventCallbacks.push(callback);
  };

  const onAgentEvent = (
    callback: (event: AgentRuntimeEvent) => void,
  ) => {
    agentEventCallbacks.push(callback);
  };

  const onAgentRoster = (
    callback: (roster: SerializedAgentRoster) => void,
  ) => {
    rosterCallbacks.push(callback);
  };

  const onQuotaExhausted = (
    callback: (info: {
      agentId: string;
      taskId: string;
      adapterType: string;
      rawMessage: string;
      occurredAt: string;
    }) => void,
  ) => {
    quotaExhaustedCallbacks.push(callback);
  };

  const shutdown = async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Scope.close(scope, Exit.void);
        yield* bus.shutdown();
      }),
    );
  };

  return {
    engine,
    bus,
    getSerializedState,
    getAgentRoster,
    getSerializedEvents,
    sendCommand,
    createTask,
    updateTaskStatus,
    approveProposedTasks,
    getPendingProposals,
    scheduleMeeting,
    getSuspendedTasks,
    resumeSuspendedTask,
    retryTask,
    onEvent,
    onAgentEvent,
    onAgentRoster,
    onQuotaExhausted,
    shutdown,
  };
}
