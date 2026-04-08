import { Effect, Fiber, Stream, type Scope } from "effect";

import type { OrchestrationEvent } from "@/shared/types/orchestration";
import type { BusEvent } from "@/shared/types/bus-event";
import type { CommandId, MeetingId } from "@/shared/types/base-schemas";

import type { OrchestrationEngineShape } from "../orchestrator/engine";
import type { EventBusShape } from "./event-bus";
import type { ReceiptStoreShape } from "./receipt-store";
import { decodePlanningOutput } from "./llm-output";

const REACTOR_NAME = "planning-reactor";

function isTaskStatusUpdated(
  event: BusEvent,
): event is OrchestrationEvent & { type: "task.status-updated" } {
  return event.type === "task.status-updated";
}

export function createPlanningReactor(deps: {
  readonly engine: OrchestrationEngineShape;
  readonly bus: EventBusShape;
  readonly receiptStore: ReceiptStoreShape;
}): Effect.Effect<Fiber.Fiber<void>, never, Scope.Scope> {
  const { engine, bus, receiptStore } = deps;

  const completeMeetingForTask = (
    taskInput: unknown,
    proposedTasks: Array<{
      taskType: "decomposition" | "implementation" | "review" | "testing" | "planning";
      title: string;
      description: string;
      deps: number[];
      input: unknown;
    }> = [],
  ) =>
    Effect.gen(function* () {
      const meetingId = (taskInput as Record<string, unknown> | null)
        ?.meetingId as string | undefined;
      if (!meetingId) return;

      const currentModel = yield* engine.getReadModel();
      const meeting = currentModel.meetings.find((m) => m.id === meetingId);
      if (!meeting || meeting.status !== "in_progress") return;

      yield* engine.dispatch({
        type: "meeting.complete",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        meetingId: meetingId as MeetingId,
        summary: "Planning meeting completed.",
        proposedTasks,
        createdAt: new Date().toISOString(),
      });

      console.log(`[${REACTOR_NAME}] Completed planning meeting ${meetingId}`);
    });

  const handleStatusUpdate = (
    event: OrchestrationEvent & { type: "task.status-updated" },
  ) =>
    Effect.gen(function* () {
      const acquired = yield* receiptStore.tryAcquire(
        event.eventId,
        REACTOR_NAME,
      );
      if (!acquired) return;

      const { payload } = event;
      if (payload.status !== "review") return;

      const readModel = yield* engine.getReadModel();
      const task = readModel.tasks.find((t) => t.id === payload.taskId);
      if (!task) return;
      if (task.taskType !== "planning") return;

      const output =
        typeof payload.output === "string"
          ? payload.output
          : typeof task.output === "string"
            ? task.output
            : null;

      if (!output) {
        console.warn(
          `[${REACTOR_NAME}] Planning task ${task.id} completed but no output found`,
        );
        yield* engine.dispatch({
          type: "task.update-status",
          schemaVersion: 1 as const,
          commandId: crypto.randomUUID() as CommandId,
          taskId: task.id,
          status: "done",
          createdAt: new Date().toISOString(),
        });
        yield* completeMeetingForTask(task.input);
        return;
      }

      const planDecode = decodePlanningOutput(output);
      if (!planDecode.data || planDecode.data.tasks.length === 0) {
        console.warn(
          `[${REACTOR_NAME}] Invalid PM planning output for task ${task.id}: ${planDecode.error ?? "empty plan"}`,
        );
        yield* engine.dispatch({
          type: "task.update-status",
          schemaVersion: 1 as const,
          commandId: crypto.randomUUID() as CommandId,
          taskId: task.id,
          status: "failed",
          reason: `Invalid planning output: ${planDecode.error ?? "No tasks proposed."}`,
          createdAt: new Date().toISOString(),
        });
        return;
      }

      const plan = planDecode.data;

      console.log(
        `[${REACTOR_NAME}] Extracted ${plan.tasks.length} tasks from PM planning output`,
      );

      const invalidTaskIndex = plan.tasks.findIndex((planTask, i) =>
        planTask.deps.some(
          (depIdx) => depIdx < 0 || depIdx >= plan.tasks.length || depIdx === i,
        ),
      );
      if (invalidTaskIndex !== -1) {
        const invalidTask = plan.tasks[invalidTaskIndex]!;
        yield* engine.dispatch({
          type: "task.update-status",
          schemaVersion: 1 as const,
          commandId: crypto.randomUUID() as CommandId,
          taskId: task.id,
          status: "failed",
          reason: `Invalid dependency indexes in planning output for task ${invalidTaskIndex + 1}: ${JSON.stringify(invalidTask.deps)}`,
          createdAt: new Date().toISOString(),
        });
        return;
      }

      const implAndTestingIndices = plan.tasks
        .map((planTask, i) =>
          planTask.taskType === "implementation" || planTask.taskType === "testing" ? i : -1,
        )
        .filter((i) => i !== -1);

      const normalizedPlanTasks = plan.tasks.map((planTask, i) => {
        if (planTask.taskType !== "review") return planTask;

        const missingDeps = implAndTestingIndices.filter(
          (depIdx) => !planTask.deps.includes(depIdx),
        );

        if (missingDeps.length === 0) {
          return planTask;
        }

        console.warn(
          `[${REACTOR_NAME}] Auto-corrected review task at index ${i}: added missing deps [${missingDeps.join(", ")}]`,
        );

        return {
          ...planTask,
          deps: [...new Set([...planTask.deps, ...missingDeps])],
        };
      });

      const proposedTasks = normalizedPlanTasks.map((planTask) => {
        return {
          taskType: planTask.taskType,
          title: planTask.title,
          description: planTask.description,
          deps: [...planTask.deps],
          input: { parentPlanningTaskId: task.id },
        };
      });

      yield* engine.dispatch({
        type: "task.update-status",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId: task.id,
        status: "done",
        createdAt: new Date().toISOString(),
      });

      yield* completeMeetingForTask(task.input, proposedTasks);

      console.log(
        `[${REACTOR_NAME}] Planning task ${task.id} complete. Proposed ${plan.tasks.length} subtasks via meeting.complete.`,
      );
    });

  return bus.subscribeFiltered(isTaskStatusUpdated).pipe(
    Stream.runForEach((event) =>
      handleStatusUpdate(event).pipe(
        Effect.catch((error: unknown) =>
          Effect.logWarning(
            `[${REACTOR_NAME}] Failed to handle task.status-updated: ${String(error)}`,
          ),
        ),
      ),
    ),
    Effect.forkScoped,
  );
}
