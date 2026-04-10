import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { WorkspaceChanges } from "@/shared/types/agent-runtime";

/**
 * Manages the .conclave/reviews/ directory structure for file-based context handoff
 * during review meetings. This reduces token usage by having agents read/write files
 * instead of passing full context through meeting prompts.
 *
 * Directory structure:
 * .conclave/
 *   reviews/
 *     {parentPlanningTaskId}/
 *       work-summaries/
 *         {taskId}-{role}.md    # Each task's completion summary
 *       review.md               # Reviewer's final review
 *       meeting-synthesis.md    # PM's meeting outcome with proposed tasks
 */

export interface WorkSummary {
  readonly taskId: string;
  readonly role: string;
  readonly title: string;
  readonly status: "done" | "failed";
  readonly output: string;
  readonly workspaceChanges?: WorkspaceChanges;
}

export interface ReviewFilesShape {
  /**
   * Ensures the reviews directory structure exists for a parent planning task.
   */
  readonly ensureReviewDir: (projectPath: string, parentPlanningTaskId: string) => string;

  /**
   * Writes a work summary file when a task completes.
   */
  readonly writeWorkSummary: (
    projectPath: string,
    parentPlanningTaskId: string,
    summary: WorkSummary,
  ) => string;

  /**
   * Gets the path to the work-summaries directory for reading.
   */
  readonly getWorkSummariesDir: (projectPath: string, parentPlanningTaskId: string) => string;

  /**
   * Reads all work summaries for a parent planning task.
   */
  readonly readWorkSummaries: (projectPath: string, parentPlanningTaskId: string) => WorkSummary[];

  /**
   * Writes the reviewer's final review.
   */
  readonly writeReview: (
    projectPath: string,
    parentPlanningTaskId: string,
    reviewContent: string,
  ) => string;

  /**
   * Gets the path to the review file.
   */
  readonly getReviewPath: (projectPath: string, parentPlanningTaskId: string) => string;

  /**
   * Reads the reviewer's review if it exists.
   */
  readonly readReview: (projectPath: string, parentPlanningTaskId: string) => string | null;

  /**
   * Writes the PM's meeting synthesis.
   */
  readonly writeMeetingSynthesis: (
    projectPath: string,
    parentPlanningTaskId: string,
    synthesisContent: string,
  ) => string;

