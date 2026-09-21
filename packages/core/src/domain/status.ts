/**
 * Shared product identity. Kept as the smoke-test target because it is the
 * first thing both `web` and `worker` need to import from `@core`, and
 * because a change here should be a deliberate, visible decision.
 */
export const APP_NAME = "Koya Lead Agent";
