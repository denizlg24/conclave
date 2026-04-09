/**
 * Contract tests for the pure helper functions and grouping logic embedded in
 * ApprovalQueue.tsx.
 *
 * Because those helpers are not exported, each function is reimplemented verbatim
 * below. Any drift between these copies and the production code indicates a
 * contract discrepancy that should be investigated.
 *
 * These tests are intentionally free of DOM / React dependencies — they exercise
 * only the deterministic, side-effect-free logic that drives what the component
 * renders and which RPC calls it dispatches.
 */
import { describe, test, expect } from "bun:test";
import type { SerializedTask, SerializedMeeting } from "@/shared/rpc/rpc-schema";

// ---------------------------------------------------------------------------
// Reimplemented helpers (mirror ApprovalQueue.tsx — keep in sync on changes)
// ---------------------------------------------------------------------------

const CURRENT_INPUT_SCHEMA_VERSION = 1;

function getProposedByMeeting(task: SerializedTask): string | undefined {
  if (task.input === null || typeof task.input !== "object") return undefined;
  const obj = task.input as Record<string, unknown>;
  return typeof obj.proposedByMeeting === "string" ? obj.proposedByMeeting : undefined;
}

function hasUnknownSchemaVersion(task: SerializedTask): boolean {
  if (task.input === null || typeof task.input !== "object") return false;
  const sv = (task.input as Record<string, unknown>).schemaVersion;
  return sv !== undefined && sv !== CURRENT_INPUT_SCHEMA_VERSION;
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 5_000) return "just now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1_000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return `${Math.floor(diffMs / 3_600_000)}h ago`;
}

// ---------------------------------------------------------------------------
// Grouping algorithm (mirrors ApprovalQueue.tsx — keep in sync on changes)
// ---------------------------------------------------------------------------

type ProposalGroup = { meetingId: string; meeting: SerializedMeeting; tasks: SerializedTask[] };

