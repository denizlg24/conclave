import { Effect, Exit, Scope, Stream } from "effect";
import { join } from "node:path";

import type { BusEvent } from "@/shared/types/bus-event";
import type {
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@/shared/types/orchestration";
import type { AgentId, CommandId, MeetingId, TaskId } from "@/shared/types/base-schemas";

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
import { createMeetingOrchestrator } from "@/core/meetings";
import { createAgentService } from "@/core/agents/service";
import { createClaudeCodeAdapter } from "@/core/agents/claude-code-adapter";
import { createPersistentEventStore } from "@/core/memory/persistent-event-store";
import { createDecisionLogStore } from "@/core/memory/decision-log-store";
import { createSuspensionStore } from "@/core/memory/suspension-store";
import { createResumeHandler } from "./resume-handler";

import type {
  SerializedAgentRoster,
  SerializedEvent,
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

  readonly onAgentEvent: (callback: (event: AgentRuntimeEventRecord) => void) => void;

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

type AgentRuntimeEventRecord = {
  type: string;
  agentId: string;
  sessionId: string;
  occurredAt: string;
  [key: string]: unknown;
};

export async function bootstrapConclave(projectPath: string): Promise<ConclaveShape> {
  const scope = Effect.runSync(Scope.make());
  const memoryPath = join(projectPath, ".conclave", "memory");

  const program = Effect.gen(function* () {
    const bus = yield* createEventBus();
    const eventStore = yield* createPersistentEventStore({ storagePath: memoryPath });
    const decisionLog = yield* createDecisionLogStore({ storagePath: memoryPath });
    const suspensionStore = yield* createSuspensionStore({ storagePath: memoryPath });
    const engine = yield* createOrchestrationEngine({ eventBus: bus, eventStore });
    const receiptStore = yield* createReceiptStore();

    const adapter = yield* createClaudeCodeAdapter();
    const agentService = createAgentService(adapter);

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
    }).pipe(Effect.provideService(Scope.Scope, scope));

    yield* createAgentReactor({
      engine,
      bus,
      receiptStore,
      agentService,
      suspensionStore,
    }).pipe(Effect.provideService(Scope.Scope, scope));

    yield* createMeetingReactor({
      engine,
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
    }).pipe(Effect.provideService(Scope.Scope, scope));

    const eventCallbacks: Array<
      (event: SerializedEvent, model: SerializedReadModel) => void
    > = [];
    const agentEventCallbacks: Array<
      (event: AgentRuntimeEventRecord) => void
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
            sessionId: s.claudeSessionId,
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
        Effect.sync(() => {
          const record = event as unknown as AgentRuntimeEventRecord;
          for (const cb of agentEventCallbacks) {
            cb(record);
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

    return { engine, bus, agentService, decisionLog, suspensionStore, eventCallbacks, agentEventCallbacks, rosterCallbacks, quotaExhaustedCallbacks };
  });

  const { engine, bus, agentService, decisionLog, suspensionStore, eventCallbacks, agentEventCallbacks, rosterCallbacks, quotaExhaustedCallbacks } = await Effect.runPromise(program);

  const existingDecisions = await Effect.runPromise(decisionLog.getAll());
  console.log(`[conclave] Memory initialized: ${existingDecisions.length} decision log entries loaded`);

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
        sessionId: s.claudeSessionId,
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
      engine.dispatch({
        type: "meeting.schedule",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        meetingId: meetingId as MeetingId,
        meetingType: "planning",
        agenda: [message],
        participants: ["pm", "developer", "reviewer", "tester"],
        createdAt: new Date().toISOString(),
      }),
    );

    await Effect.runPromise(
      engine.dispatch({
        type: "meeting.start",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        meetingId: meetingId as MeetingId,
        createdAt: new Date().toISOString(),
      }),
    );

    await Effect.runPromise(
      engine.dispatch({
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
      }),
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
      engine.dispatch({
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
      }),
    );
    return { taskId };
  };

  const updateTaskStatus = async (params: {
    taskId: string;
    status: string;
    reason?: string;
  }): Promise<{ success: boolean }> => {
    await Effect.runPromise(
      engine.dispatch({
        type: "task.update-status",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId: params.taskId as TaskId,
        status: params.status as "pending",
        reason: params.reason,
        createdAt: new Date().toISOString(),
      }),
    );
    return { success: true };
  };

  const approveProposedTasks = async (params: {
    meetingId: string;
    approvedTaskIds: string[];
    rejectedTaskIds: string[];
  }): Promise<{ success: boolean }> => {
    await Effect.runPromise(
      engine.dispatch({
        type: "meeting.approve-tasks",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        meetingId: params.meetingId as MeetingId,
        approvedTaskIds: params.approvedTaskIds as TaskId[],
        rejectedTaskIds: params.rejectedTaskIds as TaskId[],
        createdAt: new Date().toISOString(),
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
      engine.dispatch({
        type: "meeting.schedule",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        meetingId: meetingId as MeetingId,
        meetingType: params.meetingType as "planning",
        agenda: params.agenda,
        participants: params.participants as Array<"pm" | "developer" | "reviewer" | "tester">,
        createdAt: new Date().toISOString(),
      }),
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
    callback: (event: AgentRuntimeEventRecord) => void,
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
