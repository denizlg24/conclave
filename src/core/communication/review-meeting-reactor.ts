import { Effect, Fiber, Stream, type Scope } from "effect";

import type {
  OrchestrationEvent,
  AgentRole,
} from "@/shared/types/orchestration";
import type { BusEvent } from "@/shared/types/bus-event";
import type { CommandId, MeetingId } from "@/shared/types/base-schemas";

import type { OrchestrationEngineShape } from "../orchestrator/engine";
import type { EventBusShape } from "./event-bus";
import type { ReceiptStoreShape } from "./receipt-store";
import type { MeetingOrchestratorShape } from "../meetings/meeting-orchestrator";

const REACTOR_NAME = "review-meeting-reactor";

function isTaskStatusUpdated(
  event: BusEvent,
): event is OrchestrationEvent & { type: "task.status-updated" } {
  return event.type === "task.status-updated";
}

export function createReviewMeetingReactor(deps: {
  readonly engine: OrchestrationEngineShape;
  readonly bus: EventBusShape;
  readonly receiptStore: ReceiptStoreShape;
  readonly meetingOrchestrator: MeetingOrchestratorShape;
}): Effect.Effect<Fiber.Fiber<void>, never, Scope.Scope> {
  const { engine, bus, receiptStore, meetingOrchestrator } = deps;

  const reviewedGroups = new Set<string>();

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

      if (payload.status !== "done" && payload.status !== "failed") return;

      const readModel = yield* engine.getReadModel();
      const task = readModel.tasks.find((t) => t.id === payload.taskId);
      if (!task) return;

      const parentPlanningTaskId = (
        task.input as Record<string, unknown> | null
      )?.parentPlanningTaskId as string | undefined;
      if (!parentPlanningTaskId) return;

      if (reviewedGroups.has(parentPlanningTaskId)) return;

      const siblings = readModel.tasks.filter((t) => {
        const parent = (t.input as Record<string, unknown> | null)
          ?.parentPlanningTaskId as string | undefined;
        return parent === parentPlanningTaskId;
      });

      const allTerminal = siblings.every(
        (t) => t.status === "done" || t.status === "failed",
      );
      if (!allTerminal) return;

      reviewedGroups.add(parentPlanningTaskId);

      const planningTask = readModel.tasks.find(
        (t) => t.id === parentPlanningTaskId,
      );
      const doneCount = siblings.filter((t) => t.status === "done").length;
      const failedCount = siblings.filter((t) => t.status === "failed").length;

      const agenda: string[] = [
        `Review completed work from: ${planningTask?.title ?? "Unknown plan"} (${doneCount} done, ${failedCount} failed)`,
        ...siblings.map((t) => {
          const statusLabel = t.status === "done" ? "Completed" : "Failed";
          const outputSnippet =
            typeof t.output === "string" ? t.output.slice(0, 300) : "";
          return `[${statusLabel}] ${t.taskType}: ${t.title}${outputSnippet ? ` — ${outputSnippet}` : ""}`;
        }),
        "Identify follow-up tasks, improvements, bugs, or technical debt discovered during implementation",
      ];

      const participantRoles = new Set<AgentRole>(["pm"]);
      for (const sibling of siblings) {
        if (sibling.ownerRole) {
          participantRoles.add(sibling.ownerRole);
        }
      }
      const participants = [...participantRoles];

      const meetingId = crypto.randomUUID() as MeetingId;

      console.log(
        `[${REACTOR_NAME}] All ${siblings.length} tasks from planning ${parentPlanningTaskId} are terminal. Scheduling review meeting ${meetingId}`,
      );

      yield* engine.dispatch({
        type: "meeting.schedule",
        commandId: crypto.randomUUID() as CommandId,
        meetingId,
        meetingType: "review",
        agenda,
        participants,
        createdAt: new Date().toISOString(),
      });

      const result = yield* meetingOrchestrator.runMeeting(meetingId);

      console.log(
        `[${REACTOR_NAME}] Review meeting ${meetingId} completed. ` +
          `Proposed ${result.proposedTaskCount} follow-up tasks.`,
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