  /**
   * Gets the path to the meeting synthesis file.
   */
  readonly getMeetingSynthesisPath: (projectPath: string, parentPlanningTaskId: string) => string;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getReviewsBaseDir(projectPath: string, parentPlanningTaskId: string): string {
  return join(projectPath, ".conclave", "reviews", parentPlanningTaskId);
}

export function createReviewFiles(): ReviewFilesShape {
  const ensureReviewDir = (projectPath: string, parentPlanningTaskId: string): string => {
    const baseDir = getReviewsBaseDir(projectPath, parentPlanningTaskId);
    const summariesDir = join(baseDir, "work-summaries");
    ensureDir(summariesDir);
    return baseDir;
  };

  const writeWorkSummary = (
    projectPath: string,
    parentPlanningTaskId: string,
    summary: WorkSummary,
  ): string => {
    const baseDir = ensureReviewDir(projectPath, parentPlanningTaskId);
    const summariesDir = join(baseDir, "work-summaries");
    
    // Sanitize taskId for filename (remove special chars)
    const safeTaskId = summary.taskId.replace(/[^a-zA-Z0-9-]/g, "_");
    const filename = `${safeTaskId}-${summary.role}.md`;
    const filepath = join(summariesDir, filename);

    const content = [
      `# Task: ${summary.title}`,
      "",
      `**Task ID:** ${summary.taskId}`,
      `**Role:** ${summary.role}`,
      `**Status:** ${summary.status}`,
      "",
      "## Output",
      "",
      summary.output || "(No output provided)",
      "",
      ...(summary.workspaceChanges &&
      summary.workspaceChanges.totalCount > 0
        ? [
            "## Workspace Changes",
            "",
            ...([
              ["Added", summary.workspaceChanges.added],
              ["Modified", summary.workspaceChanges.modified],
              ["Deleted", summary.workspaceChanges.deleted],
            ] as const).flatMap(([label, paths]) =>
              paths.length > 0
                ? [`### ${label}`, "", ...paths.map((path) => `- ${path}`), ""]
                : [],
            ),
          ]
        : []),
    ].join("\n");

    writeFileSync(filepath, content, "utf-8");
    return filepath;
  };

  const getWorkSummariesDir = (projectPath: string, parentPlanningTaskId: string): string => {
    return join(getReviewsBaseDir(projectPath, parentPlanningTaskId), "work-summaries");
  };

  const readWorkSummaries = (projectPath: string, parentPlanningTaskId: string): WorkSummary[] => {
    const summariesDir = getWorkSummariesDir(projectPath, parentPlanningTaskId);
    if (!existsSync(summariesDir)) {
      return [];
    }

    const files = readdirSync(summariesDir).filter((f) => f.endsWith(".md"));
    const summaries: WorkSummary[] = [];

    for (const file of files) {
      const content = readFileSync(join(summariesDir, file), "utf-8");
      
      // Parse the markdown format back to WorkSummary
      const titleMatch = content.match(/^# Task: (.+)$/m);
      const taskIdMatch = content.match(/\*\*Task ID:\*\* (.+)$/m);
      const roleMatch = content.match(/\*\*Role:\*\* (.+)$/m);
      const statusMatch = content.match(/\*\*Status:\*\* (done|failed)$/m);
      const outputMatch = content.match(/## Output\s+(.+?)(?=\n## |$)/s);
      const workspaceChangesMatch = content.match(
        /## Workspace Changes\s+([\s\S]+?)(?=\n## |$)/,
      );
      const filesMatch = content.match(/## Files Modified\s+([\s\S]+?)(?=\n## |$)/);

      if (taskIdMatch && roleMatch && statusMatch) {
        const workspaceChanges = (() => {
          if (workspaceChangesMatch) {
            const extractSection = (label: string): string[] => {
              const section = workspaceChangesMatch[1].match(
                new RegExp(`### ${label}\\s+([\\s\\S]+?)(?=\\n### |$)`),
              );
              if (!section) {
                return [];
              }

              return section[1]
                .split("\n")
                .filter((line) => line.startsWith("- "))
                .map((line) => line.slice(2).trim());
            };

            const added = extractSection("Added");
            const modified = extractSection("Modified");
            const deleted = extractSection("Deleted");
            const totalCount = added.length + modified.length + deleted.length;

            return totalCount > 0
              ? {
                  source: "filesystem" as const,
                  added,
                  modified,
                  deleted,
                  truncated: false,
                  totalCount,
                }
              : undefined;
          }

          if (filesMatch) {
            const modified = filesMatch[1]
              .split("\n")
              .filter((line) => line.startsWith("- "))
              .map((line) => line.slice(2).trim());

            return modified.length > 0
              ? {
                  source: "filesystem" as const,
                  added: [],
                  modified,
                  deleted: [],
                  truncated: false,
                  totalCount: modified.length,
                }
              : undefined;
          }

          return undefined;
        })();

        summaries.push({
          taskId: taskIdMatch[1],
          role: roleMatch[1],
          title: titleMatch?.[1] ?? "Unknown",
          status: statusMatch[1] as "done" | "failed",
          output: outputMatch?.[1]?.trim() ?? "",
          workspaceChanges,
        });
      }
    }

    return summaries;
  };

  const writeReview = (
    projectPath: string,
    parentPlanningTaskId: string,
    reviewContent: string,
  ): string => {
    const baseDir = ensureReviewDir(projectPath, parentPlanningTaskId);
    const filepath = join(baseDir, "review.md");
    writeFileSync(filepath, reviewContent, "utf-8");
    return filepath;
  };

  const getReviewPath = (projectPath: string, parentPlanningTaskId: string): string => {
    return join(getReviewsBaseDir(projectPath, parentPlanningTaskId), "review.md");
  };

  const readReview = (projectPath: string, parentPlanningTaskId: string): string | null => {
    const filepath = getReviewPath(projectPath, parentPlanningTaskId);
    if (!existsSync(filepath)) {
      return null;
    }
    return readFileSync(filepath, "utf-8");
  };

  const writeMeetingSynthesis = (
    projectPath: string,
    parentPlanningTaskId: string,
    synthesisContent: string,
  ): string => {
    const baseDir = ensureReviewDir(projectPath, parentPlanningTaskId);
    const filepath = join(baseDir, "meeting-synthesis.md");
    writeFileSync(filepath, synthesisContent, "utf-8");
    return filepath;
  };

  const getMeetingSynthesisPath = (projectPath: string, parentPlanningTaskId: string): string => {
    return join(getReviewsBaseDir(projectPath, parentPlanningTaskId), "meeting-synthesis.md");
  };

  return {
    ensureReviewDir,
    writeWorkSummary,
    getWorkSummariesDir,
    readWorkSummaries,
    writeReview,
    getReviewPath,
    readReview,
    writeMeetingSynthesis,
    getMeetingSynthesisPath,
  };
}
