import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True only after the component has mounted client-side. Standard use:
 * a value that legitimately differs between server and client render
 * (an OS-preference-derived theme, a localStorage-backed value) renders
 * a placeholder until this flips true, avoiding a hydration mismatch.
 *
 * `useSyncExternalStore` rather than `useEffect` + `useState` -
 * `react-hooks/set-state-in-effect` (this codebase's lint config) flags
 * calling `setState` synchronously inside an effect body, which is
 * exactly what the older `useEffect(() => setMounted(true), [])` pattern
 * does. This is React's own documented replacement for that idiom.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
