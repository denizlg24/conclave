import type { SerializedWorkspaceChanges } from "../../shared/rpc/rpc-schema";

function readPathList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readWorkspaceChangePaths(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const record = value as SerializedWorkspaceChanges;
  return dedupeFiles([
    ...readPathList(record.added),
    ...readPathList(record.modified),
    ...readPathList(record.deleted),
  ]);
}

export function extractChangedFiles(value: unknown): string[] {
  return collectFiles(value, 0);
}

function collectFiles(value: unknown, depth: number): string[] {
  if (depth > 4 || value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === "string")) {
      return dedupeFiles(value);
    }

    return dedupeFiles(value.flatMap((entry) => collectFiles(entry, depth + 1)));
  }

  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const discovered = [
    ...readWorkspaceChangePaths(record),
    ...[
      "workspaceChanges",
      "changedFiles",
      "changed_files",
      "filesChanged",
      "modifiedFiles",
      "writtenFiles",
      "artifacts",
      "files",
      "paths",
    ].flatMap((key) => collectFiles(record[key], depth + 1)),
  ];

  if (discovered.length > 0) {
    return dedupeFiles(discovered);
  }

  return dedupeFiles(
    ["toolInput", "output", "result", "metadata", "details", "payload"].flatMap(
      (key) => collectFiles(record[key], depth + 1),
    ),
  );
}

function dedupeFiles(values: string[]): string[] {
  return [
    ...new Set(values.filter((value) => value.includes("/") || value.includes("\\"))),
  ];
}
