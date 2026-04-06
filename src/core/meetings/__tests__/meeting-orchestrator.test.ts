import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Exit, Cause, Stream } from "effect";

import { createMeetingOrchestrator } from "../meeting-orchestrator";
import { MeetingError } from "../../communication/errors";
import type { OrchestrationEngineShape } from "../../orchestrator/engine";
import type { AgentServiceShape } from "../../agents/service";
import type { OrchestrationReadModel, AgentRole } from "@/shared/types/orchestration";
import type { AgentSession } from "../../agents/adapter";
import {
  resetCounters,
  makeMeetingId,
  makeAgentId,
  makeMeeting,
  makeEmptyReadModel,
  makeAgentSession,
} from "@/test-utils/factories";
import type { AgentId } from "@/shared/types/base-schemas";

function extractError<E>(exit: Exit.Exit<unknown, E>): E | undefined {
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason);
    return fail?.error as E | undefined;
  }
  return undefined;
}

type MockEngine = {
  readModel: OrchestrationReadModel;
  dispatchedCommands: Array<{ type: string }>;
};

function createMockEngine(initialReadModel?: OrchestrationReadModel): {
  engine: OrchestrationEngineShape;
  mock: MockEngine;
} {
  const mock: MockEngine = {
    readModel: initialReadModel ?? makeEmptyReadModel(),
    dispatchedCommands: [],
  };

  const engine: OrchestrationEngineShape = {
    getReadModel: () => Effect.succeed(mock.readModel),
    dispatch: (command) =>
      Effect.gen(function* () {
        mock.dispatchedCommands.push({ type: command.type });
        return { sequence: mock.dispatchedCommands.length, events: [] };
      }),
    readEvents: () => Stream.empty,
    replay: () => Effect.succeed(mock.readModel),
  };

  return { engine, mock };
}

type MockAgentService = {
  agents: AgentSession[];
  messages: Array<{ agentId: AgentId; prompt: string }>;
  responses: Map<string, string>;
};

function createMockAgentService(
  initialAgents?: AgentSession[],
  responseMap?: Map<string, string>,
): {
  service: AgentServiceShape;
  mock: MockAgentService;
} {
  const mock: MockAgentService = {
    agents: initialAgents ?? [],
    messages: [],
    responses: responseMap ?? new Map(),
  };

  const service: AgentServiceShape = {
    startAgent: () => Effect.succeed(makeAgentSession()),
    sendMessage: (agentId, prompt) =>
      Effect.gen(function* () {
        mock.messages.push({ agentId, prompt });
        // Return a canned response or a default
        const response = mock.responses.get(agentId) ?? "Default response from agent";
        return response;
      }),
    interruptAgent: () => Effect.succeed(undefined),
    stopAgent: () => Effect.succeed(undefined),
    stopAll: () => Effect.succeed(undefined),
    getAgent: (agentId) => {
      const agent = mock.agents.find((a) => a.agentId === agentId);
      return Effect.succeed(agent ?? null);
    },
    listAgents: () => Effect.succeed(mock.agents),
    streamEvents: Stream.empty,
    markBusy: () => {},
    markAvailable: () => {},
    findOrSpawnAgent: () => Effect.succeed(makeAgentSession()),
    getTeamComposition: () => ({
      pm: { max: 1, active: 0 },
      developer: { max: 3, active: 0 },
      reviewer: { max: 1, active: 0 },
      tester: { max: 2, active: 0 },
    }),
    poolConfig: {
      maxPerRole: { pm: 1, developer: 3, reviewer: 1, tester: 2 },
    },
    onRosterChange: () => {},
  };

  return { service, mock };
}

