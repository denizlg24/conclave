// Ensure HOME is set before anything runs — Windows uses USERPROFILE,
// but external agent CLIs expect HOME for credentials and local config.
if (!process.env.HOME && process.env.USERPROFILE) {
  process.env.HOME = process.env.USERPROFILE;
}

import { join } from "node:path";
import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/bun";
import type {
  ConclaveRPCSchema,
  SerializedAgentEvent,
  SerializedAppSettings,
  SerializedAdapterConnectionTestResult,
  SerializedAdapterState,
  SerializedDebugConsoleEntry,
} from "../shared/rpc/rpc-schema";
import { bootstrapConclave, type ConclaveShape } from "./conclave";
import { serializeAppSettings } from "./app-settings-rpc";
import { createAppSettingsStore } from "./app-settings-store";
import {
  createProjectManager,
  type ProjectMeta,
} from "../core/project/project-manager";
import {
  ADAPTER_OPTIONS,
  defaultModelForAdapter,
  type AdapterType,
} from "../shared/types/adapter";
import type { AgentRuntimeEvent } from "../shared/types/agent-runtime";
import { resolveAdapterBinaryPath } from "../core/agents/binary-path";
import { createDebugConsoleEntry } from "../shared/utils/debug-console";
import type { DebugConsoleLevel } from "../shared/types/debug-console";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log(
        "Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
      );
    }
  }
  return "views://mainview/index.html";
}

const projectManager = createProjectManager();
const appSettingsFilePath = join(Utils.paths.userData, "settings.json");
const appSettingsStore = createAppSettingsStore({
  settingsFilePath: appSettingsFilePath,
});
let appSettings = await appSettingsStore.get();
let conclave: ConclaveShape | null = null;
let activeProject: ProjectMeta | null = null;
// Lazy reference — set after BrowserWindow is created so push callbacks
// always target the current webview, even after page refreshes.
let getWebviewRpc: (() => ReturnType<typeof BrowserView.defineRPC<ConclaveRPCSchema>> | null) | null = null;
const debugConsoleEntries: SerializedDebugConsoleEntry[] = [];
const nativeConsole: Record<DebugConsoleLevel, typeof console.log> = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: (console.debug ?? console.log).bind(console),
};

function recordDebugConsoleEntry(
  level: DebugConsoleLevel,
  args: readonly unknown[],
): void {
  const entry = createDebugConsoleEntry({
    source: "bun",
    level,
    args,
  });

  debugConsoleEntries.push(entry);
  if (debugConsoleEntries.length > 400) {
    debugConsoleEntries.splice(0, debugConsoleEntries.length - 400);
  }

  sendToWebview("onDebugConsoleEntry", entry);
}

function installConsoleMirror(): void {
  (["log", "info", "warn", "error", "debug"] as const).forEach((level) => {
    const original = nativeConsole[level];
    console[level] = (...args: unknown[]) => {
      original(...args);
      recordDebugConsoleEntry(level, args);
    };
  });
}

function sendToWebview(
  method:
    | "onStateChanged"
    | "onEvent"
    | "onProjectLoaded"
    | "onAgentEvent"
    | "onAgentRoster"
    | "onDebugConsoleEntry"
    | "onQuotaExhausted",
  data: unknown,
): void {
  const rpc = getWebviewRpc?.();
  if (!rpc) return;
  try {
    switch (method) {
      case "onStateChanged":
        rpc.send.onStateChanged(data as Parameters<typeof rpc.send.onStateChanged>[0]);
        break;
      case "onEvent":
        rpc.send.onEvent(data as Parameters<typeof rpc.send.onEvent>[0]);
        break;
      case "onProjectLoaded":
        rpc.send.onProjectLoaded(data as Parameters<typeof rpc.send.onProjectLoaded>[0]);
        break;
      case "onAgentEvent":
        rpc.send.onAgentEvent(data as Parameters<typeof rpc.send.onAgentEvent>[0]);
        break;
      case "onAgentRoster":
        rpc.send.onAgentRoster(data as Parameters<typeof rpc.send.onAgentRoster>[0]);
        break;
      case "onDebugConsoleEntry":
        rpc.send.onDebugConsoleEntry(data as Parameters<typeof rpc.send.onDebugConsoleEntry>[0]);
        break;
      case "onQuotaExhausted":
        rpc.send.onQuotaExhausted(data as Parameters<typeof rpc.send.onQuotaExhausted>[0]);
        break;
    }
  } catch {
    return;
  }
}

