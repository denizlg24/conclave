import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createReviewFiles } from "../review-files";

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

describe("createReviewFiles", () => {
  test("persists grouped workspace changes in work summaries", () => {
    const projectPath = createTempDir("conclave-review-files-");
    const reviewFiles = createReviewFiles();

    reviewFiles.writeWorkSummary(projectPath, "planning-task-1", {
      taskId: "task-1",
      role: "developer",
      title: "Implement tracker",
      status: "done",
      output: "Completed the task.",
      workspaceChanges: {
        source: "git",
        added: ["src/new-file.ts"],
        modified: ["src/existing.ts"],
        deleted: ["src/old-file.ts"],
        truncated: false,
        totalCount: 3,
      },
    });

    const summaries = reviewFiles.readWorkSummaries(projectPath, "planning-task-1");

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.workspaceChanges?.added).toEqual(["src/new-file.ts"]);
    expect(summaries[0]?.workspaceChanges?.modified).toEqual(["src/existing.ts"]);
    expect(summaries[0]?.workspaceChanges?.deleted).toEqual(["src/old-file.ts"]);
    expect(summaries[0]?.workspaceChanges?.totalCount).toBe(3);
  });
});
