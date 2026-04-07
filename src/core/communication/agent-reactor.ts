import { Effect, Fiber, Stream, type Scope } from "effect";

import type { OrchestrationEvent, AgentRole } from "@/shared/types/orchestration";
import type { BusEvent } from "@/shared/types/bus-event";
import type { AgentId, CommandId, TaskId } from "@/shared/types/base-schemas";

import type { OrchestrationEngineShape } from "../orchestrator/engine";
import type { AgentServiceShape } from "../agents/service";
import { AgentQuotaExhaustedError } from "../agents/errors";
import type { EventBusShape } from "./event-bus";
import type { ReceiptStoreShape } from "./receipt-store";
import type { SuspensionStoreShape } from "../memory/suspension-store";

const REACTOR_NAME = "agent-reactor";

function isTaskAssigned(
  event: BusEvent,
): event is OrchestrationEvent & { type: "task.assigned" } {
  return event.type === "task.assigned";
}

export function createAgentReactor(deps: {
  readonly engine: OrchestrationEngineShape;
  readonly bus: EventBusShape;
  readonly receiptStore: ReceiptStoreShape;
  readonly agentService: AgentServiceShape;
  readonly suspensionStore: SuspensionStoreShape;
}): Effect.Effect<Fiber.Fiber<void>, never, Scope.Scope> {
  const { engine, bus, receiptStore, agentService, suspensionStore } = deps;

  const handleQuotaExhausted = (
    error: AgentQuotaExhaustedError,
    taskId: TaskId,
    agentId: AgentId,
    agentRole: AgentRole,
    prompt: string,
    taskType: string,
    taskTitle: string,
  ) =>
    Effect.gen(function* () {
      console.log(`[${REACTOR_NAME}] Quota exhausted for task ${taskId}, suspending...`);

      // Save suspension context for later resume
      yield* suspensionStore.save({
        taskId,
        agentId,
        agentRole,
        claudeSessionId: error.sessionId,
        reason: "quota_exhausted",
        executionContext: {
          prompt,
          taskType,
          taskTitle,
        },
        quotaInfo: {
          adapterType: error.adapterType,
          rawMessage: error.rawMessage,
        },
      });

      // Emit quota exhausted event via bus
      yield* bus.publish({
        type: "agent.quota.exhausted",
        agentId,
        sessionId: error.sessionId,
        taskId,
        adapterType: error.adapterType,
        rawMessage: error.rawMessage,
        occurredAt: error.detectedAt,
      });

      // Transition task to suspended status
      yield* engine.dispatch({
        type: "task.update-status",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId,
        status: "suspended",
        reason: `Quota exhausted: ${error.rawMessage}`,
        createdAt: new Date().toISOString(),
      });

      console.log(`[${REACTOR_NAME}] Task ${taskId} suspended due to quota exhaustion`);
    });

  const runAgentExecution = (
    agentId: AgentId,
    taskId: TaskId,
    agentRole: AgentRole,
    prompt: string,
    taskType: string,
    taskTitle: string,
  ): void => {
    agentService.markBusy(agentId);

    const effect = agentService
      .sendMessage(agentId, prompt, taskId)
      .pipe(
        Effect.matchEffect({
          onSuccess: (output) =>
            engine.dispatch({
              type: "task.update-status",
              schemaVersion: 1 as const,
              commandId: crypto.randomUUID() as CommandId,
              taskId,
              status: taskType === "planning" ? "review" : "done",
              output,
              createdAt: new Date().toISOString(),
            }),
          onFailure: (error) => {
            // Check if this is a quota exhaustion error - suspend instead of fail
            if (error instanceof AgentQuotaExhaustedError) {
              return handleQuotaExhausted(
                error,
                taskId,
                agentId,
                agentRole,
                prompt,
                taskType,
                taskTitle,
              );
            }

            // For other errors, mark task as failed
            return engine.dispatch({
              type: "task.update-status",
              schemaVersion: 1 as const,
              commandId: crypto.randomUUID() as CommandId,
              taskId,
              status: "failed",
              reason: `Agent error: ${String(error)}`,
              createdAt: new Date().toISOString(),
            });
          },
        }),
      );

    // Run as independent promise — Effect.fork inside forkScoped streams
    // doesn't schedule child fibers in this runtime configuration
    console.log(`[${REACTOR_NAME}] Starting agent execution for task ${taskId}`);
    Effect.runPromise(effect)
      .then(() => {
        agentService.markAvailable(agentId);
        console.log(`[${REACTOR_NAME}] Agent execution completed for task ${taskId}`);
      })
      .catch((err) => {
        agentService.markAvailable(agentId);
        console.error(`[${REACTOR_NAME}] Agent execution failed for task ${taskId}:`, err);
      });
  };

  const handleAssignment = (
    event: OrchestrationEvent & { type: "task.assigned" },
  ) =>
    Effect.gen(function* () {
      const acquired = yield* receiptStore.tryAcquire(
        event.eventId,
        REACTOR_NAME,
      );
      if (!acquired) return;

      const { payload } = event;
      console.log(`[${REACTOR_NAME}] Processing assignment: task=${payload.taskId}, agent=${payload.agentId}`);

      yield* engine.dispatch({
        type: "task.update-status",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId: payload.taskId,
        status: "in_progress",
        createdAt: new Date().toISOString(),
      });

      const readModel = yield* engine.getReadModel();
      const task = readModel.tasks.find((t) => t.id === payload.taskId);
      if (!task) return;

      // Build team resources section for PM tasks
      const teamSection =
        task.taskType === "planning"
          ? (() => {
              const team = agentService.getTeamComposition();
              return [
                ``,
                `## Team Resources`,
                `You have the following agents available:`,
                `- Developers: up to ${team.developer.max} (can work in parallel on independent tasks)`,
                `- Testers: up to ${team.tester.max} (can test in parallel)`,
                `- Reviewers: ${team.reviewer.max}`,
                ``,
                `Plan your task decomposition to leverage parallel execution where possible.`,
                `Tasks with no dependencies between them will be assigned to separate agents simultaneously.`,
              ].join("\n");
            })()
          : "";

      const prompt = [
        `## Task Assignment`,
        ``,
        `**Task ID:** ${task.id}`,
        `**Type:** ${task.taskType}`,
        `**Title:** ${task.title}`,
        `**Description:** ${task.description}`,
        ``,
        task.input
          ? `**Input Context:**\n\`\`\`json\n${JSON.stringify(task.input, null, 2)}\n\`\`\``
          : "",
        teamSection,
        ``,
        `Please complete this task and provide your output as structured JSON.`,
      ]
        .filter(Boolean)
        .join("\n");

      runAgentExecution(
        payload.agentId,
        payload.taskId,
        payload.agentRole,
        prompt,
        task.taskType,
        task.title,
      );
    });

  return bus
    .subscribeFiltered(isTaskAssigned)
    .pipe(
      Stream.runForEach((event) =>
        handleAssignment(event).pipe(
          Effect.catch((error: unknown) =>
            Effect.logWarning(
              `[${REACTOR_NAME}] Failed to handle task.assigned: ${String(error)}`,
            ),
          ),
        ),
      ),
      Effect.forkScoped,
    );
}