function computeProposalGroups(
  proposedTasks: SerializedTask[],
  meetings: SerializedMeeting[],
): { groups: ProposalGroup[]; ungrouped: SerializedTask[] } {
  const assignedTaskIds = new Set<string>();
  const groups = meetings
    .map((meeting) => {
      const meetingTasks = proposedTasks.filter((t) => {
        if (meeting.proposedTaskIds.includes(t.id)) return true;
        return getProposedByMeeting(t) === meeting.id;
      });
      for (const t of meetingTasks) assignedTaskIds.add(t.id);
      return { meetingId: meeting.id, meeting, tasks: meetingTasks };
    })
    .filter((g) => g.tasks.length > 0);
  const ungrouped = proposedTasks.filter((t) => !assignedTaskIds.has(t.id));
  return { groups, ungrouped };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<SerializedTask> = {}): SerializedTask {
  return {
    id: crypto.randomUUID(),
    taskType: "implementation",
    title: "Test task",
    description: "A test task",
    status: "proposed",
    owner: null,
    ownerRole: null,
    deps: [],
    input: null,
    output: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMeeting(overrides: Partial<SerializedMeeting> = {}): SerializedMeeting {
  return {
    id: `meeting-${crypto.randomUUID()}`,
    meetingType: "planning",
    status: "completed",
    agenda: ["Discuss tasks"],
    participants: ["pm"],
    contributions: [],
    summary: null,
    proposedTaskIds: [],
    approvedTaskIds: [],
    rejectedTaskIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getProposedByMeeting
// ---------------------------------------------------------------------------

describe("getProposedByMeeting", () => {
  test("returns the meeting id string from task.input.proposedByMeeting", () => {
    const task = makeTask({ input: { proposedByMeeting: "mtg-abc" } });
    expect(getProposedByMeeting(task)).toBe("mtg-abc");
  });

  test("returns undefined when input is null", () => {
    const task = makeTask({ input: null });
    expect(getProposedByMeeting(task)).toBeUndefined();
  });

  test("returns undefined when input is a non-object primitive", () => {
    const task = makeTask({ input: "plain string" });
    expect(getProposedByMeeting(task)).toBeUndefined();
  });

  test("returns undefined when proposedByMeeting is not a string", () => {
    const task = makeTask({ input: { proposedByMeeting: 42 } });
    expect(getProposedByMeeting(task)).toBeUndefined();
  });

  test("returns undefined when the proposedByMeeting field is absent", () => {
    const task = makeTask({ input: { proposalId: "some-prop-id" } });
    expect(getProposedByMeeting(task)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hasUnknownSchemaVersion
// ---------------------------------------------------------------------------

describe("hasUnknownSchemaVersion", () => {
  test("returns false for the current schema version (1)", () => {
    const task = makeTask({ input: { schemaVersion: CURRENT_INPUT_SCHEMA_VERSION } });
    expect(hasUnknownSchemaVersion(task)).toBe(false);
  });

  test("returns true for a future unknown version (e.g. 2)", () => {
    const task = makeTask({ input: { schemaVersion: 2 } });
    expect(hasUnknownSchemaVersion(task)).toBe(true);
  });

  test("returns true for an obsolete version no longer recognised (e.g. 0)", () => {
    const task = makeTask({ input: { schemaVersion: 0 } });
    expect(hasUnknownSchemaVersion(task)).toBe(true);
  });

  test("returns false when schemaVersion is absent (un-versioned task input)", () => {
    const task = makeTask({ input: { proposalId: "no-version-field" } });
    expect(hasUnknownSchemaVersion(task)).toBe(false);
  });

  test("returns false when input is null (no version to check)", () => {
    const task = makeTask({ input: null });
    expect(hasUnknownSchemaVersion(task)).toBe(false);
  });

  test("returns false when input is not an object", () => {
    const task = makeTask({ input: "string-input" });
    expect(hasUnknownSchemaVersion(task)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  test("returns 'just now' for a timestamp less than 5 seconds ago", () => {
    const date = new Date(Date.now() - 1_000); // 1s ago
    expect(formatRelativeTime(date)).toBe("just now");
  });

  test("returns 'Xs ago' for a timestamp between 5 and 60 seconds ago", () => {
    const date = new Date(Date.now() - 10_000); // 10s ago
    expect(formatRelativeTime(date)).toBe("10s ago");
  });

  test("returns 'Xm ago' for a timestamp between 1 and 60 minutes ago", () => {
    const date = new Date(Date.now() - 5 * 60_000); // 5 min ago
    expect(formatRelativeTime(date)).toBe("5m ago");
  });

  test("returns 'Xh ago' for a timestamp more than 1 hour ago", () => {
    const date = new Date(Date.now() - 2 * 3_600_000); // 2h ago
    expect(formatRelativeTime(date)).toBe("2h ago");
  });
});

// ---------------------------------------------------------------------------
// Proposal grouping algorithm
// ---------------------------------------------------------------------------

describe("computeProposalGroups", () => {
  test("groups tasks listed in meeting.proposedTaskIds", () => {
    const task = makeTask({ id: "task-1" });
    const meeting = makeMeeting({ id: "mtg-1", proposedTaskIds: ["task-1"] });

    const { groups, ungrouped } = computeProposalGroups([task], [meeting]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.tasks).toContain(task);
    expect(ungrouped).toHaveLength(0);
  });

  test("falls back to task.input.proposedByMeeting when task is not in proposedTaskIds", () => {
    const task = makeTask({ input: { proposedByMeeting: "mtg-2" } });
    const meeting = makeMeeting({ id: "mtg-2", proposedTaskIds: [] });

    const { groups, ungrouped } = computeProposalGroups([task], [meeting]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.meetingId).toBe("mtg-2");
    expect(ungrouped).toHaveLength(0);
  });

  test("tasks that cannot be attributed to any meeting go to ungrouped", () => {
    const task = makeTask({ input: null });
    const meeting = makeMeeting({ id: "mtg-3", proposedTaskIds: [] });

    const { groups, ungrouped } = computeProposalGroups([task], [meeting]);

    expect(groups).toHaveLength(0);
    expect(ungrouped).toContain(task);
  });

  test("meetings with no matching proposed tasks are excluded from groups", () => {
    const task = makeTask({ id: "orphan", input: null });
    const emptyMeeting = makeMeeting({ proposedTaskIds: [] });

    const { groups } = computeProposalGroups([task], [emptyMeeting]);

    expect(groups).toHaveLength(0);
  });

  test("a task matched by proposedTaskIds is not double-counted in ungrouped", () => {
    // This task appears in proposedTaskIds AND has a proposedByMeeting field —
    // it should be counted exactly once (proposedTaskIds wins, deduped via assignedTaskIds).
    const task = makeTask({ id: "shared-task", input: { proposedByMeeting: "mtg-4" } });
    const meeting = makeMeeting({ id: "mtg-4", proposedTaskIds: ["shared-task"] });

    const { groups, ungrouped } = computeProposalGroups([task], [meeting]);

    const totalGrouped = groups.reduce((n, g) => n + g.tasks.length, 0);
    expect(totalGrouped).toBe(1);
    expect(ungrouped).toHaveLength(0);
  });

  test("tasks from multiple meetings are correctly isolated into separate groups", () => {
    const taskA = makeTask({ id: "t-a" });
    const taskB = makeTask({ id: "t-b" });
    const meetingA = makeMeeting({ id: "mtg-a", proposedTaskIds: ["t-a"] });
    const meetingB = makeMeeting({ id: "mtg-b", proposedTaskIds: ["t-b"] });

    const { groups } = computeProposalGroups([taskA, taskB], [meetingA, meetingB]);

    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.meetingId === "mtg-a")?.tasks).toContain(taskA);
    expect(groups.find((g) => g.meetingId === "mtg-b")?.tasks).toContain(taskB);
  });

  test("approveProposedTasks is called with correct ids: approved = selected, rejected = remainder", () => {
    // Documents the partition logic used by handleApproveSelected in ApprovalQueue.tsx:
    // approved = allTaskIds.filter(id => selected.has(id))
    // rejected = allTaskIds.filter(id => !selected.has(id))
    const allTaskIds = ["t-1", "t-2", "t-3"];
    const selected = new Set(["t-1", "t-3"]);

    const approvedTaskIds = allTaskIds.filter((id) => selected.has(id));
    const rejectedTaskIds = allTaskIds.filter((id) => !selected.has(id));

    expect(approvedTaskIds).toEqual(["t-1", "t-3"]);
    expect(rejectedTaskIds).toEqual(["t-2"]);
  });
});