describe("MeetingOrchestrator", () => {
  beforeEach(() => {
    resetCounters();
  });

  describe("runMeeting", () => {
    test("fails if meeting not found", async () => {
      const { engine } = createMockEngine();
      const { service } = createMockAgentService();

      const orchestrator = createMeetingOrchestrator({ engine, agentService: service });
      const meetingId = makeMeetingId("nonexistent");

      const exit = await Effect.runPromiseExit(orchestrator.runMeeting(meetingId));

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      expect(error).toBeInstanceOf(MeetingError);
      expect((error as MeetingError).detail).toContain("not found");
    });

    test("dispatches meeting.start command", async () => {
      const meetingId = makeMeetingId("meeting-1");
      const meeting = makeMeeting({
        id: meetingId,
        agenda: ["Discuss requirements"] as (string & { readonly TrimmedNonEmptyString: unique symbol })[],
        participants: ["pm"] as AgentRole[],
      });
      const readModel = {
        ...makeEmptyReadModel(),
        meetings: [meeting],
      };

      const { engine, mock: engineMock } = createMockEngine(readModel);
      const pmAgent = makeAgentSession({ agentId: makeAgentId("pm-1"), role: "pm" });
      const { service, mock: serviceMock } = createMockAgentService([pmAgent]);

      // Set up PM to return a valid synthesis response
      serviceMock.responses.set(
        pmAgent.agentId,
        '```json\n{"summary": "Meeting completed", "proposedTasks": []}\n```',
      );

      const orchestrator = createMeetingOrchestrator({ engine, agentService: service });

      await Effect.runPromise(orchestrator.runMeeting(meetingId));

      const startCommand = engineMock.dispatchedCommands.find((c) => c.type === "meeting.start");
      expect(startCommand).toBeDefined();
    });

    test("collects contributions from all participants", async () => {
      const meetingId = makeMeetingId("meeting-2");
      const meeting = makeMeeting({
        id: meetingId,
        agenda: ["Item 1"] as (string & { readonly TrimmedNonEmptyString: unique symbol })[],
        participants: ["pm", "developer"] as AgentRole[],
      });
      const readModel = {
        ...makeEmptyReadModel(),
        meetings: [meeting],
      };

      const { engine } = createMockEngine(readModel);
      const pmAgent = makeAgentSession({ agentId: makeAgentId("pm-agent"), role: "pm" });
      const devAgent = makeAgentSession({ agentId: makeAgentId("dev-agent"), role: "developer" });
      const { service, mock: serviceMock } = createMockAgentService([pmAgent, devAgent]);

      serviceMock.responses.set(pmAgent.agentId, '```json\n{"summary": "Done", "proposedTasks": []}\n```');
      serviceMock.responses.set(devAgent.agentId, "Developer contribution");

      const orchestrator = createMeetingOrchestrator({ engine, agentService: service });

      await Effect.runPromise(orchestrator.runMeeting(meetingId));

      // Should have contributions from both pm and developer
      const pmMessages = serviceMock.messages.filter((m) => m.agentId === pmAgent.agentId);
      const devMessages = serviceMock.messages.filter((m) => m.agentId === devAgent.agentId);

      expect(pmMessages.length).toBeGreaterThanOrEqual(1);
      expect(devMessages.length).toBeGreaterThanOrEqual(1);
    });

    test("dispatches meeting.contribute for each contribution", async () => {
      const meetingId = makeMeetingId("meeting-3");
      const meeting = makeMeeting({
        id: meetingId,
        agenda: ["Item 1"] as (string & { readonly TrimmedNonEmptyString: unique symbol })[],
        participants: ["pm"] as AgentRole[],
      });
      const readModel = {
        ...makeEmptyReadModel(),
        meetings: [meeting],
      };

      const { engine, mock: engineMock } = createMockEngine(readModel);
      const pmAgent = makeAgentSession({ agentId: makeAgentId("pm-agent"), role: "pm" });
      const { service, mock: serviceMock } = createMockAgentService([pmAgent]);

      serviceMock.responses.set(pmAgent.agentId, '```json\n{"summary": "Done", "proposedTasks": []}\n```');

      const orchestrator = createMeetingOrchestrator({ engine, agentService: service });

      await Effect.runPromise(orchestrator.runMeeting(meetingId));

      const contributeCommands = engineMock.dispatchedCommands.filter(
        (c) => c.type === "meeting.contribute",
      );
      expect(contributeCommands.length).toBeGreaterThanOrEqual(1);
    });

    test("fails if no PM agent available for synthesis", async () => {
      const meetingId = makeMeetingId("meeting-4");
      const meeting = makeMeeting({
        id: meetingId,
        agenda: ["Item 1"] as (string & { readonly TrimmedNonEmptyString: unique symbol })[],
        participants: ["developer"] as AgentRole[], // No PM participant
      });
      const readModel = {
        ...makeEmptyReadModel(),
        meetings: [meeting],
      };

      const { engine } = createMockEngine(readModel);
      // Only have a developer agent, no PM
      const devAgent = makeAgentSession({ agentId: makeAgentId("dev-agent"), role: "developer" });
      const { service } = createMockAgentService([devAgent]);

      const orchestrator = createMeetingOrchestrator({ engine, agentService: service });

      const exit = await Effect.runPromiseExit(orchestrator.runMeeting(meetingId));

      expect(Exit.isFailure(exit)).toBe(true);
      const error = extractError(exit);
      expect(error).toBeInstanceOf(MeetingError);
      expect((error as MeetingError).detail).toContain("No PM agent");
    });

    test("dispatches meeting.complete with summary", async () => {
      const meetingId = makeMeetingId("meeting-5");
      const meeting = makeMeeting({
        id: meetingId,
        agenda: ["Plan sprint"] as (string & { readonly TrimmedNonEmptyString: unique symbol })[],
        participants: ["pm"] as AgentRole[],
      });
      const readModel = {
        ...makeEmptyReadModel(),
        meetings: [meeting],
      };

      const { engine, mock: engineMock } = createMockEngine(readModel);
      const pmAgent = makeAgentSession({ agentId: makeAgentId("pm-agent"), role: "pm" });
      const { service, mock: serviceMock } = createMockAgentService([pmAgent]);

      serviceMock.responses.set(
        pmAgent.agentId,
        '```json\n{"summary": "Sprint planned successfully", "proposedTasks": []}\n```',
      );

      const orchestrator = createMeetingOrchestrator({ engine, agentService: service });

      await Effect.runPromise(orchestrator.runMeeting(meetingId));

      const completeCommand = engineMock.dispatchedCommands.find(
        (c) => c.type === "meeting.complete",
      );
      expect(completeCommand).toBeDefined();
    });

    test("returns MeetingResult with summary and proposed task count", async () => {
      const meetingId = makeMeetingId("meeting-6");
      const meeting = makeMeeting({
        id: meetingId,
        agenda: ["Review tasks"] as (string & { readonly TrimmedNonEmptyString: unique symbol })[],
        participants: ["pm"] as AgentRole[],
      });
      const readModel = {
        ...makeEmptyReadModel(),
        meetings: [meeting],
      };

      const { engine } = createMockEngine(readModel);
      const pmAgent = makeAgentSession({ agentId: makeAgentId("pm-agent"), role: "pm" });
      const { service, mock: serviceMock } = createMockAgentService([pmAgent]);

      const synthesisResponse = JSON.stringify({
        summary: "Tasks reviewed and approved",
        proposedTasks: [
          {
            taskType: "implementation",
            title: "Implement feature X",
            description: "Build the X feature",
            deps: [],
            input: {},
          },
          {
            taskType: "testing",
            title: "Test feature X",
            description: "Write tests for X",
            deps: [],
            input: {},
          },
        ],
      });
      serviceMock.responses.set(pmAgent.agentId, `\`\`\`json\n${synthesisResponse}\n\`\`\``);

      const orchestrator = createMeetingOrchestrator({ engine, agentService: service });

      const result = await Effect.runPromise(orchestrator.runMeeting(meetingId));

      expect(result.meetingId).toBe(meetingId);
      expect(result.summary).toBe("Tasks reviewed and approved");
      expect(result.proposedTaskCount).toBe(2);
    });

    test("handles malformed PM synthesis gracefully", async () => {
      const meetingId = makeMeetingId("meeting-7");
      const meeting = makeMeeting({
        id: meetingId,
        agenda: ["Discuss"] as (string & { readonly TrimmedNonEmptyString: unique symbol })[],
        participants: ["pm"] as AgentRole[],
      });
      const readModel = {
        ...makeEmptyReadModel(),
        meetings: [meeting],
      };

      const { engine } = createMockEngine(readModel);
      const pmAgent = makeAgentSession({ agentId: makeAgentId("pm-agent"), role: "pm" });
      const { service, mock: serviceMock } = createMockAgentService([pmAgent]);

      // Return invalid JSON
      serviceMock.responses.set(pmAgent.agentId, "Just some plain text without JSON");

      const orchestrator = createMeetingOrchestrator({ engine, agentService: service });

      const result = await Effect.runPromise(orchestrator.runMeeting(meetingId));

      // Should not fail, but use raw response as summary with 0 proposed tasks
      expect(result.meetingId).toBe(meetingId);
      expect(result.summary).toBe("Just some plain text without JSON");
      expect(result.proposedTaskCount).toBe(0);
    });
  });
});
