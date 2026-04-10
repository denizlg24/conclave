import { describe, expect, test } from "bun:test";

import { extractChangedFiles } from "../activity-log";

describe("extractChangedFiles", () => {
  test("surfaces top-level workspace change metadata from agent turn events", () => {
    const files = extractChangedFiles({
      type: "agent.turn.completed",
      workspaceChanges: {
        source: "git",
        added: ["src/new-file.ts"],
        modified: ["src/existing.ts"],
        deleted: ["src/old-file.ts"],
        truncated: false,
        totalCount: 3,
      },
    });

    expect(files).toEqual([
      "src/new-file.ts",
      "src/existing.ts",
      "src/old-file.ts",
    ]);
  });

  test("still reads nested artifact arrays from legacy payload shapes", () => {
    const files = extractChangedFiles({
      output: {
        artifacts: ["docs/plan.md", "src/task.ts"],
      },
    });

    expect(files).toEqual(["docs/plan.md", "src/task.ts"]);
  });
});