installConsoleMirror();

function createSerializedAdapterState(): SerializedAdapterState {
  return {
    selectedAdapter: appSettings.selectedAdapter,
    availableAdapters: [...ADAPTER_OPTIONS],
    selectedModels: { ...appSettings.selectedModels },
  };
}

async function getSerializedAppSettings(): Promise<SerializedAppSettings> {
  return serializeAppSettings({
    appSettings,
    settingsFilePath: appSettingsFilePath,
    resolveAdapterBinaryPath: (adapterType, manualPath) =>
      resolveAdapterBinaryPath({
        adapterType,
        manualPath,
      }),
  });
}

async function updateAppSettingsState(
  patch: Parameters<typeof appSettingsStore.update>[0],
): Promise<SerializedAppSettings> {
  appSettings = await appSettingsStore.update(patch);
  return getSerializedAppSettings();
}

async function resolveCurrentAdapterBinaryPath(
  adapterType: AdapterType,
) {
  return resolveAdapterBinaryPath({
    adapterType,
    manualPath: appSettings.adapterBinaryPaths[adapterType],
  });
}

function createSpawnEnv(): Record<string, string> {
  const spawnEnv = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      spawnEnv[key] = value;
    }
  }
  if (!spawnEnv.HOME && spawnEnv.USERPROFILE) {
    spawnEnv.HOME = spawnEnv.USERPROFILE;
  }
  if (!spawnEnv.PATH && spawnEnv.Path) {
    spawnEnv.PATH = spawnEnv.Path;
  }
  return spawnEnv;
}

const ADAPTER_CONNECTION_TEST_ARGS: Record<AdapterType, string[]> = {
  "claude-code": ["--version"],
  "openai-codex": ["--version"],
};

async function testAdapterConnection(
  adapterType: AdapterType,
): Promise<SerializedAdapterConnectionTestResult> {
  const resolution = await resolveCurrentAdapterBinaryPath(adapterType);

  if (!resolution.resolvedPath) {
    return {
      adapterType,
      ok: false,
      message: resolution.errorMessage ?? "Adapter binary could not be resolved.",
      resolution,
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: 0,
    };
  }

  const startedAt = Date.now();

  try {
    const proc = Bun.spawn([resolution.resolvedPath, ...ADAPTER_CONNECTION_TEST_ARGS[adapterType]], {
      cwd: Utils.paths.userData,
      env: createSpawnEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    ]);

    return {
      adapterType,
      ok: exitCode === 0,
      message:
        exitCode === 0
          ? "Adapter binary launched successfully."
          : `Adapter binary exited with code ${exitCode}.`,
      resolution,
      exitCode,
      stdout,
      stderr,
      durationMs: Math.max(Date.now() - startedAt, 0),
    };
  } catch (error) {
    return {
      adapterType,
      ok: false,
      message: `Failed to launch adapter binary: ${String(error)}`,
      resolution,
      exitCode: null,
      stdout: "",
      stderr: String(error),
      durationMs: Math.max(Date.now() - startedAt, 0),
    };
  }
}

