import { Effect, Exit, Scope, Stream } from "effect";

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
import { createAgentService } from "@/core/agents/service";
import { createClaudeCodeAdapter } from "@/core/agents/claude-code-adapter";

import type {
  SerializedEvent,
  SerializedReadModel,
} from "@/shared/rpc/rpc-schema";

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Conclave system shape
// ---------------------------------------------------------------------------

export interface ConclaveShape {
  readonly engine: OrchestrationEngineShape;
  readonly bus: EventBusShape;

  readonly getSerializedState: () => Promise<SerializedReadModel>;
  readonly getSerializedEvents: (fromSequence: number) => Promise<SerializedEvent[]>;

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

  readonly onEvent: (callback: (event: SerializedEvent, model: SerializedReadModel) => void) => void;

  readonly shutdown: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export async function bootstrapConclave(): Promise<ConclaveShape> {
  const scope = Effect.runSync(Scope.make());

  const program = Effect.gen(function* () {
    const bus = yield* createEventBus();
    const engine = yield* createOrchestrationEngine({ eventBus: bus });
    const receiptStore = yield* createReceiptStore();

    const adapter = yield* createClaudeCodeAdapter();
    const agentService = createAgentService(adapter);

    // Start MVP agent sessions so reactors can auto-assign tasks
    // TODO: working directory should come from project config once projects are implemented
    const agentWorkingDirectory = process.cwd();
    for (const role of ["pm", "developer", "reviewer"] as const) {
      yield* agentService.startAgent(
        `agent-${role}` as AgentId,
        role,
        agentWorkingDirectory,
      );
    }

    // Start reactors in the scope
    yield* createOrchestratorReactor({
      engine,
      bus,
      receiptStore,
      agentService,
    }).pipe(Effect.provideService(Scope.Scope, scope));

    yield* createAgentReactor({
      engine,
      bus,
      receiptStore,
      agentService,
    }).pipe(Effect.provideService(Scope.Scope, scope));

    yield* createMeetingReactor({
      engine,
      bus,
      receiptStore,
    }).pipe(Effect.provideService(Scope.Scope, scope));

    // Event listener infrastructure
    const eventCallbacks: Array<
      (event: SerializedEvent, model: SerializedReadModel) => void
    > = [];

    // Subscribe to bus for pushing events to UI
    const allEvents = (_e: BusEvent): _e is BusEvent => true;
    const stream = bus.subscribeFiltered(allEvents);

    yield* stream.pipe(
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

    return { engine, bus, eventCallbacks };
  });

  const { engine, bus, eventCallbacks } = await Effect.runPromise(program);

  // --- Public API (plain promises for RPC) ---

  const getSerializedState = async (): Promise<SerializedReadModel> => {
    const model = await Effect.runPromise(engine.getReadModel());
    return serializeReadModel(model);
  };

  const getSerializedEvents = async (
    fromSequence: number,
  ): Promise<SerializedEvent[]> => {
    const events = await Effect.runPromise(
      engine.readEvents(fromSequence).pipe(Stream.runCollect, Effect.map((chunk) => [...chunk])),
    );
    return events.map(serializeEvent);
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
        commandId: crypto.randomUUID() as CommandId,
        meetingId: meetingId as MeetingId,
        meetingType: params.meetingType as "planning",
        agenda: params.agenda,
        participants: params.participants as Array<"pm" | "developer" | "reviewer">,
        createdAt: new Date().toISOString(),
      }),
    );
    return { meetingId };
  };

  const onEvent = (
    callback: (event: SerializedEvent, model: SerializedReadModel) => void,
  ) => {
    eventCallbacks.push(callback);
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
    getSerializedEvents,
    createTask,
    updateTaskStatus,
    approveProposedTasks,
    scheduleMeeting,
    onEvent,
    shutdown,
  };
}
