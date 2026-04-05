// Ensure HOME is set before anything runs — Windows uses USERPROFILE,
// but Claude CLI needs HOME to find ~/.claude/ credentials
if (!process.env.HOME && process.env.USERPROFILE) {
  process.env.HOME = process.env.USERPROFILE;
}

import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import type { ConclaveRPCSchema } from "../shared/rpc/rpc-schema";
import { bootstrapConclave } from "./conclave";

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

// Bootstrap the core orchestration system
const conclave = await bootstrapConclave();
console.log("Conclave orchestration system initialized.");

const url = await getMainViewUrl();

const rpc = BrowserView.defineRPC<ConclaveRPCSchema>({
  handlers: {
    requests: {
      getState: () => {
        console.log("[RPC] getState called");
        return conclave.getSerializedState().then((r) => { console.log("[RPC] getState resolved"); return r; });
      },
      getEvents: ({ fromSequence }) => {
        console.log("[RPC] getEvents called");
        return conclave.getSerializedEvents(fromSequence).then((r) => { console.log("[RPC] getEvents resolved"); return r; });
      },
      createTask: (params) => {
        console.log("[RPC] createTask called", params);
        return conclave.createTask(params).then((r) => { console.log("[RPC] createTask resolved", r); return r; });
      },
      updateTaskStatus: (params) => {
        console.log("[RPC] updateTaskStatus called", params);
        return conclave.updateTaskStatus(params).then((r) => { console.log("[RPC] updateTaskStatus resolved"); return r; });
      },
      approveProposedTasks: (params) => conclave.approveProposedTasks(params),
      scheduleMeeting: (params) => conclave.scheduleMeeting(params),
    },
    messages: {},
  },
});

const mainWindow = new BrowserWindow({
  title: "Conclave",
  url,
  frame: {
    width: 1280,
    height: 720,
    x: (1920 - 1280) / 2,
    y: (1080 - 720) / 2,
  },
  rpc,
});

// Push state changes to the webview when events occur
conclave.onEvent((event, model) => {
  const webviewRpc = mainWindow.webview.rpc;
  if (!webviewRpc) return;
  webviewRpc.send.onStateChanged(model);
  webviewRpc.send.onEvent(event);
});

console.log("Conclave started!");
