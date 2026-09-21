import { useCallback, useSyncExternalStore } from "react";

/**
 * A localStorage-backed boolean, read via `useSyncExternalStore` rather
 * than `useEffect` + `useState` for the same reason as `useIsClient`
 * (`react-hooks/set-state-in-effect`). Same-tab writes notify listeners
 * through a plain `EventTarget` (localStorage's own `storage` event only
 * fires in *other* tabs, never the tab that wrote it).
 *
 * For per-viewer conveniences only (SYSTEM-DESIGN-NEXTJS.md §17.6:
 * a remembered collapsed sidebar, never state that must persist reliably
 * or be shared between viewers) - reads and writes are wrapped in
 * try/catch and degrade to the given default when storage is unavailable
 * (private browsing, blocked site data).
 */
const emitter = new EventTarget();

function readValue(key: string, defaultValue: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? defaultValue : raw === "1";
  } catch {
    return defaultValue;
  }
}

export function useLocalStorageBoolean(key: string, defaultValue: boolean): [boolean, (next: boolean) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = () => onChange();
      emitter.addEventListener(key, handler);
      window.addEventListener("storage", handler);
      return () => {
        emitter.removeEventListener(key, handler);
        window.removeEventListener("storage", handler);
      };
    },
    [key],
  );

  const value = useSyncExternalStore(
    subscribe,
    () => readValue(key, defaultValue),
    () => defaultValue,
  );

  const setValue = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Storage unavailable (private browsing, blocked site data) -
        // the toggle has nowhere to persist, so it falls back to
        // defaultValue on every read. Acceptable degradation for a
        // convenience preference; not worth a parallel in-memory store.
      }
      emitter.dispatchEvent(new Event(key));
    },
    [key],
  );

  return [value, setValue];
}
