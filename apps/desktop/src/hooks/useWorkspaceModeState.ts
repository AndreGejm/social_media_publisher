import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";

type UseWorkspaceModeStateArgs<Workspace extends string> = {
  activeMode: "Listen" | "Publish";
  setActiveMode: Dispatch<SetStateAction<"Listen" | "Publish">>;
  activeWorkspace: Workspace;
  setActiveWorkspace: Dispatch<SetStateAction<Workspace>>;
  setPublisherOpsBooted: Dispatch<SetStateAction<boolean>>;
  listenModeWorkspaces: Workspace[];
  publishModeWorkspaces: Workspace[];
};

export function useWorkspaceModeState<Workspace extends string>(args: UseWorkspaceModeStateArgs<Workspace>) {
  const {
    activeMode,
    setActiveMode,
    activeWorkspace,
    setActiveWorkspace,
    setPublisherOpsBooted,
    listenModeWorkspaces,
    publishModeWorkspaces
  } = args;

  const modeWorkspaces = activeMode === "Listen" ? listenModeWorkspaces : publishModeWorkspaces;
  const showLibraryIngestSidebar = activeMode === "Listen" && activeWorkspace === "Library";

  useEffect(() => {
    const allowed = activeMode === "Listen" ? listenModeWorkspaces : publishModeWorkspaces;
    if (allowed.includes(activeWorkspace)) return;
    setActiveWorkspace((activeMode === "Listen" ? "Library" : "Publisher Ops") as Workspace);
  }, [activeMode, activeWorkspace, listenModeWorkspaces, publishModeWorkspaces, setActiveWorkspace]);

  useEffect(() => {
    if (activeWorkspace === "Publisher Ops") {
      setPublisherOpsBooted(true);
    }
  }, [activeWorkspace, setPublisherOpsBooted]);

  const switchAppMode = useCallback((mode: "Listen" | "Publish") => {
    setActiveMode(mode);
    if (mode === "Publish") {
      setPublisherOpsBooted(true);
      setActiveWorkspace("Publisher Ops" as Workspace);
      return;
    }
    if (!listenModeWorkspaces.includes(activeWorkspace)) {
      setActiveWorkspace("Library" as Workspace);
    }
  }, [activeWorkspace, listenModeWorkspaces, setActiveMode, setActiveWorkspace, setPublisherOpsBooted]);

  return {
    modeWorkspaces,
    showLibraryIngestSidebar,
    switchAppMode
  };
}
