"use client";
import { Electroview } from "electrobun/view";
import { ConclaveRPCSchema } from "../rpc/rpc-schema";
import { Minus, Square, Copy, X, Maximize2, Minimize2 } from "lucide-react";
import { useState } from "react";

const rpc = Electroview.defineRPC<ConclaveRPCSchema>({
  handlers: {
    requests: {},
    messages: {},
  },
});

const electrobun = new Electroview({ rpc });

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleClose = () => {
    electrobun.rpc!.send.closeWindow();
  };

  const handleMinimize = () => {
    electrobun.rpc!.send.minimizeWindow();
  };

  const handleMaximize = () => {
    electrobun.rpc!.send.maximizeWindow();
  };

  return (
    <div className="titlebar electrobun-webkit-app-region-drag fixed top-0 left-0 right-0 z-50 flex h-8 items-center justify-between bg-background select-none">
      <span className="ml-3 text-xs font-semibold">Conclave</span>

      <div className="window-controls electrobun-webkit-app-region-no-drag flex h-full">
        <button
          id="minimizeBtn"
          onClick={handleMinimize}
          className="inline-flex h-8 w-10 items-center justify-center hover:bg-accent/50"
        >
          <Minus className="size-4" />
        </button>

        <button
          id="maximizeBtn"
          onClick={() => {
            setIsMaximized((prev) => !prev);
            handleMaximize();
          }}
          className="inline-flex h-8 w-10 items-center justify-center hover:bg-accent/50"
        >
          {isMaximized ? (
            <Copy className="size-3.5" />
          ) : (
            <Square className="size-3.5" />
          )}
        </button>

        <button
          id="closeBtn"
          onClick={handleClose}
          className="inline-flex h-8 w-10 items-center justify-center hover:bg-red-600 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
