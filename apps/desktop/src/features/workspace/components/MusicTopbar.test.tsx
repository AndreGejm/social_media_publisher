import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MusicTopbar from "./MusicTopbar";

afterEach(() => {
  cleanup();
});

describe("MusicTopbar", () => {
  it("renders listen summary stats and routes stat actions", () => {
    const onSwitchAppMode = vi.fn();
    const onOpenVideoWorkspace = vi.fn();
    const onOpenTracksWorkspace = vi.fn();
    const onOpenAlbumsWorkspace = vi.fn();
    const onOpenLibraryWorkspace = vi.fn();

    render(
      <MusicTopbar
        activeMode="Listen"
        activeWorkspace="Quality Control"
        onSwitchAppMode={onSwitchAppMode}
        onOpenVideoWorkspace={onOpenVideoWorkspace}
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
    const onOpenVideoWorkspace = vi.fn();

    render(
      <MusicTopbar
        activeMode="Publish"
        activeWorkspace="Publisher Ops"
        onSwitchAppMode={onSwitchAppMode}
        onOpenVideoWorkspace={onOpenVideoWorkspace}
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

    fireEvent.click(screen.getByRole("tab", { name: "Release Preview" }));
    expect(onSwitchAppMode).toHaveBeenCalledWith("Listen");
    fireEvent.click(screen.getByRole("tab", { name: "Video Workspace" }));
    expect(onOpenVideoWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Use the release workflow steps/i)).toBeInTheDocument();
  });

  it("keeps About heading without redundant banner or subtitle copy", () => {
    render(
      <MusicTopbar
        activeMode="Listen"
        activeWorkspace="About"
        onSwitchAppMode={vi.fn()}
        onOpenVideoWorkspace={vi.fn()}
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

    expect(screen.getByRole("heading", { level: 2, name: "Skald QC" })).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "About workspace guidance" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Static product and runtime diagnostics/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Informational workspace/i)).not.toBeInTheDocument();
  });

  it("marks Video Workspace as the active top-level tab when open", () => {
    render(
      <MusicTopbar
        activeMode="Listen"
        activeWorkspace="Video Workspace"
        onSwitchAppMode={vi.fn()}
        onOpenVideoWorkspace={vi.fn()}
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

    expect(screen.getByRole("tab", { name: "Video Workspace" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Release Preview" })).toHaveAttribute("aria-selected", "false");
  });
});