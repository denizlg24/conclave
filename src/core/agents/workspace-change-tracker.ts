import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { WorkspaceChanges, WorkspaceChangeSource } from "@/shared/types/agent-runtime";

const EMPTY_WORKSPACE_CHANGES: WorkspaceChanges = {
  source: "filesystem",
  added: [],
  modified: [],
  deleted: [],
  truncated: false,
  totalCount: 0,
};

const MAX_PATHS_PER_GROUP = 50;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

type SnapshotSource = WorkspaceChangeSource;

type GitTrackingState = {
  readonly mode: "git";
  readonly workingDirectory: string;
  readonly gitRoot: string;
  readonly before: Map<string, string | null>;
};

type FilesystemTrackingState = {
  readonly mode: "filesystem";
  readonly workingDirectory: string;
  readonly before: Map<string, string>;
};

export type WorkspaceChangeTracker = {
  readonly finish: () => Promise<WorkspaceChanges>;
};

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function isInsideWorkspace(workingDirectory: string, candidatePath: string): boolean {
  const workspaceRoot = resolve(workingDirectory);
  const resolvedCandidate = resolve(candidatePath);
  if (resolvedCandidate === workspaceRoot) {
    return true;
  }

  const relativePath = relative(workspaceRoot, resolvedCandidate);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function toWorkspaceRelativePath(
  workingDirectory: string,
  absolutePath: string,
): string | null {
  if (!isInsideWorkspace(workingDirectory, absolutePath)) {
    return null;
  }

  const relativePath = normalizePath(relative(resolve(workingDirectory), absolutePath));
  return relativePath.length > 0 ? relativePath : null;
}

function hashFile(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const stats = statSync(filePath, { throwIfNoEntry: false });
  if (!stats?.isFile()) {
    return null;
  }

  const hash = createHash("sha1");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function walkWorkspace(
  workingDirectory: string,
  currentDirectory = workingDirectory,
  snapshot = new Map<string, string>(),
): Map<string, string> {
  const entries = readdirSync(currentDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      walkWorkspace(workingDirectory, absolutePath, snapshot);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = toWorkspaceRelativePath(workingDirectory, absolutePath);
    if (!relativePath) {
      continue;
    }

    const digest = hashFile(absolutePath);
    if (digest) {
      snapshot.set(relativePath, digest);
    }
  }

  return snapshot;
}

async function runGit(
  workingDirectory: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: workingDirectory,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return { exitCode, stdout, stderr };
}

async function getGitRoot(workingDirectory: string): Promise<string | null> {
  try {
    const result = await runGit(workingDirectory, ["rev-parse", "--show-toplevel"]);
    if (result.exitCode !== 0) {
      return null;
    }

    const gitRoot = result.stdout.trim();
    return gitRoot.length > 0 ? resolve(gitRoot) : null;
  } catch {
    return null;
  }
}

async function listGitWorkspacePaths(
  workingDirectory: string,
  gitRoot: string,
): Promise<Set<string> | null> {
  try {
    const result = await runGit(workingDirectory, [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ]);
    if (result.exitCode !== 0) {
      return null;
    }

    const paths = new Set<string>();

    for (const candidatePath of result.stdout
      .split("\0")
      .filter((token) => token.length > 0)) {
      const absolutePath = resolve(gitRoot, candidatePath);
      const relativePath = toWorkspaceRelativePath(workingDirectory, absolutePath);
      if (relativePath) {
        paths.add(relativePath);
      }
    }

    return paths;
  } catch {
    return null;
  }
}

function snapshotCandidatePaths(
  workingDirectory: string,
  paths: Iterable<string>,
): Map<string, string | null> {
  const snapshot = new Map<string, string | null>();

  for (const relativePath of paths) {
    const absolutePath = join(workingDirectory, relativePath);
    snapshot.set(relativePath, hashFile(absolutePath));
  }

  return snapshot;
}

function finalizeWorkspaceChanges(
  source: SnapshotSource,
  before: Map<string, string | null>,
  after: Map<string, string | null>,
): WorkspaceChanges {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  const allPaths = new Set<string>([...before.keys(), ...after.keys()]);
  const sortedPaths = [...allPaths].sort((left, right) => left.localeCompare(right));

  for (const path of sortedPaths) {
    const beforeHash = before.get(path) ?? null;
    const afterHash = after.get(path) ?? null;

    if (beforeHash === afterHash) {
      continue;
    }

    if (beforeHash === null && afterHash !== null) {
      added.push(path);
      continue;
    }

    if (beforeHash !== null && afterHash === null) {
      deleted.push(path);
      continue;
    }

    if (beforeHash !== null && afterHash !== null) {
      modified.push(path);
    }
  }

  const totalCount = added.length + modified.length + deleted.length;
  const truncate = (paths: string[]) => paths.slice(0, MAX_PATHS_PER_GROUP);

  return {
    source,
    added: truncate(added),
    modified: truncate(modified),
    deleted: truncate(deleted),
    truncated:
      added.length > MAX_PATHS_PER_GROUP ||
      modified.length > MAX_PATHS_PER_GROUP ||
      deleted.length > MAX_PATHS_PER_GROUP,
    totalCount,
  };
}

async function createGitTracker(
  workingDirectory: string,
  gitRoot: string,
): Promise<WorkspaceChangeTracker | null> {
  const beforeWorkspacePaths = await listGitWorkspacePaths(
    workingDirectory,
    gitRoot,
  );
  if (beforeWorkspacePaths === null) {
    return null;
  }

  const state: GitTrackingState = {
    mode: "git",
    workingDirectory,
    gitRoot,
    before: snapshotCandidatePaths(workingDirectory, beforeWorkspacePaths),
  };

  return {
    finish: async () => {
      const afterWorkspacePaths = await listGitWorkspacePaths(
        state.workingDirectory,
        state.gitRoot,
      );
      if (afterWorkspacePaths === null) {
        return EMPTY_WORKSPACE_CHANGES;
      }

      const candidatePaths = new Set<string>([
        ...state.before.keys(),
        ...afterWorkspacePaths,
      ]);

      const after = snapshotCandidatePaths(state.workingDirectory, candidatePaths);
      return finalizeWorkspaceChanges("git", state.before, after);
    },
  };
}

async function createFilesystemTracker(
  workingDirectory: string,
): Promise<WorkspaceChangeTracker> {
  const state: FilesystemTrackingState = {
    mode: "filesystem",
    workingDirectory,
    before: walkWorkspace(workingDirectory),
  };

  return {
    finish: async () => {
      const after = walkWorkspace(state.workingDirectory);
      return finalizeWorkspaceChanges("filesystem", state.before, new Map(after));
    },
  };
}

export async function createWorkspaceChangeTracker(
  workingDirectory: string,
): Promise<WorkspaceChangeTracker> {
  const gitRoot = await getGitRoot(workingDirectory);
  if (gitRoot) {
    const gitTracker = await createGitTracker(workingDirectory, gitRoot);
    if (gitTracker) {
      return gitTracker;
    }
  }

  return createFilesystemTracker(workingDirectory);
}

export { EMPTY_WORKSPACE_CHANGES };