function serializeAgentEvent(event: AgentRuntimeEvent): SerializedAgentEvent {
  return {
    type: event.type,
    agentId: event.agentId,
    sessionId: "sessionId" in event ? event.sessionId : "",
    occurredAt: event.occurredAt,
    content: "content" in event ? event.content : undefined,
    toolName: "toolName" in event ? event.toolName : undefined,
    toolInput: "toolInput" in event ? event.toolInput : undefined,
    taskId: "taskId" in event ? event.taskId : undefined,
    error: "error" in event ? event.error : undefined,
    usage:
      "usage" in event
        ? {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
          }
        : undefined,
    workspaceChanges:
      "workspaceChanges" in event
        ? {
            source: event.workspaceChanges.source,
            added: [...event.workspaceChanges.added],
            modified: [...event.workspaceChanges.modified],
            deleted: [...event.workspaceChanges.deleted],
            truncated: event.workspaceChanges.truncated,
            totalCount: event.workspaceChanges.totalCount,
          }
        : undefined,
    costUsd: "costUsd" in event ? event.costUsd : undefined,
    durationMs: "durationMs" in event ? event.durationMs : undefined,
  };
}

async function loadProjectAndBootstrap(
  projectId: string,
): Promise<void> {
  if (conclave) {
    await conclave.shutdown();
    conclave = null;
  }

  const project = projectManager.loadProject(projectId);
  activeProject = project;

  console.log(`Loading project: ${project.name} (${project.path})`);
  conclave = await bootstrapConclave(
    project.path,
    appSettings.selectedAdapter,
    appSettings.selectedModels[appSettings.selectedAdapter] ??
      defaultModelForAdapter(appSettings.selectedAdapter),
    resolveCurrentAdapterBinaryPath,
  );
  console.log("Conclave orchestration system initialized.");

  conclave.onEvent((event, model) => {
    sendToWebview("onStateChanged", model);
    sendToWebview("onEvent", event);
  });

  conclave.onAgentEvent((event) => {
    sendToWebview("onAgentEvent", serializeAgentEvent(event));
  });

  conclave.onAgentRoster((roster) => {
    sendToWebview("onAgentRoster", roster);
  });

  conclave.onQuotaExhausted((info) => {
    sendToWebview("onQuotaExhausted", info);
  });

  const initialRoster = await conclave.getAgentRoster();
  sendToWebview("onAgentRoster", initialRoster);

  await forceMainWindowRelayout();
  sendToWebview("onProjectLoaded", project);
}

const url = await getMainViewUrl();

