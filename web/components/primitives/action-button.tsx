"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import type { ActionState } from "@core/domain/types";

const PENDING_LABEL_DELAY_MS = 400;

export interface ActionButtonProps {
  /** Receives a stable-per-intent idempotency key. May throw or reject. */
  action: (idempotencyKey: string) => Promise<void> | void;
  idleLabel: string;
  pendingLabel?: string;
  /**
   * From `deriveRunActions` (SYSTEM-DESIGN-NEXTJS.md §17.5). Omit for a
   * plain always-enabled button (e.g. a non-run-scoped action).
   */
  state?: ActionState;
  onError?: (error: unknown) => void;
  onSuccess?: () => void;
  /** Requires an explicit confirmation dialog before running the action. */
  confirm?: {
    title: string;
    description: string;
    confirmLabel?: string;
  };
  variant?: "primary" | "secondary" | "danger" | "ghost";
  className?: string;
}

const VARIANT_CLASSES: Record<NonNullable<ActionButtonProps["variant"]>, string> = {
  primary: "bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:opacity-90",
  secondary: "bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-surface-3)]",
  danger: "bg-[var(--color-danger)] text-white hover:opacity-90",
  ghost: "bg-transparent text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
};

/**
 * The only way any later task performs a mutation
 * (SYSTEM-DESIGN-NEXTJS.md §17.4). Owns: the idle -> pending -> settled
 * transition, the 400ms no-flash threshold on the *label*, a synchronous
 * (ref-based, not state-based) double-submit guard, a stable idempotency
 * key across retries of one intent, the disabled-reason tooltip, and
 * optional confirmation.
 */
export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  {
    action,
    idleLabel,
    pendingLabel,
    state,
    onError,
    onSuccess,
    confirm,
    variant = "primary",
    className,
  },
  forwardedRef,
) {
  const [isPending, setIsPending] = useState(false);
  const [showPendingLabel, setShowPendingLabel] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The ref guard is the real defense against a double click: it is
  // checked and set synchronously, in the same tick as the click handler
  // runs, before any React state update (and its re-render) could
  // possibly land. `isPending` state exists for rendering (disabled
  // attribute, aria-busy), not for correctness.
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const pendingLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descriptionId = useId();

  useEffect(
    () => () => {
      if (pendingLabelTimerRef.current) clearTimeout(pendingLabelTimerRef.current);
    },
    [],
  );

  if (state?.kind === "hidden") {
    return null;
  }

  const disabledByState = state?.kind === "disabled";
  const disabledReason = state?.kind === "disabled" ? state.reason : undefined;
  const isDisabled = disabledByState || isPending;

  function getIdempotencyKey(): string {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    return idempotencyKeyRef.current;
  }

  async function run() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsPending(true);

    pendingLabelTimerRef.current = setTimeout(() => setShowPendingLabel(true), PENDING_LABEL_DELAY_MS);

    try {
      await action(getIdempotencyKey());
      // A successful action represents a fulfilled intent - the next
      // click (if the button is still mounted and enabled) is a new one.
      idempotencyKeyRef.current = null;
      onSuccess?.();
    } catch (error) {
      // Deliberately keep idempotencyKeyRef as-is: a retry of a failed
      // action is the same intent, and the server should be able to
      // recognize it as the same request if the first attempt actually
      // landed despite the client-side error.
      onError?.(error);
    } finally {
      if (pendingLabelTimerRef.current) {
        clearTimeout(pendingLabelTimerRef.current);
        pendingLabelTimerRef.current = null;
      }
      submittingRef.current = false;
      setIsPending(false);
      setShowPendingLabel(false);
    }
  }

  function handleClick() {
    if (submittingRef.current || isDisabled) return;
    if (confirm) {
      setConfirmOpen(true);
      return;
    }
    void run();
  }

  const label = showPendingLabel && pendingLabel ? pendingLabel : idleLabel;

  return (
    <>
      <button
        ref={forwardedRef}
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        aria-busy={isPending}
        aria-describedby={disabledReason ? descriptionId : undefined}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          VARIANT_CLASSES[variant],
          className,
        )}
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        <span>{label}</span>
      </button>
      {disabledReason && (
        <span id={descriptionId} className="sr-only">
          {disabledReason}
        </span>
      )}
      {confirm && (
        <ConfirmDialog
          open={confirmOpen}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel ?? "Confirm"}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            void run();
          }}
        />
      )}
    </>
  );
});
