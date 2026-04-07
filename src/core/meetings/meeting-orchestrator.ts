import { Effect } from "effect";

import type { AgentRole } from "@/shared/types/orchestration";
import type { CommandId, MeetingId } from "@/shared/types/base-schemas";

import type { OrchestrationEngineShape } from "../orchestrator/engine";
import type { AgentServiceShape } from "../agents/service";
import { MeetingError } from "../communication/errors";

export interface MeetingResult {
  readonly meetingId: MeetingId;
  readonly summary: string;
  readonly proposedTaskCount: number;
}

export interface MeetingOrchestratorShape {
  readonly runMeeting: (
    meetingId: MeetingId,
  ) => Effect.Effect<MeetingResult, MeetingError>;
}

// Role-specific guidance per meeting type
const ROLE_GUIDANCE: Record<string, Record<string, string>> = {
  review: {
    pm: "Evaluate overall delivery quality, completeness against the original request, and identify gaps or follow-up work needed.",
    developer: "Reflect on implementation challenges, technical debt introduced, patterns that worked well, and areas that need improvement.",
    reviewer: "Assess code quality, identify risks, architectural concerns, and suggest concrete improvements.",
    tester: "Report on test coverage, edge cases discovered, regressions found, and remaining quality concerns.",
  },
  planning: {
    pm: "Decompose the request into concrete, actionable tasks with clear dependencies.",
    developer: "Assess technical feasibility, estimate complexity, and flag potential blockers.",
    reviewer: "Identify quality risks and suggest review checkpoints.",
    tester: "Propose testing strategy, identify critical paths to validate.",
  },
  retrospective: {
    pm: "Summarize what went well and what didn't. Propose process improvements.",
    developer: "Share what helped or hindered productivity. Suggest tooling or workflow changes.",
    reviewer: "Reflect on review effectiveness and code quality trends.",
    tester: "Assess testing effectiveness and propose coverage improvements.",
  },
};

const SYNTHESIS_GUIDANCE: Record<string, string> = {
  review: "Focus on identifying concrete follow-up tasks: bug fixes, improvements, tech debt cleanup, missing test coverage, and any incomplete work.",
  planning: "Focus on creating a clear, ordered task breakdown with well-defined dependencies.",
  retrospective: "Focus on actionable process improvements and lessons learned.",
};

/**
 * Extract file paths from review meeting agenda items.
 * Agenda format includes lines like:
 * - "Work summaries available at: <path>"
 * - "Reviewer: write your review to <path>"
 */
function extractReviewPaths(agenda: readonly string[]): {
  workSummariesDir: string | null;
  reviewPath: string | null;
} {
  let workSummariesDir: string | null = null;
  let reviewPath: string | null = null;

  for (const item of agenda) {
    const summariesMatch = item.match(/Work summaries available at:\s*(.+)/);
    if (summariesMatch) {
      workSummariesDir = summariesMatch[1].trim();
    }
    const reviewMatch = item.match(/write your review to\s*(.+)/);
    if (reviewMatch) {
      reviewPath = reviewMatch[1].trim();
    }
  }

  return { workSummariesDir, reviewPath };
}

