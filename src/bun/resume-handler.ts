import { Effect } from "effect";

import type { CommandId, TaskId } from "@/shared/types/base-schemas";
import { AgentQuotaExhaustedError } from "@/core/agents/errors";
import type { OrchestrationEngineShape } from "@/core/orchestrator/engine";
import type { AgentServiceShape } from "@/core/agents/service";
import type {
  SuspensionContext,
  SuspensionStoreShape,
} from "@/core/memory/suspension-store";
import type { EventBusShape } from "@/core/communication/event-bus";

export type ResumeHandlerDeps = {
  readonly engine: OrchestrationEngineShape;
  readonly agentService: AgentServiceShape;
  readonly suspensionStore: SuspensionStoreShape;
  readonly bus: EventBusShape;
  readonly projectPath: string;
};

export function createResumeHandler(deps: ResumeHandlerDeps) {
  const { engine, agentService, suspensionStore, bus, projectPath } = deps;

  const buildResumePrompt = (
    taskId: string,
    taskType: string,
    suspension: SuspensionContext,
  ): string =>
    [
      `## Task Continuation`,
      ``,
      suspension.sessionId
        ? `You were previously working on this task but were interrupted due to quota exhaustion. Your prior adapter session is being resumed, so you may already have partial context from before.`
        : `You were previously working on this task but were interrupted. Your prior session could not be resumed, so this is a fresh start — use the original task context below to reconstruct where you were.`,
      ``,
      `**Task ID:** ${taskId}`,
      `**Type:** ${taskType}`,
      `**Title:** ${suspension.executionContext.taskTitle}`,
      ``,
      `## Original Task Prompt`,
      ``,
      suspension.executionContext.prompt,
      ...(suspension.executionContext.partialOutput
        ? [
            ``,
            `## Partial Output (from interrupted execution)`,
            ``,
            suspension.executionContext.partialOutput,
            ``,
            `Resume from where this left off, or use it as context to avoid repeating already-completed steps.`,
          ]
        : []),
      ``,
      `Continue the task and provide your output as structured JSON.`,
    ].join("\n");

  const resumeSuspendedTask = async (
    taskId: string,
  ): Promise<{ success: boolean }> => {
    const suspension = await Effect.runPromise(
      suspensionStore.getByTask(taskId as TaskId),
    );
    if (!suspension) {
      console.warn(`[resume-handler] No suspension found for task ${taskId}`);
      return { success: false };
    }

    await Effect.runPromise(
      engine.dispatch({
        type: "task.update-status",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId: taskId as TaskId,
        status: "in_progress",
        reason: "Resumed after credits became available",
        createdAt: new Date().toISOString(),
      }),
    );

    const readModel = await Effect.runPromise(engine.getReadModel());
    const task = readModel.tasks.find((t) => t.id === taskId);
    const taskType = task?.taskType ?? suspension.executionContext.taskType;
    const { agentId, agentRole } = suspension;

    // Re-register the in-memory agent session if it was lost (e.g. after process restart).
    // The adapter's session map does not survive restarts, so agentId from the suspension
    // context may have no live session. Use try/catch so a spawn failure doesn't orphan the task.
    try {
      const existingSession = await Effect.runPromise(agentService.getAgent(agentId));
      if (!existingSession) {
        console.log(
          `[resume-handler] Agent session not found for ${agentId}, re-registering with role ${agentRole}`,
        );
        await Effect.runPromise(agentService.startAgent(agentId, agentRole, projectPath));
      }
    } catch (err) {
      // Leave the suspension record intact — it is still in the store and the task
      // must revert to suspended so it can be retried once the issue is resolved.
      console.error(
        `[resume-handler] Failed to re-register agent ${agentId}, re-suspending task ${taskId}:`,
        err,
      );
      await Effect.runPromise(
        engine.dispatch({
          type: "task.update-status",
          schemaVersion: 1 as const,
          commandId: crypto.randomUUID() as CommandId,
          taskId: taskId as TaskId,
          status: "suspended",
          reason: `Agent re-registration failed: ${String(err)}`,
          createdAt: new Date().toISOString(),
        }),
      );
      return { success: false };
    }

    agentService.markBusy(agentId);

    const prompt = buildResumePrompt(taskId, taskType, suspension);

    // suspensionStore.remove() is intentionally deferred to onSuccess.
    // The record must remain intact so that any failure path can re-suspend the task
    // without needing to re-save — the record is already there.
    Effect.runPromise(
      agentService
        .sendMessage(agentId, prompt, taskId as TaskId, suspension.sessionId)
        .pipe(
          Effect.matchEffect({
            onSuccess: (output) =>
              Effect.gen(function* () {
                // Remove only after execution confirms success, preserving recoverability.
                yield* suspensionStore.remove(taskId as TaskId);
                yield* engine.dispatch({
                  type: "task.update-status",
                  schemaVersion: 1 as const,
                  commandId: crypto.randomUUID() as CommandId,
                  taskId: taskId as TaskId,
                  status: taskType === "planning" ? "review" : "done",
                  output,
                  createdAt: new Date().toISOString(),
                });
              }),
            onFailure: (error) => {
              if (error instanceof AgentQuotaExhaustedError) {
                console.log(
                  `[resume-handler] Quota exhausted again for task ${taskId}, re-suspending...`,
                );
                return Effect.gen(function* () {
                  // Upsert with the refreshed session ID from this error.
                  yield* suspensionStore.save({
                    taskId: taskId as TaskId,
                    agentId,
                    agentRole,
                    sessionId: error.sessionId,
                    reason: "quota_exhausted",
                    executionContext: {
                      prompt: suspension.executionContext.prompt,
                      taskType,
                      taskTitle: suspension.executionContext.taskTitle,
                      partialOutput: suspension.executionContext.partialOutput,
                    },
                    quotaInfo: {
                      adapterType: error.adapterType,
                      rawMessage: error.rawMessage,
                    },
                  });
                  yield* bus.publish({
                    type: "agent.quota.exhausted",
                    schemaVersion: 1 as const,
                    agentId,
                    sessionId: error.sessionId,
                    taskId: taskId as TaskId,
                    adapterType: error.adapterType,
                    rawMessage: error.rawMessage,
                    occurredAt: error.detectedAt,
                  });
                  yield* engine.dispatch({
                    type: "task.update-status",
                    schemaVersion: 1 as const,
                    commandId: crypto.randomUUID() as CommandId,
                    taskId: taskId as TaskId,
                    status: "suspended",
                    reason: `Quota exhausted again: ${error.rawMessage}`,
                    createdAt: new Date().toISOString(),
                  });
                });
              }

              // Non-quota error: re-suspend. The record is still in the store
              // (remove() only runs on success), so no re-save is needed.
              console.error(
                `[resume-handler] Resume failed with non-quota error, re-suspending task ${taskId}: ${String(error)}`,
              );
              return engine.dispatch({
                type: "task.update-status",
                schemaVersion: 1 as const,
                commandId: crypto.randomUUID() as CommandId,
                taskId: taskId as TaskId,
                status: "suspended",
                reason: `Resume failed: ${String(error)}`,
                createdAt: new Date().toISOString(),
              });
            },
          }),
        ),
    )
      .then(() => agentService.markAvailable(agentId))
      .catch(() => agentService.markAvailable(agentId));

    return { success: true };
  };

  const retryTask = async (taskId: string): Promise<{ success: boolean }> => {
    await Effect.runPromise(
      engine.dispatch({
        type: "task.update-status",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId: taskId as TaskId,
        status: "pending",
        reason: "Manual retry",
        createdAt: new Date().toISOString(),
      }),
    );
    return { success: true };
  };

  return { resumeSuspendedTask, retryTask };
}