const rpc = BrowserView.defineRPC<ConclaveRPCSchema>({
  maxRequestTime: 5 * 60 * 1000,
  handlers: {
    requests: {
      listProjects: () => {
        return Promise.resolve(projectManager.listProjects());
      },
      createProject: ({ name, description, path }) => {
        console.log("[RPC] createProject called:", name, "at", path);
        const project = projectManager.createProject(name, description, path);
        return Promise.resolve(project);
      },
      openDirectory: ({ path }) => {
        console.log("[RPC] openDirectory called:", path);
        const project = projectManager.openDirectory(path);
        return Promise.resolve(project);
      },
      browseForDirectory: async () => {
        const paths = await Utils.openFileDialog({
          startingFolder: Utils.paths.home,
          allowedFileTypes: "*",
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        });
        return paths.length > 0 ? paths[0] : null;
      },
      loadProject: async ({ projectId }) => {
        console.log("[RPC] loadProject called:", projectId);
        await loadProjectAndBootstrap(projectId);
        return { success: true };
      },
      getActiveProject: () => {
        return Promise.resolve(activeProject);
      },
      getAdapterState: () => {
        return Promise.resolve(createSerializedAdapterState());
      },
      getAppSettings: async () => {
        return getSerializedAppSettings();
      },
      setAdapter: async ({ adapterType }) => {
        await updateAppSettingsState({ selectedAdapter: adapterType });
        return createSerializedAdapterState();
      },
      setAdapterModel: async ({ adapterType, model }) => {
        await updateAppSettingsState({
          selectedModels: {
            [adapterType]: model,
          },
        });
        return createSerializedAdapterState();
      },
      updateAppSettings: (patch) => {
        return updateAppSettingsState(patch);
      },
      testAdapterConnection: ({ adapterType }) => {
        return testAdapterConnection(adapterType);
      },
      getDebugConsoleEntries: () => Promise.resolve([...debugConsoleEntries]),
      getAgentRoster: () => {
        if (!conclave) throw new Error("No project loaded");
        return conclave.getAgentRoster();
      },

      sendCommand: ({ message }) => {
        if (!conclave) throw new Error("No project loaded");
        console.log("[RPC] sendCommand called:", message.slice(0, 80));
        return conclave.sendCommand({ message });
      },

      getState: () => {
        if (!conclave) throw new Error("No project loaded");
        return conclave.getSerializedState();
      },
      getEvents: ({ fromSequence }) => {
        if (!conclave) throw new Error("No project loaded");
        return conclave.getSerializedEvents(fromSequence);
      },
      createTask: (params) => {
        if (!conclave) throw new Error("No project loaded");
        return conclave.createTask(params);
      },
      updateTaskStatus: (params) => {
        if (!conclave) throw new Error("No project loaded");
        return conclave.updateTaskStatus(params);
      },
      approveProposedTasks: (params) => {
        if (!conclave) throw new Error("No project loaded");
        return conclave.approveProposedTasks(params);
      },
      scheduleMeeting: (params) => {
        if (!conclave) throw new Error("No project loaded");
        return conclave.scheduleMeeting(params);
      },
      getSuspendedTasks: () => {
        if (!conclave) throw new Error("No project loaded");
        return conclave.getSuspendedTasks();
      },
      resumeSuspendedTask: ({ taskId }) => {
        if (!conclave) throw new Error("No project loaded");
        return conclave.resumeSuspendedTask(taskId);
      },
      retryTask: ({ taskId }) => {
        if (!conclave) throw new Error("No project loaded");
        return conclave.retryTask(taskId);
      },
      getPendingProposals: () => {
        if (!conclave) throw new Error("No project loaded");
        return conclave.getPendingProposals();
      },
      deleteProject: ({ projectId }) => {
        projectManager.deleteProject(projectId);
        return Promise.resolve({ success: true });
      },
      unloadProject: async () => {
        if (conclave) {
          await conclave.shutdown();
          conclave = null;
        }
        activeProject = null;
        return { success: true };
      },
    },
    messages: {},
  },
});

const mainWindow = new BrowserWindow({
  title: "Conclave",
  url,
  frame: {
    width: 1280,
    height: 816,
    x: (1920 - 1280) / 2,
    y: (1080 - 816) / 2,
  },
  rpc,
});

// Wire up the lazy RPC getter now that mainWindow exists
getWebviewRpc = () => mainWindow.webview.rpc ?? null;

mainWindow.webview.on("dom-ready", () => {
  void forceMainWindowRelayout();
  triggerOneTimeInitialViewReload();
});

async function forceMainWindowRelayout(): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  const frame = mainWindow.getFrame();
  const nudgedWidth = frame.width + 1;
  const nudgedHeight = frame.height + 1;

  mainWindow.setFrame(frame.x, frame.y, nudgedWidth, nudgedHeight);
  await Bun.sleep(16);
  mainWindow.setFrame(frame.x, frame.y, frame.width, frame.height);
  await Bun.sleep(16);

  mainWindow.webview.executeJavascript(`
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
      window.visualViewport?.dispatchEvent?.(new Event("resize"));
    });
  `);
}

function triggerOneTimeInitialViewReload(): void {
  if (process.platform !== "win32") {
    return;
  }

  mainWindow.webview.executeJavascript(`
    (() => {
      const key = "conclave-initial-layout-reloaded-v1";
      if (window.sessionStorage.getItem(key)) {
        return;
      }

      window.sessionStorage.setItem(key, "1");
      window.location.reload();
    })();
  `);
}

console.log("Conclave started! Waiting for project selection...");
