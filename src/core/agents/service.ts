import { Effect, Stream } from "effect";

import {
  defaultModelForAdapter,
  type AdapterType,
} from "@/shared/types/adapter";
import type { AgentId, TaskId } from "@/shared/types/base-schemas";
import type {
  AgentRoleConfig,
  AgentRuntimeEvent,
} from "@/shared/types/agent-runtime";
import type { AgentRole } from "@/shared/types/orchestration";

import type { AgentAdapterShape, AgentSession } from "./adapter";
import { AgentAdapterError } from "./errors";
import type { AgentError } from "./errors";

const DEFAULT_ROLE_CONFIGS: Record<
  string,
  Omit<AgentRoleConfig, "workingDirectory" | "model">
> = {
  pm: {
    role: "pm",
    systemPrompt: [
      "You are a Project Manager agent in the Conclave orchestration system.",
      "Your responsibilities: decompose user requests into atomic, actionable implementation tasks.",
      "",
      "## Rules",
      "- You CANNOT write implementation code or modify source files.",
      "- You CAN write planning documents to .conclave/planning/ for context persistence.",
      "- Each task you create must be small enough for a single developer to complete in one session.",
      "- Tasks should have clear, specific descriptions of WHAT to implement.",
      "- Identify dependencies between tasks (which tasks must complete before others can start).",
      "",
      "## Review Requirement (MANDATORY)",
      "Every task decomposition MUST include at least one 'review' type task.",
      "The review task should:",
      "- Depend on all implementation/testing tasks (so it runs after they complete)",
      "- Have a clear description of what should be reviewed",
      "- Be the final task in the dependency chain",
      "",
      "Example pattern:",
      "1. implementation task A",
      "2. implementation task B (may depend on A)",
      "3. testing task C (depends on A and/or B)",
      "4. review task D (depends on all above - this is REQUIRED)",
      "",
      "## Output Format",
      "You MUST end your response with a JSON block wrapped in ```json fences.",
      "The JSON must conform to this exact schema:",
      "",
      "```",
      "{",
      '  "tasks": [',
      "    {",
      '      "title": "Short task title",',
      '      "description": "Detailed description of what to implement",',
      '      "taskType": "implementation",',
      '      "deps": []',
      "    }",
      "  ]",
      "}",
      "```",
      "",
      "taskType must be one of: implementation, review, testing",
      "deps is an array of zero-indexed task references (e.g., [0] means this task depends on the first task in the array).",
      "",
      "## Important",
      "- Think through the decomposition carefully before producing the JSON.",
      "- Write your planning rationale to .conclave/planning/ first, then output the JSON.",
      "- Every response MUST end with the tasks JSON block. No exceptions.",
      "- NEVER forget to include a review task - it ensures quality control.",
    ].join("\n"),
    allowedTools: ["Read", "Write", "Glob", "Grep", "WebSearch", "WebFetch"],
    maxTurns: 10,
  },
  developer: {
    role: "developer",
    systemPrompt: [
      "You are a Developer agent in the Conclave orchestration system.",
      "Your responsibilities: implement code changes, fix bugs, write tests as directed by task assignments.",
      "You CANNOT modify task priorities or create new tasks outside your assignment.",
      "You work within the scope of your assigned task and report results as structured output.",
    ].join("\n"),
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "LSP"],
    maxTurns: 25,
  },
  reviewer: {
    role: "reviewer",
    systemPrompt: [
      "You are a Code Reviewer agent in the Conclave orchestration system.",
      "Your responsibilities: review code changes, check for bugs, suggest improvements, approve or reject work.",
      "You CANNOT create tasks or modify code directly.",
      "Produce structured review feedback with approve/reject decisions and specific comments.",
    ].join("\n"),
    allowedTools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 15,
  },
  tester: {
    role: "tester",
    systemPrompt: [
      "You are a QA Tester agent in the Conclave orchestration system.",
      "Your responsibilities: write tests, run test suites, verify implementations, and report test results.",
      "You CANNOT modify production code — only test files.",
      "You CAN run test commands, read source code for understanding, and create test fixtures.",
      "Produce structured test reports with pass/fail status and details on failures.",
    ].join("\n"),
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    maxTurns: 20,
  },
};

