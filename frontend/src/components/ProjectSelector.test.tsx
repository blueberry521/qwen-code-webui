import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ProjectSelector } from "./ProjectSelector";
import "../i18n"; // Initialize i18n for tests

/** Renders the router location so navigation assertions can read it. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location-probe">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderSelector() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<ProjectSelector />} />
        <Route path="/projects/*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

// Mock fetch globally
global.fetch = vi.fn();

describe("ProjectSelector.handleProjectSelect param handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          projects: [{ path: "/proj-a", encodedName: "-proj-a" }],
        }),
    });
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("strips project-scoped sessionId/view but preserves remote-context params", async () => {
    // Simulate arriving at project selection with a remote session in the URL
    window.history.replaceState(
      null,
      "",
      "/?sessionId=abc-123&view=history&workspaceType=remote&machineId=m1",
    );

    renderSelector();

    const item = await waitFor(() => screen.getByText("/proj-a"));
    fireEvent.click(item);

    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "/projects/proj-a?workspaceType=remote&machineId=m1",
      );
    });
    expect(screen.getByTestId("location-probe").textContent).not.toContain("sessionId");
    expect(screen.getByTestId("location-probe").textContent).not.toContain("view=history");
  });

  it("navigates without a query string when no params are present", async () => {
    window.history.replaceState(null, "", "/");

    renderSelector();

    const item = await waitFor(() => screen.getByText("/proj-a"));
    fireEvent.click(item);

    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        /^\/projects\/proj-a$/,
      );
    });
  });
});
