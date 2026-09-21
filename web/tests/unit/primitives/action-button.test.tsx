import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionButton } from "@/components/primitives/action-button";

/**
 * SYSTEM-DESIGN-NEXTJS.md §17.4: the one place double-submission is
 * actually prevented, once, rather than remembered per button. Every
 * later mutating control (Task 9's intake form, Task 17's run actions)
 * goes through this component.
 */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ActionButton", () => {
  it("disables and sets aria-busy immediately on click, before the action resolves", async () => {
    const user = userEvent.setup();
    const slow = deferred();
    render(<ActionButton action={() => slow.promise} idleLabel="Start run" pendingLabel="Starting" />);

    await user.click(screen.getByRole("button"));

    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");

    slow.resolve();
  });

  it("invokes the action exactly once for a double click", async () => {
    const user = userEvent.setup();
    const slow = deferred();
    const spy = vi.fn(() => slow.promise);
    render(<ActionButton action={spy} idleLabel="Start run" />);
    const button = screen.getByRole("button");

    await Promise.all([user.click(button), user.click(button)]);

    expect(spy).toHaveBeenCalledTimes(1);
    slow.resolve();
  });

  it("exposes a reason when disabled", () => {
    render(
      <ActionButton
        action={() => {}}
        idleLabel="Start run"
        state={{ kind: "disabled", reason: "Already queued" }}
      />,
    );
    expect(screen.getByRole("button")).toHaveAccessibleDescription("Already queued");
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("sends a stable idempotency key across retries of the same intent", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    const failing = vi.fn((key: string) => {
      keys.push(key);
      return Promise.reject(new Error("network blip"));
    });
    render(<ActionButton action={failing} idleLabel="Start run" onError={() => {}} />);
    const button = screen.getByRole("button");

    await user.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());
    await user.click(button);
    await waitFor(() => expect(button).not.toBeDisabled());

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("renders nothing when the action state is hidden", () => {
    const { container } = render(
      <ActionButton action={() => {}} idleLabel="Start run" state={{ kind: "hidden" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("returns to idle and re-enables after the action settles", async () => {
    const user = userEvent.setup();
    const slow = deferred();
    render(<ActionButton action={() => slow.promise} idleLabel="Start run" />);
    const button = screen.getByRole("button");

    await user.click(button);
    expect(button).toBeDisabled();

    slow.resolve();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveAttribute("aria-busy", "false");
  });

  it("only swaps to the pending label after the 400ms no-flash threshold", async () => {
    vi.useFakeTimers();
    try {
      const slow = deferred();
      render(<ActionButton action={() => slow.promise} idleLabel="Start run" pendingLabel="Starting" />);
      const button = screen.getByRole("button");

      fireEvent.click(button);
      expect(button).toHaveTextContent("Start run");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(button).toHaveTextContent("Starting");

      slow.resolve();
    } finally {
      vi.useRealTimers();
    }
  });
});
