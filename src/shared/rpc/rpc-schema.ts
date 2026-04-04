export type ConclaveRPCSchema = {
  bun: {
    requests: {};
    messages: {
      closeWindow: void;
      minimizeWindow: void;
      maximizeWindow: void;
    };
  };
  webview: {
    requests: {};
    messages: {};
  };
};