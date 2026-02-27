import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MusicTopbar from "./MusicTopbar";

afterEach(() => {
  cleanup();
});

describe("MusicTopbar", () => {
  it("renders listen summary stats and routes stat actions", () => {
    const onSwitchAppMode = vi.fn();
    const onOpenTracksWorkspace = vi.fn();
    const onOpenAlbumsWorkspace = vi.fn();
    const onOpenLibraryWorkspace = vi.fn();

    render(
      <MusicTopbar
        activeMode="Listen"
        activeWorkspace="Tracks"
        appModes={["Listen", "Publish"]}
        onSwitchAppMode={onSwitchAppMode}
        tracksCount={228}
        albumGroupsCount={2}
        favoritesCount={4}
        queueCount={3}
        importErrorsCount={1}
        onOpenTracksWorkspace={onOpenTracksWorkspace}
        onOpenAlbumsWorkspace={onOpenAlbumsWorkspace}
        onOpenLibraryWorkspace={onOpenLibraryWorkspace}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /228 track\(s\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /2 album group\(s\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /1 import error\(s\)/i }));

    expect(onOpenTracksWorkspace).toHaveBeenCalledTimes(1);
    expect(onOpenAlbumsWorkspace).toHaveBeenCalledTimes(1);
    expect(onOpenLibraryWorkspace).toHaveBeenCalledTimes(1);
  });

  it("switches mode tabs and shows publish guidance in publish mode", () => {
    const onSwitchAppMode = vi.fn();

    render(
      <MusicTopbar
        activeMode="Publish"
        activeWorkspace="Publisher Ops"
        appModes={["Listen", "Publish"]}
        onSwitchAppMode={onSwitchAppMode}
        tracksCount={0}
        albumGroupsCount={0}
        favoritesCount={0}
        queueCount={0}
        importErrorsCount={0}
        onOpenTracksWorkspace={vi.fn()}
        onOpenAlbumsWorkspace={vi.fn()}
        onOpenLibraryWorkspace={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Listen" }));
    expect(onSwitchAppMode).toHaveBeenCalledWith("Listen");
    expect(screen.getByText(/Use the release workflow steps/i)).toBeInTheDocument();
  });
});
