-- Task 20: the failure-injection layer's per-run toggle
-- (SYSTEM-DESIGN-NEXTJS.md §13 "Failure injection": "Env/UI toggles
-- force: Apify failure, Apify empty result... Each toggle makes a
-- failure demo a button press"). A run-scoped column, not a global env
-- var alone, because a global toggle would affect every concurrent run
-- and every user - this one only ever changes the single row it's set
-- on, checked by the worker only when it actually claims that run.
alter table runs add column injected_failure text;
