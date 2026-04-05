import { Effect, Fiber, Stream, type Scope } from "effect";

import type { OrchestrationEvent } from "@/shared/types/orchestration";
import type { BusEvent } from "@/shared/types/bus-event";
import type { AgentId, CommandId, TaskId } from "@/shared/types/base-schemas";

import type { OrchestrationEngineShape } from "../orchestrator/engine";
import type { AgentServiceShape } from "../agents/service";
import type { EventBusShape } from "./event-bus";
import type { ReceiptStoreShape } from "./receipt-store";

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
}): Effect.Effect<Fiber.Fiber<void>, never, Scope.Scope> {
  const { engine, bus, receiptStore, agentService } = deps;

  const runAgentExecution = (
    agentId: AgentId,
    taskId: TaskId,
    prompt: string,
    taskType: string,
  ): void => {
    const effect = agentService
      .sendMessage(agentId, prompt, taskId)
      .pipe(
        Effect.matchEffect({
          onSuccess: (output) =>
            engine.dispatch({
              type: "task.update-status",
              commandId: crypto.randomUUID() as CommandId,
              taskId,
              status: taskType === "review" ? "done" : "review",
              output,
              createdAt: new Date().toISOString(),
            }),
          onFailure: (error) =>
            engine.dispatch({
              type: "task.update-status",
              commandId: crypto.randomUUID() as CommandId,
              taskId,
              status: "failed",
              reason: `Agent error: ${String(error)}`,
              createdAt: new Date().toISOString(),
            }),
        }),
      );

    // Run as independent promise — Effect.fork inside forkScoped streams
    // doesn't schedule child fibers in this runtime configuration
    console.log(`[${REACTOR_NAME}] Starting agent execution for task ${taskId}`);
    Effect.runPromise(effect)
      .then(() => {
        console.log(`[${REACTOR_NAME}] Agent execution completed for task ${taskId}`);
      })
      .catch((err) => {
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
        commandId: crypto.randomUUID() as CommandId,
        taskId: payload.taskId,
        status: "in_progress",
        createdAt: new Date().toISOString(),
      });

      const readModel = yield* engine.getReadModel();
      const task = readModel.tasks.find((t) => t.id === payload.taskId);
      if (!task) return;

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
        ``,
        `Please complete this task and provide your output as structured JSON.`,
      ]
        .filter(Boolean)
        .join("\n");

      runAgentExecution(payload.agentId, payload.taskId, prompt, task.taskType);
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