export type AgentPoolConfig = {
  readonly maxPerRole: Record<AgentRole, number>;
};

export const DEFAULT_POOL_CONFIG: AgentPoolConfig = {
  maxPerRole: {
    pm: 1,
    developer: 3,
    reviewer: 1,
    tester: 2,
  },
};

export type TeamComposition = Record<
  AgentRole,
  { max: number; active: number }
>;

export interface AgentServiceShape {
  readonly adapterType: AdapterType;

  readonly startAgent: (
    agentId: AgentId,
    role: AgentRole,
    workingDirectory: string,
    configOverrides?: Partial<AgentRoleConfig>,
  ) => Effect.Effect<AgentSession, AgentError>;

  readonly sendMessage: (
    agentId: AgentId,
    prompt: string,
    taskId?: TaskId | null,
    resumeSessionId?: string | null,
  ) => Effect.Effect<string, AgentError>;

  readonly interruptAgent: (
    agentId: AgentId,
  ) => Effect.Effect<void, AgentError>;

  readonly stopAgent: (agentId: AgentId) => Effect.Effect<void, AgentError>;

  readonly stopAll: () => Effect.Effect<void>;

  readonly getAgent: (agentId: AgentId) => Effect.Effect<AgentSession | null>;

  readonly listAgents: () => Effect.Effect<ReadonlyArray<AgentSession>>;

  readonly streamEvents: Stream.Stream<AgentRuntimeEvent>;

  readonly markBusy: (agentId: AgentId) => void;
  readonly markAvailable: (agentId: AgentId) => void;

  readonly findOrSpawnAgent: (
    role: AgentRole,
    workingDirectory: string,
    configOverrides?: Partial<AgentRoleConfig>,
  ) => Effect.Effect<AgentSession | null, AgentError>;

  readonly getTeamComposition: () => TeamComposition;

  readonly poolConfig: AgentPoolConfig;

  readonly onRosterChange: (callback: () => void) => void;
}

