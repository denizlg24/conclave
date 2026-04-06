import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createDecisionLogStore,
  type DecisionLogEntry,
} from "../decision-log-store";
import { makeAgentId, makeTaskId, makeMeetingId, resetCounters } from "@/test-utils/factories";

const TEST_DIR = join(tmpdir(), `conclave-decision-log-test-${Date.now()}`);

async function runEffectAsync<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

describe("DecisionLogStore", () => {
  beforeEach(() => {
    resetCounters();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("createDecisionLogStore", () => {
    test("creates store and directory if not exists", async () => {
      const storagePath = join(TEST_DIR, "new-storage");
      expect(existsSync(storagePath)).toBe(false);

      const store = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      expect(store).toBeDefined();
      expect(existsSync(storagePath)).toBe(true);
    });

    test("starts with empty decisions", async () => {
      const storagePath = join(TEST_DIR, "empty-store");
      const store = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      const decisions = await runEffectAsync(store.getAll());

      expect(decisions).toEqual([]);
    });
  });

  describe("log", () => {
    test("logs a decision with auto-generated id and timestamp", async () => {
      const storagePath = join(TEST_DIR, "log-test");
      const store = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      const agentId = makeAgentId("test-agent");
      const taskId = makeTaskId("test-task");

      const logged = await runEffectAsync(
        store.log({
          type: "task_assignment",
          agentId,
          agentRole: "developer",
          context: { taskId },
          rationale: "Selected developer due to task type",
          outcome: "Task assigned successfully",
        }),
      );

      expect(logged.id).toBeDefined();
      expect(logged.timestamp).toBeDefined();
      expect(logged.type).toBe("task_assignment");
      expect(logged.agentId).toBe(agentId);
      expect(logged.context.taskId).toBe(taskId);
      expect(logged.rationale).toBe("Selected developer due to task type");
    });

    test("persists decision to disk after logging", async () => {
      const storagePath = join(TEST_DIR, "persist-test");
      const store = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      const agentId = makeAgentId("persist-agent");

      await runEffectAsync(
        store.log({
          type: "code_review",
          agentId,
          agentRole: "reviewer",
          context: {},
          rationale: "Code meets standards",
          outcome: "Approved",
        }),
      );

      const filePath = join(storagePath, "decisions.json");
      expect(existsSync(filePath)).toBe(true);

      const fileContent = readFileSync(filePath, "utf-8");
      const persistedDecisions = JSON.parse(fileContent) as DecisionLogEntry[];

      expect(persistedDecisions).toHaveLength(1);
      expect(persistedDecisions[0].type).toBe("code_review");
      expect(persistedDecisions[0].agentId).toBe(agentId);
    });

    test("logs multiple decisions", async () => {
      const storagePath = join(TEST_DIR, "multi-log");
      const store = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      await runEffectAsync(
        store.log({
          type: "task_decomposition",
          agentId: makeAgentId("pm"),
          agentRole: "pm",
          context: {},
          rationale: "Breaking down feature",
          outcome: "3 subtasks created",
        }),
      );

      await runEffectAsync(
        store.log({
          type: "task_assignment",
          agentId: makeAgentId("orchestrator"),
          agentRole: "pm",
          context: { taskId: makeTaskId("subtask-1") },
          rationale: "Assigning to developer",
          outcome: "Assigned",
        }),
      );

      const all = await runEffectAsync(store.getAll());
      expect(all).toHaveLength(2);
    });
  });

  describe("getByTask", () => {
    test("filters decisions by taskId", async () => {
      const storagePath = join(TEST_DIR, "by-task");
      const store = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      const taskId1 = makeTaskId("task-1");
      const taskId2 = makeTaskId("task-2");

      await runEffectAsync(
        store.log({
          type: "task_assignment",
          agentId: makeAgentId("a1"),
          agentRole: "pm",
          context: { taskId: taskId1 },
          rationale: "First task",
          outcome: "Done",
        }),
      );

      await runEffectAsync(
        store.log({
          type: "code_review",
          agentId: makeAgentId("a2"),
          agentRole: "reviewer",
          context: { taskId: taskId2 },
          rationale: "Second task",
          outcome: "Done",
        }),
      );

      await runEffectAsync(
        store.log({
          type: "test_result",
          agentId: makeAgentId("a3"),
          agentRole: "tester",
          context: { taskId: taskId1 },
          rationale: "Testing first task",
          outcome: "Passed",
        }),
      );

      const task1Decisions = await runEffectAsync(store.getByTask(taskId1));

      expect(task1Decisions).toHaveLength(2);
      expect(task1Decisions.every((d) => d.context.taskId === taskId1)).toBe(true);
    });
  });

  describe("getByAgent", () => {
    test("filters decisions by agentId", async () => {
      const storagePath = join(TEST_DIR, "by-agent");
      const store = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      const agent1 = makeAgentId("agent-1");
      const agent2 = makeAgentId("agent-2");

      await runEffectAsync(
        store.log({
          type: "task_assignment",
          agentId: agent1,
          agentRole: "pm",
          context: {},
          rationale: "Agent 1 decision",
          outcome: "Done",
        }),
      );

      await runEffectAsync(
        store.log({
          type: "code_review",
          agentId: agent2,
          agentRole: "reviewer",
          context: {},
          rationale: "Agent 2 decision",
          outcome: "Done",
        }),
      );

      const agent1Decisions = await runEffectAsync(store.getByAgent(agent1));

      expect(agent1Decisions).toHaveLength(1);
      expect(agent1Decisions[0].agentId).toBe(agent1);
    });
  });

  describe("getByMeeting", () => {
    test("filters decisions by meetingId", async () => {
      const storagePath = join(TEST_DIR, "by-meeting");
      const store = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      const meetingId = makeMeetingId("mtg-1");

      await runEffectAsync(
        store.log({
          type: "meeting_summary",
          agentId: makeAgentId("pm"),
          agentRole: "pm",
          context: { meetingId },
          rationale: "Summary of planning meeting",
          outcome: "Tasks proposed",
        }),
      );

      await runEffectAsync(
        store.log({
          type: "task_assignment",
          agentId: makeAgentId("pm"),
          agentRole: "pm",
          context: {},
          rationale: "Unrelated",
          outcome: "Done",
        }),
      );

      const meetingDecisions = await runEffectAsync(store.getByMeeting(meetingId));

      expect(meetingDecisions).toHaveLength(1);
      expect(meetingDecisions[0].context.meetingId).toBe(meetingId);
    });
  });

  describe("getRecent", () => {
    test("returns last N decisions", async () => {
      const storagePath = join(TEST_DIR, "recent");
      const store = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      for (let i = 1; i <= 5; i++) {
        await runEffectAsync(
          store.log({
            type: "task_assignment",
            agentId: makeAgentId(`agent-${i}`),
            agentRole: "pm",
            context: {},
            rationale: `Decision ${i}`,
            outcome: "Done",
          }),
        );
      }

      const recent = await runEffectAsync(store.getRecent(2));

      expect(recent).toHaveLength(2);
      expect(recent[0].rationale).toBe("Decision 4");
      expect(recent[1].rationale).toBe("Decision 5");
    });
  });

  describe("persistence and reload", () => {
    test("reloads decisions from disk on new store creation", async () => {
      const storagePath = join(TEST_DIR, "reload-test");

      // First store: log decisions
      const store1 = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      const agentId = makeAgentId("persist-agent");
      await runEffectAsync(
        store1.log({
          type: "task_decomposition",
          agentId,
          agentRole: "pm",
          context: {},
          rationale: "Persisted decision",
          outcome: "Done",
        }),
      );

      // Second store: should reload from disk
      const store2 = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      const decisions = await runEffectAsync(store2.getAll());

      expect(decisions).toHaveLength(1);
      expect(decisions[0].agentId).toBe(agentId);
      expect(decisions[0].rationale).toBe("Persisted decision");
    });

    test("handles corrupted JSON gracefully by starting fresh", async () => {
      const storagePath = join(TEST_DIR, "corrupted");
      mkdirSync(storagePath, { recursive: true });

      // Write corrupted JSON
      const filePath = join(storagePath, "decisions.json");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, "{ not valid json", "utf-8");

      // Should not throw, should start fresh
      const store = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      const decisions = await runEffectAsync(store.getAll());

      expect(decisions).toEqual([]);
    });

    test("logged decision includes optional artifacts", async () => {
      const storagePath = join(TEST_DIR, "artifacts");
      const store = await runEffectAsync(
        createDecisionLogStore({ storagePath }),
      );

      const logged = await runEffectAsync(
        store.log({
          type: "code_review",
          agentId: makeAgentId("reviewer"),
          agentRole: "reviewer",
          context: {},
          rationale: "Changes look good",
          outcome: "Approved",
          artifacts: ["src/main.ts", "src/utils.ts"],
        }),
      );

      expect(logged.artifacts).toEqual(["src/main.ts", "src/utils.ts"]);
    });
  });
});
