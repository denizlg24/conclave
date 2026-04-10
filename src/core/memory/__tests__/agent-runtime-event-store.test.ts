import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

import { createAgentRuntimeEventStore } from "../agent-runtime-event-store";
import { makeAgentId } from "@/test-utils/factories";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createAgentRuntimeEventStore", () => {
  test("returns the latest turn completion for a task", async () => {
    const storagePath = createTempDir("conclave-agent-events-");
    const store = await Effect.runPromise(
      createAgentRuntimeEventStore({ storagePath }),
    );

    await Effect.runPromise(
      store.append({
        type: "agent.turn.completed",
        schemaVersion: 1,
        agentId: makeAgentId("agent-1"),
        sessionId: "session-1",
        taskId: "task-1" as never,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
        workspaceChanges: {
          source: "filesystem",
          added: [],
          modified: ["src/first.ts"],
          deleted: [],
          truncated: false,
          totalCount: 1,
        },
        durationMs: 10,
        costUsd: 0,
        occurredAt: "2026-04-10T00:00:00.000Z",
      }),
    );

    await Effect.runPromise(
      store.append({
        type: "agent.turn.completed",
        schemaVersion: 1,
        agentId: makeAgentId("agent-2"),
        sessionId: "session-2",
        taskId: "task-1" as never,
        usage: {
          inputTokens: 2,
          outputTokens: 2,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
        workspaceChanges: {
          source: "git",
          added: ["src/second.ts"],
          modified: [],
          deleted: [],
          truncated: false,
          totalCount: 1,
        },
        durationMs: 20,
        costUsd: 0,
        occurredAt: "2026-04-10T00:01:00.000Z",
      }),
    );

    const latest = await Effect.runPromise(
      store.findLatestTurnCompleted("task-1"),
    );

    expect(latest).not.toBeNull();
    expect(latest?.sessionId).toBe("session-2");
    expect(latest?.workspaceChanges.source).toBe("git");
    expect(latest?.workspaceChanges.added).toEqual(["src/second.ts"]);
  });
});
