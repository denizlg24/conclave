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
import { createReviewFiles } from "./review-files";

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
  readonly projectPath: string;
}): Effect.Effect<Fiber.Fiber<void>, never, Scope.Scope> {
  const { engine, bus, receiptStore, meetingOrchestrator, projectPath } = deps;
  const reviewFiles = createReviewFiles();

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

      // Write work summary file for this completed task
      const taskOutput = typeof task.output === "string" ? task.output : JSON.stringify(task.output ?? "");
      try {
        reviewFiles.writeWorkSummary(projectPath, parentPlanningTaskId, {
          taskId: task.id,
          role: task.ownerRole ?? "unknown",
          title: task.title,
          status: task.status as "done" | "failed",
          output: taskOutput.slice(0, 5000), // Truncate very long outputs
        });
        console.log(`[${REACTOR_NAME}] Wrote work summary for task ${task.id}`);
      } catch (err) {
        console.error(`[${REACTOR_NAME}] Failed to write work summary for task ${task.id}:`, err);
      }

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
      const parentMeeting = !planningTask
        ? readModel.meetings.find((m) => m.id === parentPlanningTaskId)
        : undefined;
      const doneCount = siblings.filter((t) => t.status === "done").length;
      const failedCount = siblings.filter((t) => t.status === "failed").length;

      // Build lightweight agenda that references file paths instead of embedding content
      const workSummariesDir = reviewFiles.getWorkSummariesDir(projectPath, parentPlanningTaskId);
      const reviewPath = reviewFiles.getReviewPath(projectPath, parentPlanningTaskId);
      
      const agenda: string[] = [
        `Review completed work from: ${planningTask?.title ?? parentMeeting?.summary?.slice(0, 100) ?? "follow-up tasks"} (${doneCount} done, ${failedCount} failed)`,
        `Work summaries available at: ${workSummariesDir}`,
        ...siblings.map((t) => {
          const statusLabel = t.status === "done" ? "Completed" : "Failed";
          return `[${statusLabel}] ${t.taskType}: ${t.title} (${t.id})`;
        }),
        `Reviewer: write your review to ${reviewPath}`,
        "Identify follow-up tasks, improvements, bugs, or technical debt discovered during implementation",
      ];

      // Always include reviewer in review meetings
      const participantRoles = new Set<AgentRole>(["pm", "reviewer"]);
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
        schemaVersion: 1 as const,
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
