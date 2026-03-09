import React from "react";
import ReactDOM from "react-dom/client";
import AppShell from "./app/shell/AppShell";
import { TauriClientProvider } from "./services/TauriClientProvider";
import * as defaultTauriClient from "./services/tauriClient";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TauriClientProvider client={defaultTauriClient}>
      <AppShell />
    </TauriClientProvider>
  </React.StrictMode>
);
