import React from "react";
import ReactDOM from "react-dom/client";
import AppShell from "./app/shell/AppShell";
import { installRuntimeErrorLogging } from "./services/runtimeErrorLog";
import { TauriClientProvider } from "./services/tauri/TauriClientProvider";
import * as defaultTauriClient from "./services/tauri/tauriClient";
import "./styles.css";

installRuntimeErrorLogging();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TauriClientProvider client={defaultTauriClient}>
      <AppShell />
    </TauriClientProvider>
  </React.StrictMode>
);
