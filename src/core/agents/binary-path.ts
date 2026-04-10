import { access } from "node:fs/promises";
import { delimiter, extname, isAbsolute, join, resolve } from "node:path";
import { constants as fsConstants } from "node:fs";

import type {
  AdapterBinaryResolution,
  AdapterType,
} from "@/shared/types/adapter";

type ResolveAdapterBinaryPathOptions = {
  readonly adapterType: AdapterType;
  readonly manualPath: string | null;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly pathExists?: (candidatePath: string) => Promise<boolean>;
};

const ADAPTER_COMMANDS: Record<AdapterType, string> = {
  "claude-code": "claude",
  "openai-codex": "codex",
};

async function fileExists(candidatePath: string): Promise<boolean> {
  try {
    await access(
      candidatePath,
      process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function hasPathSeparators(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function normalizeWindowsExtensions(
  candidate: string,
  env: NodeJS.ProcessEnv,
): ReadonlyArray<string> {
  if (extname(candidate).length > 0) {
    return [candidate];
  }

  const pathExt = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const extensions = pathExt
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.toLowerCase());

  return [candidate, ...extensions.map((entry) => `${candidate}${entry}`)];
}

async function resolveFromPath(
  command: string,
  {
    cwd = process.cwd(),
    env = process.env,
    platform = process.platform,
    pathExists = fileExists,
  }: Omit<ResolveAdapterBinaryPathOptions, "adapterType" | "manualPath">,
): Promise<string | null> {
  const isWindows = platform === "win32";
  const rawCandidates = isWindows
    ? normalizeWindowsExtensions(command, env)
    : [command];

  const seen = new Set<string>();
  const candidates = rawCandidates.filter((candidate) => {
    const key = isWindows ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  if (isAbsolute(command) || hasPathSeparators(command)) {
    for (const candidate of candidates) {
      const absoluteCandidate = isAbsolute(candidate)
        ? candidate
        : resolve(cwd, candidate);
      if (await pathExists(absoluteCandidate)) {
        return absoluteCandidate;
      }
    }
    return null;
  }

  const pathValue = env.PATH ?? env.Path ?? "";
  for (const entry of pathValue.split(delimiter)) {
    const trimmedEntry = entry.trim();
    if (!trimmedEntry) {
      continue;
    }

    for (const candidate of candidates) {
      const candidatePath = join(trimmedEntry, candidate);
      if (await pathExists(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

export function defaultCommandForAdapterBinary(
  adapterType: AdapterType,
): string {
  return ADAPTER_COMMANDS[adapterType];
}

export async function resolveAdapterBinaryPath({
  adapterType,
  manualPath,
  cwd,
  env,
  platform,
  pathExists,
}: ResolveAdapterBinaryPathOptions): Promise<AdapterBinaryResolution> {
  const command = defaultCommandForAdapterBinary(adapterType);
  const trimmedManualPath = manualPath?.trim() ?? null;

  if (trimmedManualPath) {
    const resolvedPath = await resolveFromPath(trimmedManualPath, {
      cwd,
      env,
      platform,
      pathExists,
    });

    if (resolvedPath) {
      return {
        adapterType,
        command,
        manualPath: trimmedManualPath,
        resolvedPath,
        source: "manual",
        errorCode: null,
        errorMessage: null,
      };
    }

    return {
      adapterType,
      command,
      manualPath: trimmedManualPath,
      resolvedPath: null,
      source: null,
      errorCode: "manual_override_not_found",
      errorMessage: `Configured binary path not found: ${trimmedManualPath}`,
    };
  }

  const detectedPath = await resolveFromPath(command, {
    cwd,
    env,
    platform,
    pathExists,
  });

  if (detectedPath) {
    return {
      adapterType,
      command,
      manualPath: null,
      resolvedPath: detectedPath,
      source: "detected",
      errorCode: null,
      errorMessage: null,
    };
  }

  return {
    adapterType,
    command,
    manualPath: null,
    resolvedPath: null,
    source: null,
    errorCode: "binary_not_found",
    errorMessage: `Could not find '${command}' on PATH.`,
  };
}
