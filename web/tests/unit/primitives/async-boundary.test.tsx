import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AsyncBoundary } from "@/components/primitives/async-boundary";

describe("AsyncBoundary", () => {
  it("renders the skeleton while loading, never the empty or success content", () => {
    render(
      <AsyncBoundary
        state={{ status: "loading" }}
        skeleton={<div data-testid="skeleton" />}
        empty={<div data-testid="empty" />}
      >
        {() => <div data-testid="content" />}
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
  });

  it("renders the error state with a retry action when provided", () => {
    const onRetry = vi.fn();
    render(
      <AsyncBoundary
        state={{ status: "error", message: "Could not load runs", onRetry }}
        skeleton={<div />}
        empty={<div />}
      >
        {() => <div />}
      </AsyncBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load runs");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders the empty state, not the loading skeleton", () => {
    render(
      <AsyncBoundary state={{ status: "empty" }} skeleton={<div data-testid="skeleton" />} empty={<div data-testid="empty" />}>
        {() => <div data-testid="content" />}
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("empty")).toBeInTheDocument();
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument();
  });

  it("renders success content with the fetched data", () => {
    render(
      <AsyncBoundary state={{ status: "success", data: { name: "Acme" } }} skeleton={<div />} empty={<div />}>
        {(data) => <div data-testid="content">{data.name}</div>}
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("content")).toHaveTextContent("Acme");
  });
});
