import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LibraryHomeSection from "./LibraryHomeSection";

afterEach(() => {
  cleanup();
});

describe("LibraryHomeSection", () => {
  it("renders summary cards without redundant quick action shortcuts", () => {
    render(
      <LibraryHomeSection
        hidden={false}
        libraryOverviewCollapsed={false}
        onToggleLibraryOverviewCollapsed={vi.fn()}
        tracksCount={228}
        queueCount={3}
        albumGroupsCount={2}
        favoritesCount={4}
      />
    );

    expect(screen.getByText("228")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Track QC" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Quick Actions" })).not.toBeInTheDocument();
  });
});