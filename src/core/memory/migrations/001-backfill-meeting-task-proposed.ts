/**
 * Migration 001 — Backfill meeting.task-proposed events
 *
 * Context: Before schemaVersion 1 of `meeting.task-proposed` was introduced,
 * proposals were only embedded inside `meeting.completed` payloads (proposedTasks[]).
 * This migration reads an existing events.ndjson file and appends individual
 * `meeting.task-proposed` events for every `meeting.completed` event whose
 * proposals have no corresponding `meeting.task-proposed` event yet.
 *
 * Idempotency guarantee: the migration collects all proposals already present
 * in the event log keyed by a content hash of the full proposal payload and
 * skips any proposal that already has a matching event, so re-running is safe.
 *
 * Usage:
 *   bun run src/core/memory/migrations/001-backfill-meeting-task-proposed.ts <storagePath>
 *
 * storagePath defaults to ./.conclave/storage if not provided.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

type RawEvent = {
  type: string;
  schemaVersion: number;
  sequence: number;
  eventId: string;
  aggregateKind: string;
  aggregateId: string;
  occurredAt: string;
  commandId: string | null;
  causationEventId: string | null;
  correlationId: string | null;
  metadata: Record<string, unknown>;
  payload: Record<string, unknown>;
};

type MeetingCompletedPayload = {
  meetingId: string;
  summary: string;
  proposedTaskIds: string[];
  proposedTasks: Array<{
    taskType: string;
    title: string;
    description: string;
    deps: Array<string | number>;
    input: unknown;
  }>;
  completedAt: string;
};

type MeetingTaskProposedPayload = {
  proposalId: string;
  meetingId: string;
  agendaItemIndex: number;
  proposedTask: {
    taskType: string;
    title: string;
    description: string;
    deps: Array<string | number>;
    input: unknown;
  };
  originatingAgentRole: string;
  requiresApproval: boolean;
  proposedAt: string;
};

const EVENTS_FILE = "events.ndjson";

function loadLines(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf-8");
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function parseEvents(lines: string[]): RawEvent[] {
  return lines.flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (Array.isArray(parsed)) return parsed as RawEvent[];
      return [parsed as RawEvent];
    } catch {
      return [];
    }
  });
}

/**
 * Stable stringify with sorted object keys so semantically identical proposals
 * produce the same dedup hash regardless of property insertion order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
  return `{${entries.join(",")}}`;
}

function proposalKey(
  meetingId: string,
  proposedTask: MeetingCompletedPayload["proposedTasks"][number],
): string {
  return createHash("sha256")
    .update(
      stableStringify({
        meetingId,
        proposedTask,
      }),
    )
    .digest("hex");
}

export function run(storagePath: string): void {
  const eventsFilePath = join(storagePath, EVENTS_FILE);

  if (!existsSync(eventsFilePath)) {
    console.log(`[migration-001] No events file found at ${eventsFilePath}. Nothing to migrate.`);
    return;
  }

  const lines = loadLines(eventsFilePath);
  const events = parseEvents(lines);

  // Index all proposals that already exist in the event log
  const existingProposalKeys = new Set<string>();
  for (const event of events) {
    if (event.type === "meeting.task-proposed") {
      const p = event.payload as MeetingTaskProposedPayload;
      existingProposalKeys.add(
        proposalKey(p.meetingId, p.proposedTask),
      );
    }
  }

  const newEvents: RawEvent[] = [];
  let maxSequence = Math.max(0, ...events.map((e) => e.sequence));

  for (const event of events) {
    if (event.type !== "meeting.completed") continue;

    const payload = event.payload as MeetingCompletedPayload;

    for (const proposedTask of payload.proposedTasks) {
      const key = proposalKey(payload.meetingId, proposedTask);
      if (existingProposalKeys.has(key)) continue;

      maxSequence += 1;
      const backfilledEvent: RawEvent = {
        type: "meeting.task-proposed",
        schemaVersion: 1,
        sequence: maxSequence,
        eventId: crypto.randomUUID(),
        aggregateKind: "meeting",
        aggregateId: payload.meetingId,
        occurredAt: payload.completedAt,
        commandId: event.commandId,
        causationEventId: event.eventId,
        correlationId: event.correlationId,
        metadata: { migratedBy: "001-backfill-meeting-task-proposed" },
        payload: {
          proposalId: crypto.randomUUID(),
          meetingId: payload.meetingId,
          agendaItemIndex: 0,
          proposedTask,
          originatingAgentRole: "pm",
          requiresApproval: true,
          proposedAt: payload.completedAt,
        } satisfies MeetingTaskProposedPayload,
      };

      newEvents.push(backfilledEvent);
      existingProposalKeys.add(key);
    }
  }

  if (newEvents.length === 0) {
    console.log("[migration-001] All proposals already present. Nothing to backfill.");
    return;
  }

  // Append as a single batch line (matches the format written by PersistentEventStore)
  appendFileSync(
    eventsFilePath,
    `${JSON.stringify(newEvents)}\n`,
    "utf-8",
  );

  console.log(
    `[migration-001] Backfilled ${newEvents.length} meeting.task-proposed event(s) into ${eventsFilePath}.`,
  );
}

if (import.meta.main) {
  const storagePath = process.argv[2] ?? join(process.cwd(), ".conclave", "storage");
  run(storagePath);
}
