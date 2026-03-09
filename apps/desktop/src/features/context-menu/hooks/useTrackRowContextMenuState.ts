import { useCallback, useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

export type TrackRowContextMenuSource = "tracks" | "albums" | "queue";

export type TrackRowContextMenuState = {
  trackId: string;
  x: number;
  y: number;
  source: TrackRowContextMenuSource;
  queueIndex?: number;
};

type UseTrackRowContextMenuStateArgs = {
  onSelectTrack: (trackId: string) => void;
};

export function useTrackRowContextMenuState(args: UseTrackRowContextMenuStateArgs) {
  const { onSelectTrack } = args;
  const [trackRowContextMenu, setTrackRowContextMenu] = useState<TrackRowContextMenuState | null>(null);

  useEffect(() => {
    if (!trackRowContextMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTrackRowContextMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [trackRowContextMenu]);

  const openTrackRowContextMenu = useCallback(
    (
      trackId: string,
      x: number,
      y: number,
      source: TrackRowContextMenuSource = "tracks",
      queueIndex?: number
    ) => {
      const clampedX = Math.max(8, Math.min(window.innerWidth - 220, x));
      const clampedY = Math.max(8, Math.min(window.innerHeight - 180, y));
      onSelectTrack(trackId);
      setTrackRowContextMenu({ trackId, x: clampedX, y: clampedY, source, queueIndex });
    },
    [onSelectTrack]
  );

  const handleTrackRowContextMenu = useCallback(
    (
      event: ReactMouseEvent<HTMLElement>,
      trackId: string,
      options?: { source?: TrackRowContextMenuSource; queueIndex?: number }
    ) => {
      event.preventDefault();
      openTrackRowContextMenu(
        trackId,
        event.clientX,
        event.clientY,
        options?.source ?? "tracks",
        options?.queueIndex
      );
    },
    [openTrackRowContextMenu]
  );

  const handleTrackRowMenuButtonClick = useCallback(
    (
      event: ReactMouseEvent<HTMLButtonElement>,
      trackId: string,
      options?: { source?: TrackRowContextMenuSource; queueIndex?: number }
    ) => {
      const rect = event.currentTarget.getBoundingClientRect();
      openTrackRowContextMenu(
        trackId,
        rect.right,
        rect.bottom + 6,
        options?.source ?? "tracks",
        options?.queueIndex
      );
    },
    [openTrackRowContextMenu]
  );

  const handleAlbumTrackRowContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, trackId: string) => {
      event.preventDefault();
      openTrackRowContextMenu(trackId, event.clientX, event.clientY, "albums");
    },
    [openTrackRowContextMenu]
  );

  const handleAlbumTrackRowMenuButtonClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, trackId: string) => {
      const rect = event.currentTarget.getBoundingClientRect();
      openTrackRowContextMenu(trackId, rect.right, rect.bottom + 6, "albums");
    },
    [openTrackRowContextMenu]
  );

  return {
    trackRowContextMenu,
    setTrackRowContextMenu,
    handleTrackRowContextMenu,
    handleTrackRowMenuButtonClick,
    handleAlbumTrackRowContextMenu,
    handleAlbumTrackRowMenuButtonClick
  };
}
