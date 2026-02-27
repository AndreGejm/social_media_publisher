import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LibraryHomeSection from "./LibraryHomeSection";

afterEach(() => {
  cleanup();
});

describe("LibraryHomeSection", () => {
  it("renders summary cards and quick action buttons", () => {
    const onOpenTracksWorkspace = vi.fn();
    const onOpenAlbumsWorkspace = vi.fn();
    const onShowPublishMode = vi.fn();

    render(
      <LibraryHomeSection
        hidden={false}
        libraryOverviewCollapsed={false}
        onToggleLibraryOverviewCollapsed={vi.fn()}
        tracksCount={228}
        queueCount={3}
        albumGroupsCount={2}
        favoritesCount={4}
        libraryQuickActionsCollapsed={false}
        onToggleLibraryQuickActionsCollapsed={vi.fn()}
        onOpenTracksWorkspace={onOpenTracksWorkspace}
        onOpenAlbumsWorkspace={onOpenAlbumsWorkspace}
        onShowPublishMode={onShowPublishMode}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Tracks Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Albums Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Publish Workflow" }));

    expect(screen.getByText("228")).toBeInTheDocument();
    expect(onOpenTracksWorkspace).toHaveBeenCalledTimes(1);
    expect(onOpenAlbumsWorkspace).toHaveBeenCalledTimes(1);
    expect(onShowPublishMode).toHaveBeenCalledTimes(1);
  });
});
