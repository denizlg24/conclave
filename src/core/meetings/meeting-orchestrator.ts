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

export function createMeetingOrchestrator(deps: {
  readonly engine: OrchestrationEngineShape;
  readonly agentService: AgentServiceShape;
}): MeetingOrchestratorShape {
  const { engine, agentService } = deps;

  const runMeeting: MeetingOrchestratorShape["runMeeting"] = (meetingId) =>
    Effect.gen(function* () {
      // 1. Fetch meeting from read model
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

      // 2. Dispatch meeting.start
      yield* engine
        .dispatch({
          type: "meeting.start",
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

      // 3. For each agenda item × each participant: collect contributions
      const contributions: Array<{
        agentRole: AgentRole;
        agendaItemIndex: number;
        content: string;
      }> = [];

      for (let itemIdx = 0; itemIdx < meeting.agenda.length; itemIdx++) {
        const agendaItem = meeting.agenda[itemIdx]!;

        for (const role of meeting.participants) {
          // Find an agent with this role
          const agents = yield* agentService.listAgents();
          const agent = agents.find((a) => a.role === role);
          if (!agent) continue;

          // Build context with prior contributions for this agenda item
          const priorContributions = contributions
            .filter((c) => c.agendaItemIndex === itemIdx)
            .map((c) => `**${c.agentRole}:** ${c.content}`)
            .join("\n\n");

          const prompt = [
            `## Meeting Contribution Request`,
            ``,
            `**Meeting:** ${meetingId}`,
            `**Meeting Type:** ${meeting.meetingType}`,
            `**Your Role:** ${role}`,
            `**Agenda Item ${itemIdx + 1}:** ${agendaItem}`,
            ``,
            priorContributions
              ? `### Prior Contributions\n${priorContributions}\n`
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

          // Dispatch contribution event
          yield* engine
            .dispatch({
              type: "meeting.contribute",
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

      // 4. Ask PM agent to synthesize contributions into summary + proposed tasks
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

      const synthesisPrompt = [
        `## Meeting Synthesis Request`,
        ``,
        `**Meeting:** ${meetingId}`,
        `**Meeting Type:** ${meeting.meetingType}`,
        `**Agenda:** ${meeting.agenda.join(", ")}`,
        ``,
        `### All Contributions`,
        allContributions,
        ``,
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

      // Parse the PM's response — extract JSON from the result
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
          // If parsing fails, use the raw result as summary with no proposed tasks
        }
      }

      // 5. Dispatch meeting.complete
      yield* engine
        .dispatch({
          type: "meeting.complete",
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

  return { runMeeting } satisfies MeetingOrchestratorShape;
}
