import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";

type UseWorkspaceModeStateArgs<Workspace extends string> = {
  activeMode: "Listen" | "Publish";
  setActiveMode: Dispatch<SetStateAction<"Listen" | "Publish">>;
  activeWorkspace: Workspace;
  setActiveWorkspace: Dispatch<SetStateAction<Workspace>>;
  setPublisherOpsBooted: Dispatch<SetStateAction<boolean>>;
  listenModeWorkspaces: Workspace[];
  publishModeWorkspaces: Workspace[];
  globalWorkspaces: Workspace[];
};

export function useWorkspaceModeState<Workspace extends string>(args: UseWorkspaceModeStateArgs<Workspace>) {
  const {
    activeMode,
    setActiveMode,
    activeWorkspace,
    setActiveWorkspace,
    setPublisherOpsBooted,
    listenModeWorkspaces,
    publishModeWorkspaces,
    globalWorkspaces
  } = args;

  const modeWorkspaces = activeMode === "Listen" ? listenModeWorkspaces : publishModeWorkspaces;
  const showLibraryIngestSidebar = activeMode === "Listen" && activeWorkspace === "Library";

  useEffect(() => {
    const modeAllowed = activeMode === "Listen" ? listenModeWorkspaces : publishModeWorkspaces;
    const allowed = [...modeAllowed, ...globalWorkspaces];
    if (allowed.includes(activeWorkspace)) return;
    setActiveWorkspace((activeMode === "Listen" ? "Library" : "Publisher Ops") as Workspace);
  }, [activeMode, activeWorkspace, listenModeWorkspaces, publishModeWorkspaces, globalWorkspaces, setActiveWorkspace]);

  useEffect(() => {
    if (activeWorkspace === "Publisher Ops") {
      setPublisherOpsBooted(true);
    }
  }, [activeWorkspace, setPublisherOpsBooted]);

  const switchAppMode = useCallback((mode: "Listen" | "Publish") => {
    const isGlobalWorkspace = globalWorkspaces.includes(activeWorkspace);
    setActiveMode(mode);
    if (mode === "Publish") {
      setPublisherOpsBooted(true);
      if (!isGlobalWorkspace) {
        setActiveWorkspace("Publisher Ops" as Workspace);
      }
      return;
    }
    if (!listenModeWorkspaces.includes(activeWorkspace) && !isGlobalWorkspace) {
      setActiveWorkspace("Library" as Workspace);
    }
  }, [activeWorkspace, globalWorkspaces, listenModeWorkspaces, setActiveMode, setActiveWorkspace, setPublisherOpsBooted]);

  return {
    modeWorkspaces,
    showLibraryIngestSidebar,
    switchAppMode
  };
}
