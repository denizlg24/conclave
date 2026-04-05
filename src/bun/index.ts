import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import { ConclaveRPCSchema } from "../shared/rpc/rpc-schema";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Check if Vite dev server is running for HMR
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

const url = await getMainViewUrl();

const rpc = BrowserView.defineRPC<ConclaveRPCSchema>({
  handlers: {
    requests: {},
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

console.log("Conclave started!");
