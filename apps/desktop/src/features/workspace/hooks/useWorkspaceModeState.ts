import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";

type UseWorkspaceModeStateArgs<Workspace extends string> = {
  activeMode: "Listen" | "Publish";
  setActiveMode: Dispatch<SetStateAction<"Listen" | "Publish">>;
  activeWorkspace: Workspace;
  setActiveWorkspace: Dispatch<SetStateAction<Workspace>>;
  setPublisherOpsBooted: Dispatch<SetStateAction<boolean>>;
  listenModeWorkspaces: Workspace[];
  listenModeNavWorkspaces: Workspace[];
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
    listenModeNavWorkspaces,
    publishModeWorkspaces,
    globalWorkspaces
  } = args;

  const defaultListenWorkspace = listenModeNavWorkspaces[0] ?? listenModeWorkspaces[0];
  const defaultPublishWorkspace = publishModeWorkspaces[0];
  const modeWorkspaces = activeMode === "Listen" ? listenModeNavWorkspaces : publishModeWorkspaces;
  const showLibraryIngestSidebar = activeMode === "Listen" && activeWorkspace === "Library";

  useEffect(() => {
    const modeAllowed = activeMode === "Listen" ? listenModeWorkspaces : publishModeWorkspaces;
    const allowed = [...modeAllowed, ...globalWorkspaces];
    if (allowed.includes(activeWorkspace)) return;
    setActiveWorkspace((activeMode === "Listen" ? defaultListenWorkspace : defaultPublishWorkspace) as Workspace);
  }, [
    activeMode,
    activeWorkspace,
    defaultListenWorkspace,
    defaultPublishWorkspace,
    listenModeWorkspaces,
    publishModeWorkspaces,
    globalWorkspaces,
    setActiveWorkspace
  ]);

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
        setActiveWorkspace(defaultPublishWorkspace as Workspace);
      }
      return;
    }
    const isListenNavWorkspace = listenModeNavWorkspaces.includes(activeWorkspace);
    if (!isListenNavWorkspace && !isGlobalWorkspace) {
      setActiveWorkspace(defaultListenWorkspace as Workspace);
    }
  }, [
    activeWorkspace,
    defaultListenWorkspace,
    defaultPublishWorkspace,
    globalWorkspaces,
    listenModeNavWorkspaces,
    setActiveMode,
    setActiveWorkspace,
    setPublisherOpsBooted
  ]);

  return {
    modeWorkspaces,
    showLibraryIngestSidebar,
    switchAppMode
  };
}