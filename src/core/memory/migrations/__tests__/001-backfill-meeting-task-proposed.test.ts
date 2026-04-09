import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { run } from "../001-backfill-meeting-task-proposed";

const tempDirs: string[] = [];

function makeTempStorageDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "conclave-migration-"));
  tempDirs.push(dir);
  return dir;
}

function readAllEvents(storageDir: string): Array<Record<string, unknown>> {
  const eventsFile = join(storageDir, "events.ndjson");
  const raw = readFileSync(eventsFile, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return raw.flatMap((line) => {
    const parsed = JSON.parse(line) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  }) as Array<Record<string, unknown>>;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("migration 001 backfill meeting.task-proposed", () => {
  test("backfills distinct proposals that share meetingId, taskType, and title", () => {
    const storageDir = makeTempStorageDir();
    const eventsFile = join(storageDir, "events.ndjson");
    const completedAt = new Date().toISOString();

    const meetingCompletedEvent = {
      type: "meeting.completed",
      schemaVersion: 1,
      sequence: 1,
      eventId: "evt-1",
      aggregateKind: "meeting",
      aggregateId: "meeting-1",
      occurredAt: completedAt,
      commandId: "cmd-1",
      causationEventId: null,
      correlationId: "cmd-1",
      metadata: {},
      payload: {
        meetingId: "meeting-1",
        summary: "Meeting wrapped",
        proposedTaskIds: [],
        proposedTasks: [
          {
            taskType: "implementation",
            title: "Write unit tests",
            description: "Add happy path coverage",
            deps: [],
            input: { scope: "happy-path" },
          },
          {
            taskType: "implementation",
            title: "Write unit tests",
            description: "Add edge case coverage",
            deps: [],
            input: { scope: "edge-cases" },
          },
        ],
        completedAt,
      },
    };

    writeFileSync(eventsFile, `${JSON.stringify(meetingCompletedEvent)}\n`, "utf-8");

    run(storageDir);
    run(storageDir);

    const backfilledEvents = readAllEvents(storageDir).filter(
      (event) => event.type === "meeting.task-proposed",
    );

    expect(backfilledEvents).toHaveLength(2);

    const descriptions = backfilledEvents.map((event) => {
      const payload = event.payload as Record<string, unknown>;
      const proposedTask = payload.proposedTask as Record<string, unknown>;
      return proposedTask.description;
    });

    expect(descriptions).toContain("Add happy path coverage");
    expect(descriptions).toContain("Add edge case coverage");
  });
});
