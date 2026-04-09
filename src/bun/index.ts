// Ensure HOME is set before anything runs — Windows uses USERPROFILE,
// but external agent CLIs expect HOME for credentials and local config.
if (!process.env.HOME && process.env.USERPROFILE) {
  process.env.HOME = process.env.USERPROFILE;
}

import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/bun";
import type {
  ConclaveRPCSchema,
  SerializedAgentEvent,
  SerializedDebugConsoleEntry,
} from "../shared/rpc/rpc-schema";
import { bootstrapConclave, type ConclaveShape } from "./conclave";
import {
  createProjectManager,
  type ProjectMeta,
} from "../core/project/project-manager";
import {
  ADAPTER_OPTIONS,
  DEFAULT_ADAPTER_TYPE,
  createDefaultAdapterModelSelections,
  defaultModelForAdapter,
  isAdapterModel,
  isAdapterType,
  type AdapterType,
} from "../shared/types/adapter";
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
let conclave: ConclaveShape | null = null;
let activeProject: ProjectMeta | null = null;
let selectedAdapter: AdapterType = DEFAULT_ADAPTER_TYPE;
let selectedModels = createDefaultAdapterModelSelections();
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

function serializeAgentEvent(event: {
  type: string;
  agentId: string;
  sessionId: string;
  occurredAt: string;
  [key: string]: unknown;
}): SerializedAgentEvent {
  return {
    type: event.type,
    agentId: event.agentId,
    sessionId: event.sessionId,
    occurredAt: event.occurredAt,
    content: event.content as string | undefined,
    toolName: event.toolName as string | undefined,
    toolInput: event.toolInput,
    taskId: event.taskId as string | null | undefined,
    error: event.error as string | undefined,
    usage: event.usage as { inputTokens: number; outputTokens: number } | undefined,
    costUsd: event.costUsd as number | undefined,
    durationMs: event.durationMs as number | undefined,
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
    selectedAdapter,
    selectedModels[selectedAdapter] ?? defaultModelForAdapter(selectedAdapter),
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
        return Promise.resolve({
          selectedAdapter,
          availableAdapters: [...ADAPTER_OPTIONS],
          selectedModels: { ...selectedModels },
        });
      },
      setAdapter: ({ adapterType }) => {
        if (!isAdapterType(adapterType)) {
          throw new Error(`Unsupported adapter '${adapterType}'`);
        }
        selectedAdapter = adapterType;
        return Promise.resolve({
          selectedAdapter,
          availableAdapters: [...ADAPTER_OPTIONS],
          selectedModels: { ...selectedModels },
        });
      },
      setAdapterModel: ({ adapterType, model }) => {
        if (!isAdapterType(adapterType)) {
          throw new Error(`Unsupported adapter '${adapterType}'`);
        }
        if (!isAdapterModel(adapterType, model)) {
          throw new Error(
            `Unsupported model '${model}' for adapter '${adapterType}'`,
          );
        }
        selectedModels = {
          ...selectedModels,
          [adapterType]: model,
        };
        return Promise.resolve({
          selectedAdapter,
          availableAdapters: [...ADAPTER_OPTIONS],
          selectedModels: { ...selectedModels },
        });
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

console.log("Conclave started! Waiting for project selection...");
