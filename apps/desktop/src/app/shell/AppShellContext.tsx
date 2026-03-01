/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from "react";

import type { AppEventBus } from "../events/eventBus";
import type { LayoutSnapshot } from "../layout/layoutManager";

export type AppShellState = {
  refreshRateHz: number;
  refreshTick: number;
  layout: LayoutSnapshot;
  eventBus: AppEventBus;
};

const AppShellContext = createContext<AppShellState | null>(null);

export function useAppShellState(): AppShellState {
  const value = useContext(AppShellContext);
  if (!value) {
    throw new Error("AppShellContext is unavailable. Mount within <AppShellContext.Provider>.");
  }
  return value;
}

export function useOptionalAppShellState(): AppShellState | null {
  return useContext(AppShellContext);
}

export default AppShellContext;
