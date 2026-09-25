-- The structured HarvestAPI filters (LinkedIn industry codes, headcount
-- bounds, locations) chosen during ICP refinement. Kept out of `icp`
-- because that column's shape must stay exactly the ICP guide's JSON
-- (tests/contract/schemas-match-guides.test.ts); discover_companies reads
-- these and applies them itself, so the agent never writes a hard filter
-- into an individual search call.
alter table runs add column discovery_filters jsonb;
