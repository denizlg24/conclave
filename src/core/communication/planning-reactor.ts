import { Effect, Fiber, Stream, type Scope } from "effect";

import type { OrchestrationEvent } from "@/shared/types/orchestration";
import type { BusEvent } from "@/shared/types/bus-event";
import type { CommandId, MeetingId, TaskId } from "@/shared/types/base-schemas";

import type { OrchestrationEngineShape } from "../orchestrator/engine";
import type { EventBusShape } from "./event-bus";
import type { ReceiptStoreShape } from "./receipt-store";

const REACTOR_NAME = "planning-reactor";

interface ParsedTask {
  title: string;
  description: string;
  taskType: string;
  deps: number[];
}

interface ParsedPlan {
  tasks: ParsedTask[];
}

function extractPlanFromOutput(output: string): ParsedPlan | null {
  const jsonBlockRegex = /```json\s*([\s\S]*?)```/g;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRegex.exec(output)) !== null) {
    lastMatch = match;
  }

  if (!lastMatch) {
    try {
      const parsed = JSON.parse(output.trim());
      if (parsed && Array.isArray(parsed.tasks)) {
        return parsed as ParsedPlan;
      }
    } catch {}
    return null;
  }

  try {
    const parsed = JSON.parse(lastMatch[1].trim());
    if (parsed && Array.isArray(parsed.tasks)) {
      return parsed as ParsedPlan;
    }
  } catch {
    console.warn(`[${REACTOR_NAME}] Failed to parse JSON block from PM output`);
  }

  return null;
}

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

  const completeMeetingForTask = (taskInput: unknown) =>
    Effect.gen(function* () {
      const meetingId = (taskInput as Record<string, unknown> | null)
        ?.meetingId as string | undefined;
      if (!meetingId) return;

      const currentModel = yield* engine.getReadModel();
      const meeting = currentModel.meetings.find((m) => m.id === meetingId);
      if (!meeting || meeting.status !== "in_progress") return;

      yield* engine.dispatch({
        type: "meeting.complete",
        commandId: crypto.randomUUID() as CommandId,
        meetingId: meetingId as MeetingId,
        summary: "Planning meeting completed.",
        proposedTasks: [],
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
          commandId: crypto.randomUUID() as CommandId,
          taskId: task.id,
          status: "done",
          createdAt: new Date().toISOString(),
        });
        yield* completeMeetingForTask(task.input);
        return;
      }

      const plan = extractPlanFromOutput(output);
      if (!plan || plan.tasks.length === 0) {
        console.warn(
          `[${REACTOR_NAME}] Could not extract tasks from PM output for task ${task.id}`,
        );
        yield* engine.dispatch({
          type: "task.update-status",
          commandId: crypto.randomUUID() as CommandId,
          taskId: task.id,
          status: "done",
          createdAt: new Date().toISOString(),
        });
        yield* completeMeetingForTask(task.input);
        return;
      }

      console.log(
        `[${REACTOR_NAME}] Extracted ${plan.tasks.length} tasks from PM planning output`,
      );

      const taskIds = plan.tasks.map(() => crypto.randomUUID() as TaskId);

      for (let i = 0; i < plan.tasks.length; i++) {
        const planTask = plan.tasks[i];

        const resolvedDeps = (planTask.deps ?? [])
          .filter(
            (depIdx) => depIdx >= 0 && depIdx < taskIds.length && depIdx !== i,
          )
          .map((depIdx) => taskIds[depIdx]);

        const validTypes = ["implementation", "review", "testing"] as const;
        const taskType = validTypes.includes(
          planTask.taskType as (typeof validTypes)[number],
        )
          ? (planTask.taskType as (typeof validTypes)[number])
          : "implementation";

        yield* engine.dispatch({
          type: "task.create",
          commandId: crypto.randomUUID() as CommandId,
          taskId: taskIds[i],
          taskType,
          title: planTask.title || `Task ${i + 1}`,
          description: planTask.description || "",
          deps: resolvedDeps,
          input: { parentPlanningTaskId: task.id },
          createdAt: new Date().toISOString(),
        });

        console.log(
          `[${REACTOR_NAME}] Created task: "${planTask.title}" (${taskType}) with ${resolvedDeps.length} deps`,
        );
      }

      yield* engine.dispatch({
        type: "task.update-status",
        commandId: crypto.randomUUID() as CommandId,
        taskId: task.id,
        status: "done",
        createdAt: new Date().toISOString(),
      });

      yield* completeMeetingForTask(task.input);

      console.log(
        `[${REACTOR_NAME}] Planning task ${task.id} complete. Created ${plan.tasks.length} subtasks.`,
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