export function createAgentService(
  adapter: AgentAdapterShape,
  poolConfig: AgentPoolConfig = DEFAULT_POOL_CONFIG,
  defaultModel = defaultModelForAdapter(adapter.adapterType),
): AgentServiceShape {
  const busyAgents = new Set<AgentId>();
  const roleCounters = new Map<AgentRole, number>();
  const rosterCallbacks: Array<() => void> = [];

  const notifyRosterChange = () => {
    for (const cb of rosterCallbacks) cb();
  };

  const nextAgentId = (role: AgentRole): AgentId => {
    const count = (roleCounters.get(role) ?? 0) + 1;
    roleCounters.set(role, count);
    return `agent-${role}-${count}` as AgentId;
  };
  const startAgent: AgentServiceShape["startAgent"] = (
    agentId,
    role,
    workingDirectory,
    configOverrides,
  ) =>
    Effect.gen(function* () {
      const defaults = DEFAULT_ROLE_CONFIGS[role];
      if (!defaults) {
        return yield* Effect.fail(
          new AgentAdapterError({
            agentId,
            operation: "startAgent",
            detail: `No default configuration for role '${role}'.`,
          }),
        );
      }

      const config: AgentRoleConfig = {
        ...defaults,
        model: defaultModel,
        workingDirectory,
        ...configOverrides,
        role,
      };

      const session = yield* adapter.startSession(agentId, config);
      notifyRosterChange();
      return session;
    });

  const sendMessage: AgentServiceShape["sendMessage"] = (
    agentId,
    prompt,
    taskId,
    resumeSessionId,
  ) => adapter.sendMessage(agentId, prompt, taskId ?? null, resumeSessionId ?? null);

  const interruptAgent: AgentServiceShape["interruptAgent"] = (agentId) =>
    adapter.interrupt(agentId);

  const stopAgent: AgentServiceShape["stopAgent"] = (agentId) =>
    adapter.stopSession(agentId).pipe(
      Effect.tap(() => Effect.sync(notifyRosterChange)),
    );

  const stopAll: AgentServiceShape["stopAll"] = () =>
    Effect.gen(function* () {
      const sessions = yield* adapter.listSessions();
      for (const session of sessions) {
        yield* adapter.stopSession(session.agentId).pipe(Effect.ignore);
      }
    });

  const getAgent: AgentServiceShape["getAgent"] = (agentId) =>
    adapter.getSession(agentId);

  const listAgents: AgentServiceShape["listAgents"] = () =>
    adapter.listSessions();

  const streamEvents: AgentServiceShape["streamEvents"] = adapter.streamEvents;

  const markBusy = (agentId: AgentId): void => {
    busyAgents.add(agentId);
  };

  const markAvailable = (agentId: AgentId): void => {
    busyAgents.delete(agentId);
  };

  const findOrSpawnAgent: AgentServiceShape["findOrSpawnAgent"] = (
    role,
    workingDirectory,
    configOverrides,
  ) =>
    Effect.gen(function* () {
      const agents = yield* adapter.listSessions();
      const roleAgents = agents.filter((a) => a.role === role);
      const requestedModel = configOverrides?.model ?? defaultModel;

      const idle = roleAgents.find((a) => !busyAgents.has(a.agentId));
      if (idle) {
        const hasPriorTaskContext =
          idle.sessionId.length > 0 ||
          idle.turnCount > 0 ||
          idle.cumulativeUsage.inputTokens > 0 ||
          idle.cumulativeUsage.outputTokens > 0 ||
          idle.cumulativeUsage.cacheCreationInputTokens > 0 ||
          idle.cumulativeUsage.cacheReadInputTokens > 0;
        const hasRequestedModel = idle.config.model === requestedModel;

        if (!hasPriorTaskContext && hasRequestedModel) {
          return idle;
        }

        const {
          workingDirectory: _idleWorkingDirectory,
          role: _idleRole,
          ...idleConfig
        } = idle.config;

        yield* stopAgent(idle.agentId);
        return yield* startAgent(
          idle.agentId,
          role,
          workingDirectory,
          {
            ...idleConfig,
            ...configOverrides,
          },
        );
      }

      const max = poolConfig.maxPerRole[role] ?? 0;
      if (roleAgents.length >= max) {
        console.log(
          `[agent-service] Role '${role}' at capacity (${roleAgents.length}/${max}) — task will wait`,
        );
        return null;
      }

      const agentId = nextAgentId(role);
      console.log(
        `[agent-service] Spawning new ${role} agent: ${agentId} (${roleAgents.length + 1}/${max})`,
      );
      const session = yield* startAgent(
        agentId,
        role,
        workingDirectory,
        configOverrides,
      );
      return session;
    });

  const getTeamComposition = (): TeamComposition => {
    const composition = {} as Record<
      AgentRole,
      { max: number; active: number }
    >;
    for (const role of ["pm", "developer", "reviewer", "tester"] as const) {
      composition[role] = {
        max: poolConfig.maxPerRole[role] ?? 0,
        active: 0,
      };
    }

    for (const role of ["pm", "developer", "reviewer", "tester"] as const) {
      for (const agentId of busyAgents) {
        if (agentId.startsWith(`agent-${role}`)) {
          composition[role].active++;
        }
      }
    }
    return composition;
  };

  return {
    adapterType: adapter.adapterType,
    startAgent,
    sendMessage,
    interruptAgent,
    stopAgent,
    stopAll,
    getAgent,
    listAgents,
    streamEvents,
    markBusy,
    markAvailable,
    findOrSpawnAgent,
    getTeamComposition,
    poolConfig,
    onRosterChange: (cb: () => void) => {
      rosterCallbacks.push(cb);
    },
  } satisfies AgentServiceShape;
}
