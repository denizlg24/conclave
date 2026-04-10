import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWorkspaceChangeTracker } from "../workspace-change-tracker";

const tempDirs: string[] = [];

function createTempWorkspace(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function runGit(
  workingDirectory: string,
  args: string[],
): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: workingDirectory,
    stdout: "ignore",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(stderr);
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createWorkspaceChangeTracker", () => {
  test("tracks added, modified, and deleted files inside git workspaces", async () => {
    const workspace = createTempWorkspace("conclave-git-tracker-");
    writeFileSync(join(workspace, "existing.ts"), "export const value = 1;\n", "utf8");
    writeFileSync(join(workspace, "removed.ts"), "export const oldValue = true;\n", "utf8");

    await runGit(workspace, ["init"]);
    await runGit(workspace, ["add", "."]);

    writeFileSync(join(workspace, "existing.ts"), "export const value = 2;\n", "utf8");

    const tracker = await createWorkspaceChangeTracker(workspace);

    writeFileSync(join(workspace, "existing.ts"), "export const value = 3;\n", "utf8");
    writeFileSync(join(workspace, "new-file.ts"), "export const created = true;\n", "utf8");
    unlinkSync(join(workspace, "removed.ts"));

    const changes = await tracker.finish();

    expect(changes.source).toBe("git");
    expect(changes.added).toEqual(["new-file.ts"]);
    expect(changes.modified).toEqual(["existing.ts"]);
    expect(changes.deleted).toEqual(["removed.ts"]);
    expect(changes.totalCount).toBe(3);
  });

  test("classifies edits to clean tracked files as modified", async () => {
    const workspace = createTempWorkspace("conclave-git-clean-tracker-");
    writeFileSync(join(workspace, "tracked.ts"), "export const value = 1;\n", "utf8");

    await runGit(workspace, ["init"]);
    await runGit(workspace, ["add", "."]);
    await runGit(workspace, [
      "-c",
      "user.name=Conclave Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);

    const tracker = await createWorkspaceChangeTracker(workspace);

    writeFileSync(join(workspace, "tracked.ts"), "export const value = 2;\n", "utf8");

    const changes = await tracker.finish();

    expect(changes.source).toBe("git");
    expect(changes.added).toEqual([]);
    expect(changes.modified).toEqual(["tracked.ts"]);
    expect(changes.deleted).toEqual([]);
    expect(changes.totalCount).toBe(1);
  });

  test("falls back to filesystem snapshots outside git workspaces", async () => {
    const workspace = createTempWorkspace("conclave-fs-tracker-");
    writeFileSync(join(workspace, "existing.ts"), "export const value = 1;\n", "utf8");
    writeFileSync(join(workspace, "removed.ts"), "export const oldValue = true;\n", "utf8");

    const tracker = await createWorkspaceChangeTracker(workspace);

    writeFileSync(join(workspace, "existing.ts"), "export const value = 2;\n", "utf8");
    writeFileSync(join(workspace, "new-file.ts"), "export const created = true;\n", "utf8");
    unlinkSync(join(workspace, "removed.ts"));

    const changes = await tracker.finish();

    expect(changes.source).toBe("filesystem");
    expect(changes.added).toEqual(["new-file.ts"]);
    expect(changes.modified).toEqual(["existing.ts"]);
    expect(changes.deleted).toEqual(["removed.ts"]);
    expect(changes.totalCount).toBe(3);
  });
});
