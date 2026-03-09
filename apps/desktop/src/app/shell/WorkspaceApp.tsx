import { WorkspaceFeature } from "../../features/workspace";
import { useOptionalAppShellState } from "./AppShellContext";

export default function WorkspaceApp() {
  const shellState = useOptionalAppShellState();

  const shellFrame = shellState
    ? {
        layoutTier: shellState.layout.geometry.tier,
        refreshTick: shellState.refreshTick,
        eventBus: shellState.eventBus
      }
    : null;

  return <WorkspaceFeature shellFrame={shellFrame} />;
}