export function createMeetingOrchestrator(deps: {
  readonly engine: OrchestrationEngineShape;
  readonly agentService: AgentServiceShape;
}): MeetingOrchestratorShape {
  const { engine, agentService } = deps;

  /**
   * Optimized flow for review meetings using file-based context.
   * 
   * Instead of O(n*m) LLM calls (participants × agenda items), this uses:
   * 1. One call to reviewer to read work summaries and write review.md
   * 2. One call to PM to read review.md and synthesize proposed tasks
   * 
   * This dramatically reduces token usage for review meetings.
   */
  const runReviewMeeting = (
    meetingId: MeetingId,
    meeting: { agenda: readonly string[]; participants: readonly AgentRole[] },
  ): Effect.Effect<MeetingResult, MeetingError> =>
    Effect.gen(function* () {
      const { workSummariesDir, reviewPath } = extractReviewPaths(meeting.agenda);

      if (!workSummariesDir || !reviewPath) {
        // Fall back to standard meeting flow if paths not found
        console.log(`[meeting-orchestrator] Review meeting ${meetingId} missing file paths, using standard flow`);
        return yield* runStandardMeeting(meetingId, meeting);
      }

      // 1. Dispatch meeting.start
      yield* engine
        .dispatch({
          type: "meeting.start",
          schemaVersion: 1 as const,
          commandId: crypto.randomUUID() as CommandId,
          meetingId,
          createdAt: new Date().toISOString(),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new MeetingError({
                meetingId,
                operation: "meeting.start",
                detail: String(cause),
              }),
          ),
        );

      const agents = yield* agentService.listAgents();

      // 2. Reviewer reads work summaries and writes review
      const reviewerAgent = agents.find((a) => a.role === "reviewer");
      let reviewContent = "";

      if (reviewerAgent) {
        const reviewerPrompt = [
          `## Code Review Request`,
          ``,
          `You are conducting a review of completed work.`,
          ``,
          `### Instructions`,
          `1. Read all work summary files in: ${workSummariesDir}`,
          `2. Review the code changes referenced in each summary`,
          `3. Write your comprehensive review to: ${reviewPath}`,
          ``,
          `### Review Structure`,
          `Your review file should include:`,
          `- **Overall Assessment**: Pass/Fail with brief justification`,
          `- **Code Quality**: Observations on style, patterns, maintainability`,
          `- **Concerns**: Any bugs, security issues, or architectural problems`,
          `- **Improvements**: Suggested follow-up work`,
          ``,
          `Focus on actionable feedback. Be specific about file paths and line numbers when noting issues.`,
        ].join("\n");

        reviewContent = yield* agentService
          .sendMessage(reviewerAgent.agentId, reviewerPrompt)
          .pipe(
            Effect.mapError(
              (cause) =>
                new MeetingError({
                  meetingId,
                  operation: "meeting.contribute",
                  detail: `Reviewer failed: ${String(cause)}`,
                }),
            ),
          );

        // Dispatch contribution event
        yield* engine
          .dispatch({
            type: "meeting.contribute",
            schemaVersion: 1 as const,
            commandId: crypto.randomUUID() as CommandId,
            meetingId,
            agentRole: "reviewer",
            agendaItemIndex: 0,
            content: reviewContent,
            references: [reviewPath],
            createdAt: new Date().toISOString(),
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new MeetingError({
                  meetingId,
                  operation: "meeting.contribute",
                  detail: String(cause),
                }),
            ),
          );
      }

      // 3. PM reads review and synthesizes proposed tasks
      const pmAgent = agents.find((a) => a.role === "pm");
      if (!pmAgent) {
        return yield* Effect.fail(
          new MeetingError({
            meetingId,
            operation: "runMeeting",
            detail: "No PM agent available for meeting synthesis.",
          }),
        );
      }

      const synthesisPrompt = [
        `## Review Meeting Synthesis`,
        ``,
        `You are synthesizing a code review meeting.`,
        ``,
        `### Context`,
        `- Work summaries directory: ${workSummariesDir}`,
        `- Review file: ${reviewPath}`,
        ``,
        `### Instructions`,
        `1. Read the work summary files to understand what was completed`,
        `2. Read the review file to understand the reviewer's feedback`,
        `3. Synthesize into follow-up tasks`,
        ``,
        `### Output Format`,
        `Respond with a JSON block:`,
        `\`\`\`json`,
        `{`,
        `  "summary": "Brief summary of review outcomes",`,
        `  "proposedTasks": [`,
        `    {`,
        `      "taskType": "implementation" | "review" | "testing",`,
        `      "title": "Task title",`,
        `      "description": "What needs to be done",`,
        `      "deps": [],`,
        `      "input": {}`,
        `    }`,
        `  ]`,
        `}`,
        `\`\`\``,
        ``,
        `Include tasks for: bug fixes, improvements, tech debt, missing tests, incomplete work.`,
        `If everything looks good and no follow-up is needed, return an empty proposedTasks array.`,
      ].join("\n");

      const synthesisResult = yield* agentService
        .sendMessage(pmAgent.agentId, synthesisPrompt)
        .pipe(
          Effect.mapError(
            (cause) =>
              new MeetingError({
                meetingId,
                operation: "meeting.synthesis",
                detail: `PM synthesis failed: ${String(cause)}`,
              }),
          ),
        );

      // Parse the PM's response
      let summary = synthesisResult;
      let proposedTasks: Array<{
        taskType: "implementation" | "review" | "testing" | "planning" | "decomposition";
        title: string;
        description: string;
        deps: [];
        input: Record<string, unknown>;
      }> = [];

      const jsonMatch = synthesisResult.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch?.[1]) {
        try {
          const parsed = JSON.parse(jsonMatch[1]) as {
            summary?: string;
            proposedTasks?: typeof proposedTasks;
          };
          if (parsed.summary) summary = parsed.summary;
          if (Array.isArray(parsed.proposedTasks)) {
            proposedTasks = parsed.proposedTasks;
          }
        } catch {
          // If parsing fails, use the raw result as summary
        }
      }

      // 4. Dispatch meeting.complete
      yield* engine
        .dispatch({
          type: "meeting.complete",
          schemaVersion: 1 as const,
          commandId: crypto.randomUUID() as CommandId,
          meetingId,
          summary,
          proposedTasks: proposedTasks.map((t) => ({
            taskType: t.taskType,
            title: t.title,
            description: t.description,
            deps: t.deps,
            input: t.input,
          })),
          createdAt: new Date().toISOString(),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new MeetingError({
                meetingId,
                operation: "meeting.complete",
                detail: String(cause),
              }),
          ),
        );

      return {
        meetingId,
        summary,
        proposedTaskCount: proposedTasks.length,
      } satisfies MeetingResult;
    });

  /**
   * Standard meeting flow for non-review meetings.
   * Collects contributions from all participants on all agenda items.
   */
  const runStandardMeeting = (
    meetingId: MeetingId,
    meeting: { agenda: readonly string[]; participants: readonly AgentRole[]; meetingType?: string },
  ): Effect.Effect<MeetingResult, MeetingError> =>
    Effect.gen(function* () {
      const meetingType = meeting.meetingType ?? "planning";

      // 1. Dispatch meeting.start
      yield* engine
        .dispatch({
          type: "meeting.start",
          schemaVersion: 1 as const,
          commandId: crypto.randomUUID() as CommandId,
          meetingId,
          createdAt: new Date().toISOString(),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new MeetingError({
                meetingId,
                operation: "meeting.start",
                detail: String(cause),
              }),
          ),
        );

      // 2. For each agenda item × each participant: collect contributions
      const contributions: Array<{
        agentRole: AgentRole;
        agendaItemIndex: number;
        content: string;
      }> = [];

      for (let itemIdx = 0; itemIdx < meeting.agenda.length; itemIdx++) {
        const agendaItem = meeting.agenda[itemIdx]!;

        for (const role of meeting.participants) {
          const agents = yield* agentService.listAgents();
          const agent = agents.find((a) => a.role === role);
          if (!agent) continue;

          const priorContributions = contributions
            .filter((c) => c.agendaItemIndex === itemIdx)
            .map((c) => `**${c.agentRole}:** ${c.content}`)
            .join("\n\n");

          const roleSpecificGuidance =
            ROLE_GUIDANCE[meetingType]?.[role] ?? "";

          const prompt = [
            `## Meeting Contribution Request`,
            ``,
            `**Meeting:** ${meetingId}`,
            `**Meeting Type:** ${meetingType}`,
            `**Your Role:** ${role}`,
            `**Agenda Item ${itemIdx + 1}:** ${agendaItem}`,
            ``,
            priorContributions
              ? `### Prior Contributions\n${priorContributions}\n`
              : "",
            roleSpecificGuidance
              ? `### Your Focus\n${roleSpecificGuidance}\n`
              : "",
            `Please provide your structured contribution to this agenda item.`,
            `Focus on your role's perspective and responsibilities.`,
          ]
            .filter(Boolean)
            .join("\n");

          const content = yield* agentService
            .sendMessage(agent.agentId, prompt)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new MeetingError({
                    meetingId,
                    operation: "meeting.contribute",
                    detail: `Agent '${agent.agentId}' (${role}) failed: ${String(cause)}`,
                  }),
              ),
            );

          contributions.push({
            agentRole: role,
            agendaItemIndex: itemIdx,
            content,
          });

          yield* engine
            .dispatch({
              type: "meeting.contribute",
              schemaVersion: 1 as const,
              commandId: crypto.randomUUID() as CommandId,
              meetingId,
              agentRole: role,
              agendaItemIndex: itemIdx,
              content,
              references: [],
              createdAt: new Date().toISOString(),
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new MeetingError({
                    meetingId,
                    operation: "meeting.contribute",
                    detail: String(cause),
                  }),
              ),
            );
        }
      }

      // 3. PM synthesis
      const agents = yield* agentService.listAgents();
      const pmAgent = agents.find((a) => a.role === "pm");
      if (!pmAgent) {
        return yield* Effect.fail(
          new MeetingError({
            meetingId,
            operation: "runMeeting",
            detail: "No PM agent available for meeting synthesis.",
          }),
        );
      }

      const allContributions = contributions
        .map(
          (c) =>
            `**${c.agentRole}** on agenda item ${c.agendaItemIndex + 1}: ${c.content}`,
        )
        .join("\n\n");

      const typeGuidance = SYNTHESIS_GUIDANCE[meetingType] ?? "";

      const synthesisPrompt = [
        `## Meeting Synthesis Request`,
        ``,
        `**Meeting:** ${meetingId}`,
        `**Meeting Type:** ${meetingType}`,
        `**Agenda:** ${meeting.agenda.join(", ")}`,
        ``,
        `### All Contributions`,
        allContributions,
        ``,
        typeGuidance ? `### Synthesis Focus\n${typeGuidance}\n` : "",
        `Please synthesize all contributions into:`,
        `1. A concise summary of the meeting outcomes`,
        `2. A list of proposed tasks as JSON array:`,
        `\`\`\`json`,
        `{`,
        `  "summary": "string",`,
        `  "proposedTasks": [`,
        `    {`,
        `      "taskType": "implementation" | "review" | "testing" | "planning" | "decomposition",`,
        `      "title": "string",`,
        `      "description": "string",`,
        `      "deps": [],`,
        `      "input": {}`,
        `    }`,
        `  ]`,
        `}`,
        `\`\`\``,
      ].join("\n");

      const synthesisResult = yield* agentService
        .sendMessage(pmAgent.agentId, synthesisPrompt)
        .pipe(
          Effect.mapError(
            (cause) =>
              new MeetingError({
                meetingId,
                operation: "meeting.synthesis",
                detail: `PM synthesis failed: ${String(cause)}`,
              }),
          ),
        );

      let summary = synthesisResult;
      let proposedTasks: Array<{
        taskType: "implementation" | "review" | "testing" | "planning" | "decomposition";
        title: string;
        description: string;
        deps: [];
        input: Record<string, unknown>;
      }> = [];

      const jsonMatch = synthesisResult.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch?.[1]) {
        try {
          const parsed = JSON.parse(jsonMatch[1]) as {
            summary?: string;
            proposedTasks?: typeof proposedTasks;
          };
          if (parsed.summary) summary = parsed.summary;
          if (Array.isArray(parsed.proposedTasks)) {
            proposedTasks = parsed.proposedTasks;
          }
        } catch {
          // If parsing fails, use the raw result as summary
        }
      }

      yield* engine
        .dispatch({
          type: "meeting.complete",
          schemaVersion: 1 as const,
          commandId: crypto.randomUUID() as CommandId,
          meetingId,
          summary,
          proposedTasks: proposedTasks.map((t) => ({
            taskType: t.taskType,
            title: t.title,
            description: t.description,
            deps: t.deps,
            input: t.input,
          })),
          createdAt: new Date().toISOString(),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new MeetingError({
                meetingId,
                operation: "meeting.complete",
                detail: String(cause),
              }),
          ),
        );

      return {
        meetingId,
        summary,
        proposedTaskCount: proposedTasks.length,
      } satisfies MeetingResult;
    });

  const runMeeting: MeetingOrchestratorShape["runMeeting"] = (meetingId) =>
    Effect.gen(function* () {
      const readModel = yield* engine.getReadModel();
      const meeting = readModel.meetings.find((m) => m.id === meetingId);
      if (!meeting) {
        return yield* Effect.fail(
          new MeetingError({
            meetingId,
            operation: "runMeeting",
            detail: `Meeting '${meetingId}' not found.`,
          }),
        );
      }

      // Use optimized flow for review meetings
      if (meeting.meetingType === "review") {
        return yield* runReviewMeeting(meetingId, meeting);
      }

      // Standard flow for other meeting types
      return yield* runStandardMeeting(meetingId, {
        ...meeting,
        meetingType: meeting.meetingType,
      });
    });

  return { runMeeting } satisfies MeetingOrchestratorShape;
}
